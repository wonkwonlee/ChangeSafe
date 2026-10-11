import { describe, expect, it } from "vitest";
import { buildAdmissionReviewResponse, kubernetesObjectSha256 } from "@changesafe/kubernetes-enforcer";

/**
 * M4 experiment 02 — can the executor's write response be bound to the
 * grant it exercised without trusting the executor?
 * (docs/M4_EXPERIMENT_02.md)
 *
 * Experiment 01 showed a state read cannot attribute. The one party that
 * receives E2 evidence (the post-write `resourceVersion`) is the executor.
 * This file tests whether an executor-asserted claim can be checked, and
 * what a server-owned record would have to carry instead. Contracts are
 * test-local; audit-event field names are an assumption to verify live.
 */

interface KubernetesObject {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    resourceVersion?: string;
    annotations?: Record<string, string>;
  };
  spec: Record<string, unknown>;
}

/**
 * Everything the executor can assert from its own write response. The
 * response body is the stored object; it carries no admission request uid
 * and nothing the enforcer produced, so a claim can name a grant only
 * because the executor chooses to.
 */
interface ExecutorClaim {
  grantId: string;
  resultUid: string;
  resultResourceVersion: string;
}

type Observation = { kind: "unavailable" } | { kind: "present"; raw: KubernetesObject };

type ClaimCheck =
  | "unknown_unobserved"
  | "unknown_superseded"
  | "claimed_version_present_executor_asserted";

/** H2: a later read at the claimed uid and resourceVersion confirms the executor's claim. */
function naiveExecutorClaim(claim: ExecutorClaim, observation: Observation): boolean {
  return (
    observation.kind === "present" &&
    observation.raw.metadata.uid === claim.resultUid &&
    observation.raw.metadata.resourceVersion === claim.resultResourceVersion
  );
}

function checkClaim(claim: ExecutorClaim, observation: Observation): ClaimCheck {
  if (observation.kind === "unavailable") return "unknown_unobserved";
  const { metadata } = observation.raw;
  if (metadata.uid !== claim.resultUid || metadata.resourceVersion !== claim.resultResourceVersion) {
    return "unknown_superseded";
  }
  return "claimed_version_present_executor_asserted";
}

/**
 * The shape a server-owned record would need, modeled on an
 * audit.k8s.io/v1 Event at stage ResponseComplete. A validating webhook
 * can contribute `annotations` via `AdmissionResponse.auditAnnotations`;
 * the API server, not the executor, writes the event. Field names here
 * are the experiment's assumption, not a verified contract.
 */
interface AuditEvent {
  auditID: string;
  stage: "ResponseComplete";
  verb: "create" | "update" | "patch";
  user: { username: string; uid?: string };
  objectRef: { apiVersion: string; resource: string; namespace: string; name: string; uid?: string };
  responseStatus: { code: number };
  responseObject?: KubernetesObject;
  annotations?: Record<string, string>;
}

const GRANT_AUDIT_KEY = "changesafe-enforcer.changesafe.dev/grant-id";

type AuditBinding =
  | "audit_unavailable"
  | "audit_no_event_for_grant"
  | "audit_write_rejected"
  | "audit_write_recorded"
  | "audit_contradicts_claim";

function bindAudit(grantId: string, events: AuditEvent[] | undefined, claim?: ExecutorClaim): AuditBinding {
  if (events === undefined) return "audit_unavailable";
  const forGrant = events.filter(
    (event) => event.stage === "ResponseComplete" && event.annotations?.[GRANT_AUDIT_KEY] === grantId,
  );
  const [event] = forGrant;
  if (event === undefined) return "audit_no_event_for_grant";
  if (event.responseStatus.code >= 400) return "audit_write_rejected";
  if (
    claim !== undefined &&
    event.responseObject !== undefined &&
    (event.responseObject.metadata.resourceVersion !== claim.resultResourceVersion ||
      event.responseObject.metadata.uid !== claim.resultUid)
  ) {
    return "audit_contradicts_claim";
  }
  return "audit_write_recorded";
}

const UID = "aaaaaaaa-0000-0000-0000-000000000001";
const GRANT_ID = "grant-m4-exp02-0001";
const EXECUTOR = "system:serviceaccount:ops:changesafe-applier";
const RECONCILER = "system:serviceaccount:gitops:reconciler";

function deployment(uid: string, resourceVersion: string, replicas: number): KubernetesObject {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "web", namespace: "default", uid, resourceVersion },
    spec: { replicas },
  };
}

function event(
  overrides: Partial<AuditEvent> & { code: number; username: string; stored?: KubernetesObject },
): AuditEvent {
  return {
    auditID: overrides.auditID ?? "audit-0000",
    stage: "ResponseComplete",
    verb: overrides.verb ?? "patch",
    user: { username: overrides.username },
    objectRef: { apiVersion: "apps/v1", resource: "deployments", namespace: "default", name: "web", uid: UID },
    responseStatus: { code: overrides.code },
    ...(overrides.stored === undefined ? {} : { responseObject: overrides.stored }),
    ...(overrides.annotations === undefined ? {} : { annotations: overrides.annotations }),
  };
}

