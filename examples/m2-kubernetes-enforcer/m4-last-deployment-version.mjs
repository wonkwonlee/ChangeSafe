// M4 experiment 05 (docs/M4_EXPERIMENT_05.md): the resourceVersion carried by
// the last Deployment event in a raw watch stream, or nothing. Only a
// Deployment event counts: a BOOKMARK or an ERROR status carries a version
// that is not the object's, and matching text anywhere in the file would
// let one of those stand for "the stream reached the object's version".
//
// usage: node m4-last-deployment-version.mjs <watch.jsonl>
import { readFileSync, existsSync } from "node:fs";

const [path] = process.argv.slice(2);
let last = "";
if (path && existsSync(path)) {
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (event?.object?.kind === "Deployment" && typeof event.object.metadata?.resourceVersion === "string") {
        last = event.object.metadata.resourceVersion;
      }
    } catch { /* a partial line at a kill */ }
  }
}
process.stdout.write(last);
