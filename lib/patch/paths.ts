import type { ChangeOpKind } from "@/lib/domain/schemas";

/**
 * The complete allowlist of mutable state paths. Anything not parseable into
 * one of these families is forbidden — there is no generic object walker and
 * no dynamic property access outside this module's explicit switch cases.
 *
 *   /devices/{deviceId}/interfaces/{interfaceId}/enabled      replace
 *   /devices/{deviceId}/routes/{routeId}                      add | remove
 *   /devices/{deviceId}/routes/{routeId}/metric               replace
 *   /devices/{deviceId}/routing/preferences/{preferenceName}  add | replace
 */

export type ParsedPatchPath =
  | { family: "interface-enabled"; deviceId: string; interfaceId: string }
  | { family: "route"; deviceId: string; routeId: string }
  | { family: "route-metric"; deviceId: string; routeId: string }
  | { family: "routing-preference"; deviceId: string; preferenceName: string };

/** Kebab-case segment; also structurally excludes __proto__/constructor tricks. */
const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function parsePatchPath(path: string): ParsedPatchPath | null {
  if (!path.startsWith("/") || path.includes("//")) return null;
  const segments = path.slice(1).split("/");
  if (!segments.every((segment) => SEGMENT_PATTERN.test(segment))) return null;

  const [root, deviceId, section, third, fourth] = segments;
  if (root !== "devices" || deviceId === undefined) return null;

  if (section === "interfaces" && third !== undefined && fourth === "enabled" && segments.length === 5) {
    return { family: "interface-enabled", deviceId, interfaceId: third };
  }
  if (section === "routes" && third !== undefined && segments.length === 4) {
    return { family: "route", deviceId, routeId: third };
  }
  if (section === "routes" && third !== undefined && fourth === "metric" && segments.length === 5) {
    return { family: "route-metric", deviceId, routeId: third };
  }
  if (section === "routing" && third === "preferences" && fourth !== undefined && segments.length === 5) {
    return { family: "routing-preference", deviceId, preferenceName: fourth };
  }
  return null;
}

const ALLOWED_OPS: Record<ParsedPatchPath["family"], readonly ChangeOpKind[]> = {
  "interface-enabled": ["replace"],
  route: ["add", "remove"],
  "route-metric": ["replace"],
  "routing-preference": ["add", "replace"],
};

export function isOpAllowedForPath(parsed: ParsedPatchPath, op: ChangeOpKind): boolean {
  return ALLOWED_OPS[parsed.family].includes(op);
}

/**
 * Deterministic screen for executable content smuggled into string values.
 * ChangeSafe state values are identifiers/numbers; shell metacharacters or
 * CLI verbs have no legitimate place in them.
 */
const EXECUTABLE_CHARS = /[;&|`$#<>\\\n\r]/;
const EXECUTABLE_VERBS =
  /\b(conf(igure)? t(erminal)?|ip route|no ip|no route|ssh|telnet|curl|wget|bash|sh -c|rm -|sudo|shutdown|reload|exec)\b/i;

export function looksExecutable(text: string): boolean {
  return EXECUTABLE_CHARS.test(text) || EXECUTABLE_VERBS.test(text);
}
