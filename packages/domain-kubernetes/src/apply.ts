import { canonicallyEqual, DomainError, type DiffEntry } from "@changesafe/core";

import { resourceIdOf } from "./identity";
import { parseKubernetesPath } from "./paths";
import {
  KubernetesChangeOperationSchema,
  type KubernetesChangeOperation,
  type KubernetesState,
} from "./schemas";

export interface KubernetesPatchResult {
  nextState: KubernetesState;
  diff: DiffEntry[];
}

/**
 * Apply whole-resource upserts transactionally to a clone. No partial state
 * can escape when an operation is malformed or targets the wrong resource.
 */
export function applyKubernetesOperations(
  state: KubernetesState,
  operations: unknown,
): KubernetesPatchResult {
  const parsedOperations = KubernetesChangeOperationSchema.array().safeParse(operations);
  if (!parsedOperations.success) {
    throw new DomainError(
      "PATCH_VALUE_INVALID",
      "Kubernetes operations must be complete resource operation envelopes.",
    );
  }

  const nextState = structuredClone(state);
  const diff: DiffEntry[] = [];
  for (const operation of parsedOperations.data) {
    diff.push(applySingle(nextState, operation));
  }
  return { nextState, diff };
}

function applySingle(state: KubernetesState, operation: KubernetesChangeOperation): DiffEntry {
  const parsedPath = parseKubernetesPath(operation.path);
  if (!parsedPath) {
    throw new DomainError(
      "PATCH_PATH_FORBIDDEN",
      `Path "${operation.path}" is not an allowlisted Kubernetes resource path.`,
    );
  }

  const value = operation.value;
  if (value.resourceId !== parsedPath.resourceId || resourceIdOf(value.identity) !== parsedPath.resourceId) {
    throw new DomainError(
      "PATCH_VALUE_INVALID",
      `Resource value identity and resource id must match path "${operation.path}".`,
    );
  }

  const existing = state.resources[parsedPath.resourceId];
  switch (operation.op) {
    case "add":
      if (existing) {
        throw new DomainError("PATCH_CONFLICT", `Resource "${parsedPath.resourceId}" already exists.`);
      }
      state.resources[parsedPath.resourceId] = value;
      return { op: "add", path: operation.path, before: null, after: value };
    case "replace":
      if (!existing) {
        throw new DomainError("PATCH_TARGET_MISSING", `Resource "${parsedPath.resourceId}" does not exist.`);
      }
      state.resources[parsedPath.resourceId] = value;
      return { op: "replace", path: operation.path, before: existing, after: value };
    case "remove":
      if (!existing) {
        throw new DomainError("PATCH_TARGET_MISSING", `Resource "${parsedPath.resourceId}" does not exist.`);
      }
      if (!canonicallyEqual(value, existing)) {
        throw new DomainError(
          "PATCH_VALUE_INVALID",
          `Rollback removal value must exactly match existing resource "${parsedPath.resourceId}".`,
        );
      }
      delete state.resources[parsedPath.resourceId];
      return { op: "remove", path: operation.path, before: existing, after: null };
    default:
      throw new DomainError(
        "PATCH_VALUE_INVALID",
        `Operation "${operation.op}" is not allowed for Kubernetes resources.`,
      );
  }
}
