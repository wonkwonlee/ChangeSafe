import type { PolicyFinding } from "@changesafe/core";

import { existingAndProposed, isFinding, isWorkload, postChangeState, type KubernetesPolicyContext } from "./common";
import type { KubernetesResource } from "../schemas";

const BASELINE_CAPABILITIES = new Set([
  "AUDIT_WRITE", "CHOWN", "DAC_OVERRIDE", "FOWNER", "FSETID", "KILL", "MKNOD",
  "NET_BIND_SERVICE", "SETFCAP", "SETGID", "SETPCAP", "SETUID", "SYS_CHROOT",
]);

function privilegeSignals(resource: KubernetesResource): Set<string> {
  if (!isWorkload(resource)) return new Set();
  const signals = new Set<string>();
  const spec = resource.spec;
  if (spec.podRunAsUser === 0) signals.add("pod:runAsUser=0");
  for (const field of ["hostNetwork", "hostPID", "hostIPC", "hasHostPath"] as const) {
    if (spec[field]) signals.add(field);
  }
  for (const container of [...(spec.initContainers ?? []), ...(spec.containers ?? [])]) {
    const security = container.security;
    if (security?.privileged === true) signals.add(`${container.name}:privileged`);
    if (security?.allowPrivilegeEscalation === true) {
      signals.add(`${container.name}:allowPrivilegeEscalation`);
    } else if (security?.allowPrivilegeEscalation === undefined) {
      signals.add(`${container.name}:allowPrivilegeEscalation=ambiguous`);
    }
    if (security?.runAsUser === 0) signals.add(`${container.name}:runAsUser=0`);
    for (const capability of security?.addedCapabilities ?? []) {
      if (!BASELINE_CAPABILITIES.has(capability)) signals.add(`${container.name}:capability=${capability}`);
    }
  }
  return signals;
}

export function evaluatePrivilegeEscalation(context: KubernetesPolicyContext): PolicyFinding {
  const patched = postChangeState(context, "K8S_PRIVILEGE_ESCALATION");
  if (isFinding(patched)) return patched;

  const violations = existingAndProposed(context, patched).flatMap(({ path, before, after }) => {
    if (!after || !isWorkload(after)) return [];
    const prior = before ? privilegeSignals(before) : new Set<string>();
    const introduced = [...privilegeSignals(after)].filter((signal) => !prior.has(signal));
    return introduced.length === 0 ? [] : [{ path, introduced }];
  });
  if (violations.length > 0) {
    return {
      policyId: "K8S_PRIVILEGE_ESCALATION",
      status: "BLOCK",
      title: "Change introduces privileged workload settings",
      explanation: violations.map(({ path, introduced }) => `${path} newly enables ${introduced.join(", ")}.`).join(" ") + " Privileged workload settings cannot be approved.",
      affectedResources: violations.map(({ path }) => path).sort(),
      remediation: "Remove the newly privileged setting or use a separately reviewed, least-privilege workload design.",
    };
  }
  return {
    policyId: "K8S_PRIVILEGE_ESCALATION", status: "PASS", title: "No privilege escalation introduced",
    explanation: "No proposed workload newly enables a modeled privileged setting or capability outside the Baseline allowlist.",
    affectedResources: [], remediation: null,
  };
}
