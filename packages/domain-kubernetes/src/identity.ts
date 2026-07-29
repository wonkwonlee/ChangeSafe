import { DomainError } from "@changesafe/core";

import {
  KubernetesIdentitySchema,
  type KubernetesIdentity,
} from "./schemas";

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const FNV_MASK_64 = 0xffffffffffffffffn;

/** Separator-safe identity key used for duplicate and collision detection. */
export function identityKeyOf(identity: KubernetesIdentity): string {
  return [
    identity.apiVersion,
    identity.kind,
    identity.namespace,
    identity.name,
  ].join("\u0000");
}

/**
 * Stable FNV-1a 64-bit resource id. Identity fields are schema-validated
 * before hashing so this never assigns an id to an unsupported resource.
 */
export function resourceIdOf(input: KubernetesIdentity): `res-${string}` {
  const parsed = KubernetesIdentitySchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError(
      "SCHEMA_VALIDATION",
      "A Kubernetes resource identity is invalid or unsupported.",
    );
  }

  let hash = FNV_OFFSET_BASIS_64;
  for (const byte of new TextEncoder().encode(identityKeyOf(parsed.data))) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & FNV_MASK_64;
  }

  return `res-${hash.toString(16).padStart(16, "0")}`;
}
