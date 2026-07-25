import { z } from "zod";

import { canonicalize } from "./canonical";
import { DomainError } from "./errors";
import { TimestampSchema } from "./primitives";
import { ChangeReceiptSchema, type ChangeReceipt } from "./receipt";

/**
 * Receipt signing.
 *
 * The receipt's own SHA-256 proves *integrity*: that the content still
 * matches what it claims. It proves nothing about *authorship* — anyone with
 * the codebase can produce an internally consistent receipt. A signature is
 * what turns "this was not altered" into "this instance issued it".
 *
 * Ed25519 through Web Crypto, so core stays isomorphic: the same code signs
 * on a server and verifies in a browser, with no dependency and no native
 * module.
 */

export const SIGNATURE_ALGORITHM = "ed25519" as const;
const WEB_CRYPTO_ALGORITHM = { name: "Ed25519" } as const;

export const ReceiptSignatureSchema = z.strictObject({
  algorithm: z.literal(SIGNATURE_ALGORITHM),
  /**
   * Fingerprint of the signing key: the first 32 hex characters of SHA-256
   * over its SPKI encoding. Names which key signed without shipping the key
   * itself — a verifier must obtain the real key out of band.
   */
  publicKeyId: z.string().regex(/^[a-f0-9]{32}$/),
  /** Base64 Ed25519 signature over the canonical receipt. */
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  signedAtUtc: TimestampSchema,
});

/**
 * A receipt plus a detached signature over it.
 *
 * Deliberately an envelope rather than a field inside the receipt: existing
 * unsigned receipts stay valid and `receiptSha256` keeps its exact meaning,
 * so signing is additive rather than a format break.
 *
 * The envelope carries no public key. Embedding one would invite a verifier
 * that checks a signature against the key shipped beside it — which any
 * forger can satisfy, and which would read as proof while proving nothing.
 */
export const SignedReceiptSchema = z.strictObject({
  receipt: ChangeReceiptSchema,
  signature: ReceiptSignatureSchema,
});

export type ReceiptSignature = z.infer<typeof ReceiptSignatureSchema>;
export type SignedReceipt = z.infer<typeof SignedReceiptSchema>;

/**
 * The outcome of checking a signature.
 *
 * `unverified` is not a pass. It is the honest answer when a signature exists
 * but the caller supplied no trusted key, and callers must treat it as
 * "unknown" — never as valid.
 */
export type SignatureVerdict = "valid" | "invalid" | "key_mismatch" | "unverified";

function toBase64(bytes: ArrayBuffer): string {
  // Keys and signatures are tens of bytes, so the spread is safe here.
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  // Backed by a plain ArrayBuffer so the result satisfies BufferSource
  // without a cast — Web Crypto rejects SharedArrayBuffer-backed views.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable fingerprint of a verifying key, used to name it in a signature. */
export async function computePublicKeyId(publicKey: CryptoKey): Promise<string> {
  const spki = await globalThis.crypto.subtle.exportKey("spki", publicKey);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", spki);
  return toHex(digest).slice(0, 32);
}

/** The exact bytes a signature covers: the canonical receipt, hash included. */
function signingPayload(receipt: ChangeReceipt): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(canonicalize(receipt));
  // Re-home onto a plain ArrayBuffer so this satisfies BufferSource without a
  // cast; receipts are small enough that the copy is irrelevant.
  const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  bytes.set(encoded);
  return bytes;
}

export interface SignReceiptOptions {
  /** Injectable for deterministic tests; defaults to the current UTC instant. */
  signedAtUtc?: string;
}

/** Sign a receipt, producing a detached-signature envelope. */
export async function signReceipt(
  receipt: ChangeReceipt,
  keyPair: { privateKey: CryptoKey; publicKey: CryptoKey },
  options: SignReceiptOptions = {},
): Promise<SignedReceipt> {
  const signature = await globalThis.crypto.subtle.sign(
    WEB_CRYPTO_ALGORITHM,
    keyPair.privateKey,
    signingPayload(receipt),
  );

  return SignedReceiptSchema.parse({
    receipt,
    signature: {
      algorithm: SIGNATURE_ALGORITHM,
      publicKeyId: await computePublicKeyId(keyPair.publicKey),
      signature: toBase64(signature),
      signedAtUtc: options.signedAtUtc ?? new Date().toISOString(),
    },
  });
}

