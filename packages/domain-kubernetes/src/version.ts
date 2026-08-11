import { CORE_POLICY_VERSION } from "@changesafe/core";

/** Bumped whenever Kubernetes policy behavior changes; recorded in receipts. */
export const KUBERNETES_POLICY_VERSION = "kubernetes-v0.1.0";

/** Combined core and Kubernetes policy version for a deterministic review. */
export const POLICY_VERSION = `${CORE_POLICY_VERSION}+${KUBERNETES_POLICY_VERSION}`;
