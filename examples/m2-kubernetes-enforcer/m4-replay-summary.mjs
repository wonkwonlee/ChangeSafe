// M4 experiment 06 (docs/M4_EXPERIMENT_06.md): summarize what the API
// server answered when asked to replay (or list) from a recorded version.
// Observes only; hypotheses are decided in the experiment note.
//
// usage: node m4-replay-summary.mjs <dir> <step1-grant.json> <m4-grant.json> \
//          <enforcer-dist-index.js> <readBeforeStep1> <out.json> [dryRunVersion]
// <dir> holds replay-<name>.jsonl (stdout+stderr of each bounded request).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [dir, grant1Path, grant2Path, hashModule, priorRv, outPath, dryRunVersion] = process.argv.slice(2);
const { kubernetesObjectSha256 } = await import(pathToFileURL(hashModule).href);
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const grants = [json(grant1Path).grant, json(grant2Path).grant].map((grant) => ({
  grantId: grant.grantId, objectSha256: grant.objectSha256,
}));
const carrierOf = (object) => {
  const raw = object?.metadata?.annotations?.["changesafe.dev/grant"];
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")).grant?.grantId;
  } catch { return undefined; }
};

async function describe(name) {
  const file = path.join(dir, `replay-${name}.jsonl`);
  if (!existsSync(file)) return { name, missing: true };
  const text = readFileSync(file, "utf8");
  const events = [];
  const other = [];
  for (const line of text.split("\n").filter(Boolean)) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { other.push(line.slice(0, 300)); continue; }
    // JSON that is not an object (null, a number, a quoted string) is not an
    // event; treat it as the non-event text it is rather than dereferencing.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) { other.push(line.slice(0, 300)); continue; }
    if (parsed.type === undefined && parsed.kind === "DeploymentList") {
      for (const item of parsed.items ?? []) events.push({ type: "LIST-ITEM", object: item });
      events.push({ type: "LIST-META", object: { metadata: parsed.metadata } });
    } else if (parsed.type === undefined) {
      other.push(line.slice(0, 300));
    } else events.push(parsed);
  }
  const rows = [];
  // kubectl reports a refused request as text on stderr ("Error from server
  // (Expired): too old resource version"), merged into this file. Without a
  // status row, "the server refused" and "the server had nothing" would both
  // read as zero events; keep the text AND add an explicit unavailable row.
  for (const line of other) {
    if (/^Error from server|Expired|\b410\b|too old resource version|\bGone\b/i.test(line)) {
      rows.push({ type: "ERROR", status: { code: null, reason: "kubectl-error-text", message: line.slice(0, 160) } });
    }
  }
  for (const event of events) {
    const object = event.object ?? {};
    if (object.kind === "Deployment") {
      const hash = await kubernetesObjectSha256(object);
      rows.push({
        type: event.type, resourceVersion: object.metadata.resourceVersion, replicas: object.spec?.replicas,
        carrierGrantId: carrierOf(object), objectHash: hash,
        matchesGrant: grants.filter((grant) => grant.objectSha256 === hash).map((grant) => grant.grantId),
      });
    } else if (event.type === "ERROR" || object.kind === "Status") {
      rows.push({ type: event.type, status: { code: object.code, reason: object.reason, message: object.message?.slice(0, 160) } });
    } else {
      rows.push({ type: event.type, resourceVersion: object.metadata?.resourceVersion });
    }
  }
  // The object's version just before and just after the request, when the
  // harness recorded them: equal values mean nothing moved meanwhile.
  const readMarker = (suffix) => {
    const markerPath = path.join(dir, `replay-${name}.${suffix}`);
    return existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() || null : null;
  };
  return { name, rows, other, objectVersionBefore: readMarker("before"), objectVersionAfter: readMarker("after") };
}

const results = [];
for (const name of ["replay", "replay-prior", "ancient", "any", "list"]) results.push(await describe(name));
const evidence = { readBeforeStep1: priorRv, dryRunVersion: dryRunVersion || null, grants, results };
writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n");

console.log(`version read before step 1: ${priorRv}`);
console.log(`version the dry-run's response carried (stand-in for a recorded oldObject version): ${dryRunVersion || "(none found)"}`);
for (const result of results) {
  if (result.missing) { console.log(`${result.name}: no output`); continue; }
  // A request that produced no events and only non-event text did not
  // return an empty history; say so, so a skim of the transcript cannot
  // read refusal as emptiness.
  const unavailable = result.other.length > 0 && !result.rows.some((row) => row.resourceVersion !== undefined && row.type !== "ERROR");
  console.log(`${result.name}: ${unavailable ? "UNAVAILABLE (no events; the request was refused or failed)" : `${result.rows.length} event(s)`}` +
    `${result.other.length ? `, ${result.other.length} non-JSON line(s)` : ""}` +
    `${result.objectVersionBefore !== null ? `, object version ${result.objectVersionBefore} -> ${result.objectVersionAfter}` : ""}`);
  for (const row of result.rows) {
    console.log("  " + [
      row.type, row.resourceVersion ?? "-", row.replicas ?? "-",
      row.carrierGrantId ? `carrier ${row.carrierGrantId.slice(0, 10)}` : "-",
      row.matchesGrant?.length ? `matches ${row.matchesGrant.map((id) => id.slice(0, 10)).join(",")}` : "-",
      row.status ? `status ${row.status.code} ${row.status.reason} ${row.status.message ?? ""}` : "",
    ].join(" | "));
  }
  for (const line of result.other) console.log(`  raw: ${line}`);
}
