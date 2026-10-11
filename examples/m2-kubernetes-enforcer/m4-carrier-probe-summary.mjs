// M4 experiment 09 (docs/M4_EXPERIMENT_09.md): summarize what each attempt to
// set the grant carrier outside the enforcer did. Observes only; the
// hypotheses are decided in the experiment note.
//
// usage: node m4-carrier-probe-summary.mjs <dir> <audit-after.log> <out.json>
// <dir> holds probe-<name>.out, probe-<name>.status and probe-<name>.after.json
// for name in annotate-main, patch-status-annotation, patch-status-spec, plus
// probe-before.json and probe-window.txt (two ISO timestamps, one per line:
// when the probes started and ended). A missing status or state file is
// reported as null, never as success.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const [dir, auditPath, outPath] = process.argv.slice(2);
const read = (name) => (existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), "utf8") : null);
const state = (name) => {
  const text = read(name);
  if (text === null) return null;
  try {
    const object = JSON.parse(text);
    return {
      resourceVersion: object.metadata?.resourceVersion ?? null,
      carrier: object.metadata?.annotations?.["changesafe.dev/grant"] ?? null,
      replicas: object.spec?.replicas ?? null,
      probeLabel: object.metadata?.labels?.["m4.changesafe.dev/probe"] ?? null,
    };
  } catch { return null; }
};

const before = state("probe-before.json");
const names = ["annotate-main", "patch-status-annotation", "patch-status-spec"];
const probes = names.map((name) => {
  const out = (read(`probe-${name}.out`) ?? "").trim();
  const status = (read(`probe-${name}.status`) ?? "").trim();
  return {
    name,
    // null when the helper did not record one: an absent file is not "0".
    exitStatus: status === "" || Number.isNaN(Number(status)) ? null : Number(status),
    output: out.slice(0, 400),
    after: state(`probe-${name}.after.json`),
  };
});
const [windowStart, windowEnd] = (read("probe-window.txt") ?? "").split("\n").map((line) => line.trim()).filter(Boolean);

// Audit: requests on the demo Deployment in the protected namespace, inside
// the probes' time window and not made by a system: identity (the Deployment
// controller also writes status, constantly). "enforcerGrantAnnotated" says
// the enforcer returned its grant annotations; it does NOT say whether the
// webhook was called: a request with no readable grant is answered with no
// annotations, called or not. For a request that SUCCEEDED with no grant
// attached, the inference that the webhook was not called comes from the
// enforcer denying every such request on the main resource (the first
// probe), not from this field.
const NAMESPACE = "changesafe-protected-demo";
const audit = [];
if (auditPath && existsSync(auditPath)) {
  for (const line of readFileSync(auditPath, "utf8").split("\n").filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const ref = event.objectRef ?? {};
    if (ref.resource !== "deployments" || ref.name !== "web" || ref.namespace !== NAMESPACE) continue;
    if (!["patch", "update"].includes(event.verb)) continue;
    const username = event.user?.username ?? "";
    // Every system: identity is a cluster component, not the probe actor: the
    // controller manager (system:kube-controller-manager) writes the
    // Deployment's status as a user, not as a service account.
    if (username.startsWith("system:")) continue;
    const at = event.requestReceivedTimestamp ?? event.stageTimestamp ?? "";
    if (windowStart !== undefined && windowEnd !== undefined && (at < windowStart || at > windowEnd)) continue;
    const touchesCarrier = JSON.stringify(event.requestObject ?? {}).includes("m4-forged");
    if (ref.subresource !== "status" && !touchesCarrier) continue;
    audit.push({
      auditID: event.auditID,
      verb: event.verb,
      subresource: ref.subresource ?? null,
      code: event.responseStatus?.code ?? null,
      message: String(event.responseStatus?.message ?? "").slice(0, 200),
      user: username,
      at,
      enforcerGrantAnnotated: Object.keys(event.annotations ?? {}).some((key) => key.includes("enforcer.changesafe.dev")),
      deniedByWebhook: /admission webhook ".*" denied the request/.test(String(event.responseStatus?.message ?? "")),
      touchesForgedCarrier: touchesCarrier,
    });
  }
}

const evidence = { before, probes, audit };
writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n");

console.log(`before: rv ${before?.resourceVersion} replicas ${before?.replicas} carrier ${before?.carrier ? "present" : "-"}`);
for (const probe of probes) {
  console.log(`${probe.name}: exit ${probe.exitStatus}; after: rv ${probe.after?.resourceVersion} replicas ${probe.after?.replicas} ` +
    `carrier ${probe.after?.carrier === null ? "-" : JSON.stringify(String(probe.after?.carrier).slice(0, 24))} label ${probe.after?.probeLabel ?? "-"}`);
  console.log(`  output: ${probe.output.split("\n")[0].slice(0, 220)}`);
}
console.log(`audit events for the probes: ${audit.length}`);
for (const event of audit) {
  console.log(`  ${event.verb} subresource=${event.subresource ?? "-"} code=${event.code} grantAnnotated=${event.enforcerGrantAnnotated} ` +
    `deniedByWebhook=${event.deniedByWebhook} forgedCarrier=${event.touchesForgedCarrier} user=${event.user} ${event.message}`);
}
