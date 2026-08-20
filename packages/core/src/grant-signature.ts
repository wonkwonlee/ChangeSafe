import { z } from "zod";

import { AuthorizationGrantSchema, type AuthorizationGrant } from "./grant";
import { canonicalize } from "./canonical";
import { TimestampSchema } from "./primitives";
import { SIGNATURE_ALGORITHM, computePublicKeyId } from "./signature";

/**
 * Grant signing.
 *
 * Mirrors receipt signing exactly (see signature.ts): Ed25519 through Web
 * Crypto, a detached-signature envelope, no embedded public key. A grant's
 * signature is what lets an enforcement point trust that the issuing server
 * — not a forger with the schema — produced it.
 */
const WEB_CRYPTO_ALGORITHM = { name: "Ed25519" } as const;

export const GrantSignatureSchema = z.strictObject({
  algorithm: z.literal(SIGNATURE_ALGORITHM),
  publicKeyId: z.string().regex(/^[a-f0-9]{32}$/),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  signedAtUtc: TimestampSchema,
});

export const SignedGrantSchema = z.strictObject({
  grant: AuthorizationGrantSchema,
  signature: GrantSignatureSchema,
});

export type GrantSignature = z.infer<typeof GrantSignatureSchema>;
export type SignedGrant = z.infer<typeof SignedGrantSchema>;
export type GrantSignatureVerdict = "valid" | "invalid" | "key_mismatch" | "unverified";

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function signingPayload(grant: AuthorizationGrant): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(canonicalize(grant));
  const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  bytes.set(encoded);
  return bytes;
}

export interface SignGrantOptions {
  /** Injectable for deterministic tests; defaults to the current UTC instant. */
  signedAtUtc?: string;
}

/** Sign a grant, producing a detached-signature envelope. */
export async function signGrant(
  grant: AuthorizationGrant,
  keyPair: { privateKey: CryptoKey; publicKey: CryptoKey },
  options: SignGrantOptions = {},
): Promise<SignedGrant> {
  const signature = await globalThis.crypto.subtle.sign(
    WEB_CRYPTO_ALGORITHM,
    keyPair.privateKey,
    signingPayload(grant),
  );

  return SignedGrantSchema.parse({
    grant,
    signature: {
      algorithm: SIGNATURE_ALGORITHM,
      publicKeyId: await computePublicKeyId(keyPair.publicKey),
      signature: toBase64(signature),
      signedAtUtc: options.signedAtUtc ?? new Date().toISOString(),
    },
  });
}

/** Check a grant's signature against a key the caller already trusts. */
export async function verifyGrantSignature(
  signed: SignedGrant,
  trustedPublicKey: CryptoKey,
): Promise<GrantSignatureVerdict> {
  if ((await computePublicKeyId(trustedPublicKey)) !== signed.signature.publicKeyId) {
    return "key_mismatch";
  }
  const ok = await globalThis.crypto.subtle.verify(
    WEB_CRYPTO_ALGORITHM,
    trustedPublicKey,
    fromBase64(signed.signature.signature),
    signingPayload(signed.grant),
  );
  return ok ? "valid" : "invalid";
}
