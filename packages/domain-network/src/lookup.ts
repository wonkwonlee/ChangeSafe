/**
 * Record lookups by an identifier that came from outside.
 *
 * Device, interface, and route ids are kebab-case, which keeps `__proto__`
 * out — but not `constructor`, `toString`, or anything else already on
 * `Object.prototype`. A plain `record[id]` therefore answers with an
 * inherited function for an id no operator ever declared, and the truthiness
 * check that follows reads it as "the device exists". What comes next is a
 * `TypeError` from deep inside a policy rather than the typed
 * "unknown device" the caller is written to handle.
 *
 * Own-property lookups make an undeclared id simply absent, which is what it
 * is.
 */
export function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