/**
 * Check a signature against a key the caller already trusts.
 *
 * Requiring the key as an argument is the point: there is no way to call this
 * such that a receipt vouches for itself. A `key_mismatch` means the receipt
 * was signed by some other key — which is a failure, not a near-miss.
 */
export async function verifyReceiptSignature(
  signed: SignedReceipt,
  trustedPublicKey: CryptoKey,
): Promise<SignatureVerdict> {
  if ((await computePublicKeyId(trustedPublicKey)) !== signed.signature.publicKeyId) {
    return "key_mismatch";
  }
  const ok = await globalThis.crypto.subtle.verify(
    WEB_CRYPTO_ALGORITHM,
    trustedPublicKey,
    fromBase64(signed.signature.signature),
    signingPayload(signed.receipt),
  );
  return ok ? "valid" : "invalid";
}

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

const PEM_LINE_LENGTH = 64;

function toPem(label: string, bytes: ArrayBuffer): string {
  const body = toBase64(bytes).match(new RegExp(`.{1,${PEM_LINE_LENGTH}}`, "g")) ?? [];
  return `-----BEGIN ${label}-----\n${body.join("\n")}\n-----END ${label}-----\n`;
}

function fromPem(label: string, pem: string): Uint8Array<ArrayBuffer> {
  const match = new RegExp(
    `-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`,
  ).exec(pem);
  if (!match?.[1]) {
    throw new DomainError(
      "SCHEMA_VALIDATION",
      `Expected a PEM block labeled "${label}". Generate one with \`changesafe keygen\`.`,
    );
  }
  return fromBase64(match[1].replace(/\s+/g, ""));
}

export interface SigningKeyPairPem {
  privateKeyPem: string;
  publicKeyPem: string;
  publicKeyId: string;
}

/** Generate a fresh Ed25519 signing key pair in PEM form. */
export async function generateSigningKeyPair(): Promise<SigningKeyPairPem> {
  const keyPair = (await globalThis.crypto.subtle.generateKey(WEB_CRYPTO_ALGORITHM, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const [pkcs8, spki] = await Promise.all([
    globalThis.crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
    globalThis.crypto.subtle.exportKey("spki", keyPair.publicKey),
  ]);

  return {
    privateKeyPem: toPem("PRIVATE KEY", pkcs8),
    publicKeyPem: toPem("PUBLIC KEY", spki),
    publicKeyId: await computePublicKeyId(keyPair.publicKey),
  };
}

/** Import a signing key pair from a private-key PEM. */
export async function importSigningKeyPair(
  privateKeyPem: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  const pkcs8 = fromPem("PRIVATE KEY", privateKeyPem);
  const privateKey = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    WEB_CRYPTO_ALGORITHM,
    true,
    ["sign"],
  );

  // Ed25519 public keys are the last 32 bytes of the PKCS8 seed encoding's
  // key material, but deriving them by slicing is fragile across encoders.
  // Re-export through JWK instead, which carries `x` (the public point).
  const jwk = await globalThis.crypto.subtle.exportKey("jwk", privateKey);
  const publicKey = await globalThis.crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
    WEB_CRYPTO_ALGORITHM,
    true,
    ["verify"],
  );

  return { privateKey, publicKey };
}

/** Import a verifying key from a public-key PEM. */
export async function importVerifyingKey(publicKeyPem: string): Promise<CryptoKey> {
  const spki = fromPem("PUBLIC KEY", publicKeyPem);
  return globalThis.crypto.subtle.importKey(
    "spki",
    spki,
    WEB_CRYPTO_ALGORITHM,
    true,
    ["verify"],
  );
}
