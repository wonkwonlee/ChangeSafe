// M4 experiment 06 (docs/M4_EXPERIMENT_06.md): the resourceVersion the
// consuming admission saw, as far as the audit log can say. The enforcer
// does not record oldObject.resourceVersion today (proposal P3), but a
// dry-run of the same transition is answered with the version it read, and
// the enforcer annotates that event. Prints it, or nothing if the log holds
// no annotated dry-run response. This stands in for P3 and is labeled so
// wherever it is used.
//
// usage: node m4-prior-version.mjs <audit.log>
import { readFileSync } from "node:fs";

const [auditPath] = process.argv.slice(2);
for (const line of readFileSync(auditPath, "utf8").split("\n").filter(Boolean)) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  const annotated = Object.entries(event.annotations ?? {}).some(([key, value]) =>
    key.endsWith("/outcome") && value === "allow-dry-run");
  const version = event.responseObject?.metadata?.resourceVersion;
  if (annotated && typeof version === "string") {
    process.stdout.write(version);
    break;
  }
}
