// M4 experiment 09 (docs/M4_EXPERIMENT_09.md): summarize what each attempt to
// set the grant carrier outside the enforcer did. Observes only; the
// hypotheses are decided in the experiment note.
//
// usage: node m4-carrier-probe-summary.mjs <dir> <audit-after.log> <out.json>
// <dir> holds probe-<name>.out, probe-<name>.status and probe-<name>.after.json
// for name in annotate-main, patch-status-annotation, patch-status-spec, plus
// probe-before.json.
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
  return {
    name,
    exitStatus: Number((read(`probe-${name}.status`) ?? "").trim()),
    output: out.slice(0, 400),
    after: state(`probe-${name}.after.json`),
  };
});

// Audit: requests that touched the Deployment's status subresource or set the
// carrier, with whether the enforcer annotated them (it was then called).
const audit = [];
if (auditPath && existsSync(auditPath)) {
  for (const line of readFileSync(auditPath, "utf8").split("\n").filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const ref = event.objectRef ?? {};
    if (ref.resource !== "deployments" || ref.name !== "web") continue;
    if (!["patch", "update"].includes(event.verb)) continue;
    const touchesCarrier = JSON.stringify(event.requestObject ?? {}).includes("m4-forged");
    if (ref.subresource !== "status" && !touchesCarrier) continue;
    audit.push({
      auditID: event.auditID,
      verb: event.verb,
      subresource: ref.subresource ?? null,
      code: event.responseStatus?.code ?? null,
      message: String(event.responseStatus?.message ?? "").slice(0, 200),
      enforcerAnnotated: Object.keys(event.annotations ?? {}).some((key) => key.includes("enforcer.changesafe.dev")),
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
  console.log(`  ${event.verb} subresource=${event.subresource ?? "-"} code=${event.code} enforcerAnnotated=${event.enforcerAnnotated} forgedCarrier=${event.touchesForgedCarrier} ${event.message}`);
}
