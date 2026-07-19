import { canonicalize } from "./canonical";

/**
 * SHA-256 via WebCrypto, which exists in both Node (tests, server) and the
 * browser (receipt creation happens client-side on synthetic data only).
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Hash of the canonical serialization — the only way domain objects are hashed. */
export async function hashCanonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}