describe("M4-02: what the enforcer leaves behind today", () => {
  it("an ALLOW response carries no audit annotation, so the audit log cannot name the grant", () => {
    const response = buildAdmissionReviewResponse("admission-req-0001", { allowed: true });
    expect(response.response).toEqual({ uid: "admission-req-0001", allowed: true });
    expect("auditAnnotations" in response.response).toBe(false);
  });
});

describe("M4-02: counterexamples to executor-asserted binding (H2)", () => {
  const honest: ExecutorClaim = { grantId: GRANT_ID, resultUid: UID, resultResourceVersion: "101" };

  it("the claim is unfalsifiable by read once any later write lands", () => {
    // The honest executor's write produced rv 101; a reconciler then wrote
    // rv 150. A lying executor who never wrote anything claims rv 999.
    // Reads cannot reach historical versions, so both claims check alike.
    const lying: ExecutorClaim = { grantId: GRANT_ID, resultUid: UID, resultResourceVersion: "999" };
    const now: Observation = { kind: "present", raw: deployment(UID, "150", 4) };
    expect(naiveExecutorClaim(honest, now)).toBe(false);
    expect(naiveExecutorClaim(lying, now)).toBe(false);
    expect(checkClaim(honest, now)).toBe("unknown_superseded");
    expect(checkClaim(lying, now)).toBe("unknown_superseded");
  });

  it("a lying executor that names another writer's version passes H2", async () => {
    // The executor's grant-bearing write was rejected (409). A reconciler
    // then stored the same spec at rv 150. The executor reads rv 150 off
    // the object and claims it as its own result.
    const stolen: ExecutorClaim = { grantId: GRANT_ID, resultUid: UID, resultResourceVersion: "150" };
    const now: Observation = { kind: "present", raw: deployment(UID, "150", 4) };
    expect(naiveExecutorClaim(stolen, now)).toBe(true);
    expect(checkClaim(stolen, now)).toBe("claimed_version_present_executor_asserted");
    // Experiment 01's hash is equally fooled: the state is the admitted one.
    expect(await kubernetesObjectSha256(now.raw)).toBe(await kubernetesObjectSha256(deployment(UID, "101", 4)));
  });

  it("an unavailable read is unknown, never a verdict about the claim", () => {
    expect(naiveExecutorClaim(honest, { kind: "unavailable" })).toBe(false);
    expect(checkClaim(honest, { kind: "unavailable" })).toBe("unknown_unobserved");
  });
});

describe("M4-02: a server-owned record separates what reads could not", () => {
  const marked = { [GRANT_AUDIT_KEY]: GRANT_ID };

  it("rejected persistence and persisted-then-overwritten become distinct events", () => {
    // Experiment 01: these two paths produced byte-identical reads.
    const rejected = [event({ auditID: "audit-0001", username: EXECUTOR, code: 409, annotations: marked })];
    const overwritten = [
      event({ auditID: "audit-0001", username: EXECUTOR, code: 200, annotations: marked, stored: deployment(UID, "101", 4) }),
      event({ auditID: "audit-0002", username: RECONCILER, code: 200, stored: deployment(UID, "150", 3) }),
    ];
    expect(bindAudit(GRANT_ID, rejected)).toBe("audit_write_rejected");
    expect(bindAudit(GRANT_ID, overwritten)).toBe("audit_write_recorded");
  });

  it("the record contradicts a lying executor without trusting either party's word", () => {
    const stolen: ExecutorClaim = { grantId: GRANT_ID, resultUid: UID, resultResourceVersion: "150" };
    const events = [
      event({ auditID: "audit-0001", username: EXECUTOR, code: 200, annotations: marked, stored: deployment(UID, "101", 4) }),
      event({ auditID: "audit-0002", username: RECONCILER, code: 200, stored: deployment(UID, "150", 4) }),
    ];
    expect(bindAudit(GRANT_ID, events, stolen)).toBe("audit_contradicts_claim");
    const honest: ExecutorClaim = { grantId: GRANT_ID, resultUid: UID, resultResourceVersion: "101" };
    expect(bindAudit(GRANT_ID, events, honest)).toBe("audit_write_recorded");
  });

  it("a reconciler's write of the same state is not an event for the grant", () => {
    const events = [event({ auditID: "audit-0002", username: RECONCILER, code: 200, stored: deployment(UID, "150", 4) })];
    expect(bindAudit(GRANT_ID, events)).toBe("audit_no_event_for_grant");
  });

  it("a missing audit log is unknown, never success or failure", () => {
    expect(bindAudit(GRANT_ID, undefined)).toBe("audit_unavailable");
  });

  it("no verdict reads as a realized-effect attestation", () => {
    const verdicts: Array<ClaimCheck | AuditBinding> = [
      "unknown_unobserved",
      "unknown_superseded",
      "claimed_version_present_executor_asserted",
      "audit_unavailable",
      "audit_no_event_for_grant",
      "audit_write_rejected",
      "audit_write_recorded",
      "audit_contradicts_claim",
    ];
    for (const verdict of verdicts) {
      expect(verdict).not.toMatch(/realized|reconciled|verified|success|proven/);
    }
  });
});
