// M4 experiment 05 (docs/M4_EXPERIMENT_05.md): summarize what an
// independent watch on the demo Deployment delivered during the live run,
// next to the grants, the enforcer's use-state, and the audit events.
// Observes only. Nothing here asserts a hypothesis; the result is recorded
// in the experiment note, not decided by this script.
//
// usage: node m4-watch-summary.mjs <watch.jsonl> <audit.log> <use-state.json> \
//          <step1-grant.json> <m4-grant.json> <enforcer-dist-index.js> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [watchPath, auditPath, usesPath, grant1Path, grant2Path, hashModule, outPath] = process.argv.slice(2);
const { kubernetesObjectSha256 } = await import(pathToFileURL(hashModule).href);

const lines = (path) => readFileSync(path, "utf8").split("\n").filter(Boolean);
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const tryParse = (line) => { try { return JSON.parse(line); } catch { return undefined; } };

const CARRIER = "changesafe.dev/grant";
const carrierOf = (object) => {
  const raw = object?.metadata?.annotations?.[CARRIER];
  if (typeof raw !== "string") return undefined;
  try {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(text).grant;
  } catch { return undefined; }
};

const grants = [json(grant1Path).grant, json(grant2Path).grant].map((grant) => ({
  grantId: grant.grantId, objectSha256: grant.objectSha256, resourceUid: grant.resourceUid,
}));
const uses = json(usesPath);

let previousHash;
const watchEvents = [];
for (const line of lines(watchPath)) {
  const event = tryParse(line);
  if (event === undefined || event.type === undefined) continue; // a partial line at the kill
  const object = event.object ?? {};
  if (event.type === "BOOKMARK" || object.kind !== "Deployment") {
    watchEvents.push({ type: event.type, resourceVersion: object.metadata?.resourceVersion });
    continue;
  }
  const hash = await kubernetesObjectSha256(object);
  const carried = carrierOf(object);
  watchEvents.push({
    type: event.type,
    resourceVersion: object.metadata.resourceVersion,
    uid: object.metadata.uid,
    generation: object.metadata.generation,
    replicas: object.spec?.replicas,
    observedGeneration: object.status?.observedGeneration,
    carrierGrantId: carried?.grantId,
    objectHash: hash,
    hashChangedFromPrevious: previousHash === undefined ? true : previousHash !== hash,
    matchesGrant: grants.filter((grant) => grant.objectSha256 === hash).map((grant) => grant.grantId),
  });
  previousHash = hash;
}

const annotationOf = (event, suffix) =>
  Object.entries(event.annotations ?? {}).find(([key]) => key.endsWith(`/${suffix}`))?.[1];
const audit = lines(auditPath).map(tryParse).filter((event) => event && annotationOf(event, "grant-id") !== undefined)
  .map((event) => ({
    auditID: event.auditID,
    grantId: annotationOf(event, "grant-id"),
    admissionUid: annotationOf(event, "admission-uid"),
    outcome: annotationOf(event, "outcome"),
    code: event.responseStatus?.code,
    isDryRun: /[?&]dryRun=/.test(event.requestURI ?? ""),
    storedResourceVersion: event.responseObject?.kind === "Deployment" ? event.responseObject.metadata?.resourceVersion : undefined,
  }));

const evidence = { grants, useState: uses, audit, watchEvents };
writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n");

const real = watchEvents.filter((event) => event.uid !== undefined);
console.log(`watch events: ${watchEvents.length} received (${real.length} Deployment, ${watchEvents.length - real.length} bookmark/other)`);
console.log("type | rv | replicas | observedGen | carrier grant | hash changed | matches grant");
for (const event of real) {
  console.log([
    event.type, event.resourceVersion, event.replicas, event.observedGeneration ?? "-",
    event.carrierGrantId === undefined ? "-" : event.carrierGrantId.slice(0, 10),
    event.hashChangedFromPrevious ? "yes" : "no",
    event.matchesGrant.length === 0 ? "-" : event.matchesGrant.map((id) => id.slice(0, 10)).join(","),
  ].join(" | "));
}
for (const grant of grants) {
  const named = real.filter((event) => event.carrierGrantId === grant.grantId);
  const hashed = real.filter((event) => event.matchesGrant.includes(grant.grantId));
  const consumed = uses.find((row) => row.grant_id === grant.grantId);
  const auditConsumed = audit.find((event) => event.grantId === grant.grantId && event.outcome === "allow-consumed");
  console.log(`grant ${grant.grantId.slice(0, 10)}: consumed by ${consumed?.admission_uid ?? "(none)"}; ` +
    `audit consuming event code ${auditConsumed?.code ?? "-"} stored rv ${auditConsumed?.storedResourceVersion ?? "-"}; ` +
    `watch events naming it: ${named.length}; watch events matching its target hash: ${hashed.length}` +
    (hashed[0] ? ` (first at rv ${hashed[0].resourceVersion})` : ""));
}
