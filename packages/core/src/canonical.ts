import { DomainError } from "./errors";

/**
 * Canonical JSON serialization: recursively sorted object keys (code-unit
 * order, locale-independent), arrays in given order, `undefined` properties
 * dropped. Semantically equal objects always produce byte-identical output,
 * which is what makes receipt hashes and rollback equality checks stable.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, "$");
}

function serialize(value: unknown, at: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new DomainError("INTERNAL", `Non-finite number at ${at} cannot be canonicalized`);
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new DomainError(
        "INTERNAL",
        `Value of type ${typeof value} at ${at} cannot be canonicalized`,
      );
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, index) => serialize(item, `${at}[${index}]`)).join(",")}]`;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new DomainError("INTERNAL", `Non-plain object at ${at} cannot be canonicalized`);
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${serialize(entryValue, `${at}.${key}`)}`)
    .join(",")}}`;
}

/** Canonical equality — the definition used by rollback verification. */
export function canonicallyEqual(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}
