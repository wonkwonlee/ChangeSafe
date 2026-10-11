// M4 experiment 03: read the kube-apiserver audit log and the enforcer's
// use-state dump, keep only events an enforcer annotated, and print what
// each one records. Observes; asserts nothing about the hypotheses — the
// result is recorded in docs/M4_EXPERIMENT_03.md, not decided here.
//
// usage: node m4-audit-summary.mjs <audit.log> <use-state.json> <out.jsonl>
import { readFileSync, writeFileSync } from "node:fs";

const [auditPath, usesPath, outPath] = process.argv.slice(2);
const events = readFileSync(auditPath, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
const annotated = events.filter(event =>
  Object.keys(event.annotations ?? {}).some(key => key.endsWith("/grant-id")));
const pick = (event, suffix) =>
  Object.entries(event.annotations ?? {}).find(([key]) => key.endsWith(`/${suffix}`))?.[1] ?? "-";

writeFileSync(outPath, annotated.map(event => JSON.stringify(event)).join("\n") + "\n");
console.log(`audit events: ${events.length} recorded, ${annotated.length} carry an enforcer grant-id annotation`);
console.log(`annotation keys seen: ${[...new Set(annotated.flatMap(event => Object.keys(event.annotations ?? {})))].sort().join(", ") || "-"}`);
console.log("auditID | stage | verb | dryRun | code | grant-id | admission-uid | outcome | stored rv | stored replicas");
for (const event of annotated) {
  const stored = event.responseObject?.kind === "Deployment" ? event.responseObject : undefined;
  console.log([
    event.auditID, event.stage, event.verb,
    /[?&]dryRun=/.test(event.requestURI ?? "") ? "yes" : "no",
    event.responseStatus?.code ?? "-",
    pick(event, "grant-id"), pick(event, "admission-uid"), pick(event, "outcome"),
    stored?.metadata?.resourceVersion ?? "-", stored?.spec?.replicas ?? "-",
  ].join(" | "));
}
const uses = JSON.parse(readFileSync(usesPath, "utf8"));
console.log("enforcer use-state (grant_id -> admission_uid):");
for (const row of uses) console.log(`  ${row.grant_id} -> ${row.admission_uid ?? "(not recorded)"}`);
const consumedUids = new Set(uses.map(row => row.admission_uid).filter(Boolean));
const joined = annotated.filter(event => consumedUids.has(pick(event, "admission-uid")));
console.log(`use-state rows joined to an audit event by admission-uid: ${joined.length} of ${uses.length}`);
for (const event of joined) {
  console.log(`  ${pick(event, "grant-id")}: outcome ${pick(event, "outcome")}, API server response ${event.responseStatus?.code ?? "-"}`);
}
