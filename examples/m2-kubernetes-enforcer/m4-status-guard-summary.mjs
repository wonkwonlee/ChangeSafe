// M4 experiment 10 (docs/M4_EXPERIMENT_10.md): what the candidate status
// guard did to the carrier probe, to a harmless status write, and to the
// Deployment controller's own status writes. Observes only.
//
// usage: node m4-status-guard-summary.mjs <dir> <out.json>
// <dir> holds guard-<name>.out/.status/.after.json for name in
// status-annotation, status-harmless; controller-before.json,
// controller-after.json, controller-replay.jsonl; guard-applied.txt.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const [dir, outPath] = process.argv.slice(2);
const read = (name) => (existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), "utf8") : null);
const object = (name) => {
  const text = read(name);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return {
      resourceVersion: value.metadata?.resourceVersion ?? null,
      carrier: value.metadata?.annotations?.["changesafe.dev/grant"] ?? null,
      replicas: value.spec?.replicas ?? null,
      readyReplicas: value.status?.readyReplicas ?? null,
      availableReplicas: value.status?.availableReplicas ?? null,
      conditions: (value.status?.conditions ?? []).map((condition) => condition.type + ":" + condition.status),
    };
  } catch { return null; }
};
const probe = (name) => ({
  name,
  exitStatus: Number((read(`guard-${name}.status`) ?? "").trim()),
  output: (read(`guard-${name}.out`) ?? "").trim().slice(0, 400),
  after: object(`guard-${name}.after.json`),
});

const replayEvents = [];
for (const line of (read("controller-replay.jsonl") ?? "").split("\n").filter(Boolean)) {
  try {
    const event = JSON.parse(line);
    if (event.object?.kind !== "Deployment") continue;
    replayEvents.push({
      type: event.type,
      resourceVersion: event.object.metadata.resourceVersion,
      readyReplicas: event.object.status?.readyReplicas ?? null,
      availableReplicas: event.object.status?.availableReplicas ?? null,
      carrier: event.object.metadata.annotations?.["changesafe.dev/grant"] ?? null,
    });
  } catch { /* a partial line */ }
}

const evidence = {
  guardApplied: (read("guard-applied.txt") ?? "").trim(),
  beforeGuard: object("guard-before.json"),
  statusAnnotation: probe("status-annotation"),
  statusHarmless: probe("status-harmless"),
  controllerBefore: object("controller-before.json"),
  controllerAfter: object("controller-after.json"),
  controllerEvents: replayEvents,
};
writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n");

console.log(`guard: ${evidence.guardApplied || "(not recorded)"}`);
console.log(`before guard: rv ${evidence.beforeGuard?.resourceVersion} carrier ${JSON.stringify(String(evidence.beforeGuard?.carrier).slice(0, 20))}`);
for (const item of [evidence.statusAnnotation, evidence.statusHarmless]) {
  console.log(`${item.name}: exit ${item.exitStatus}; after rv ${item.after?.resourceVersion} carrier ${JSON.stringify(String(item.after?.carrier).slice(0, 20))}`);
  console.log(`  output: ${item.output.split("\n")[0].slice(0, 240)}`);
}
console.log(`controller: rv ${evidence.controllerBefore?.resourceVersion} -> ${evidence.controllerAfter?.resourceVersion}; ` +
  `ready ${evidence.controllerBefore?.readyReplicas} -> ${evidence.controllerAfter?.readyReplicas}; events ${replayEvents.length}`);
for (const event of replayEvents) {
  console.log(`  ${event.type} rv ${event.resourceVersion} ready ${event.readyReplicas} available ${event.availableReplicas}`);
}
