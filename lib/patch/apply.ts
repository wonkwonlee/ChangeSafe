import { DomainError } from "@/lib/domain/errors";
import {
  RouteValueSchema,
  type ChangeOperation,
  type CurrentState,
  type DeviceState,
  type DiffEntry,
  type JsonValue,
  type Route,
} from "@/lib/domain/schemas";
import { isOpAllowedForPath, looksExecutable, parsePatchPath } from "./paths";

export interface PatchResult {
  nextState: CurrentState;
  diff: DiffEntry[];
}

/**
 * Transactional patch application. Operations run in order against a deep
 * clone of `state`; the first failure throws and the caller's original state
 * is untouched (the clone is discarded). Partial mutation can never escape.
 */
export function applyOperations(
  state: CurrentState,
  operations: ChangeOperation[],
): PatchResult {
  const nextState = structuredClone(state);
  const diff: DiffEntry[] = [];

  for (const operation of operations) {
    diff.push(applySingle(nextState, operation));
  }

  return { nextState, diff };
}

function forbidden(path: string, detail: string): DomainError {
  return new DomainError("PATCH_PATH_FORBIDDEN", `Path "${path}" is not allowed: ${detail}`);
}

function missing(path: string, detail: string): DomainError {
  return new DomainError("PATCH_TARGET_MISSING", `Target for "${path}" does not exist: ${detail}`);
}

function conflict(path: string, detail: string): DomainError {
  return new DomainError("PATCH_CONFLICT", `Operation on "${path}" conflicts: ${detail}`);
}

function invalidValue(path: string, detail: string): DomainError {
  return new DomainError("PATCH_VALUE_INVALID", `Value for "${path}" is invalid: ${detail}`);
}

function requireDevice(state: CurrentState, deviceId: string, path: string): DeviceState {
  const device = state.devices[deviceId];
  if (!device) throw missing(path, `unknown device "${deviceId}"`);
  return device;
}

/** Mutates the (already cloned) state for one operation and returns its diff entry. */
function applySingle(state: CurrentState, operation: ChangeOperation): DiffEntry {
  const { op, path, value } = operation;

  const parsed = parsePatchPath(path);
  if (!parsed) {
    throw forbidden(path, "not in the allowlisted path families");
  }
  if (!isOpAllowedForPath(parsed, op)) {
    throw forbidden(path, `operation "${op}" is not allowed for this path family`);
  }

  const device = requireDevice(state, parsed.deviceId, path);

  switch (parsed.family) {
    case "interface-enabled": {
      const iface = device.interfaces[parsed.interfaceId];
      if (!iface) throw missing(path, `unknown interface "${parsed.interfaceId}"`);
      if (typeof value !== "boolean") throw invalidValue(path, "expected a boolean");
      const before: JsonValue = iface.enabled;
      iface.enabled = value;
      return { op, path, before, after: value };
    }

    case "route": {
      if (op === "add") {
        if (device.routes[parsed.routeId]) {
          throw conflict(path, `route "${parsed.routeId}" already exists`);
        }
        const parsedValue = RouteValueSchema.safeParse(value);
        if (!parsedValue.success) {
          throw invalidValue(path, "expected a complete route object");
        }
        if (parsedValue.data.id !== parsed.routeId) {
          throw invalidValue(
            path,
            `route value id "${parsedValue.data.id}" must match path segment "${parsed.routeId}"`,
          );
        }
        const route: Route = {
          id: parsedValue.data.id,
          destination: parsedValue.data.destination,
          nextHop: parsedValue.data.nextHop,
          metric: parsedValue.data.metric,
          kind: parsedValue.data.kind,
          protected: parsedValue.data.protected,
          ...(parsedValue.data.description === null
            ? {}
            : { description: parsedValue.data.description }),
        };
        device.routes[parsed.routeId] = route;
        return { op, path, before: null, after: routeToJson(route) };
      }
      // remove: must capture the full prior value so a valid inverse exists.
      const route = device.routes[parsed.routeId];
      if (!route) throw missing(path, `unknown route "${parsed.routeId}"`);
      if (value !== null) throw invalidValue(path, "remove operations must carry value null");
      delete device.routes[parsed.routeId];
      return { op, path, before: routeToJson(route), after: null };
    }

    case "route-metric": {
      const route = device.routes[parsed.routeId];
      if (!route) throw missing(path, `unknown route "${parsed.routeId}"`);
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1000) {
        throw invalidValue(path, "expected an integer metric between 0 and 1000");
      }
      const before: JsonValue = route.metric;
      route.metric = value;
      return { op, path, before, after: value };
    }

    case "routing-preference": {
      const preferences = device.routing.preferences;
      const exists = Object.prototype.hasOwnProperty.call(preferences, parsed.preferenceName);
      if (op === "add" && exists) {
        throw conflict(path, `preference "${parsed.preferenceName}" already exists`);
      }
      if (op === "replace" && !exists) {
        throw missing(path, `unknown preference "${parsed.preferenceName}"`);
      }
      if (typeof value !== "string" && typeof value !== "number") {
        throw invalidValue(path, "expected a string or number");
      }
      if (typeof value === "string" && looksExecutable(value)) {
        throw invalidValue(path, "string value contains executable content");
      }
      const before: JsonValue = exists ? (preferences[parsed.preferenceName] ?? null) : null;
      preferences[parsed.preferenceName] = value;
      return { op, path, before, after: value };
    }
  }
}

function routeToJson(route: Route): JsonValue {
  return {
    id: route.id,
    destination: route.destination,
    nextHop: route.nextHop,
    metric: route.metric,
    kind: route.kind,
    protected: route.protected,
    ...(route.description === undefined ? {} : { description: route.description }),
  };
}

/** Distinct devices touched by parseable operations — the blast radius input. */
export function affectedDeviceIds(operations: ChangeOperation[]): string[] {
  const ids = new Set<string>();
  for (const operation of operations) {
    const parsed = parsePatchPath(operation.path);
    if (parsed) ids.add(parsed.deviceId);
  }
  return [...ids].sort();
}
