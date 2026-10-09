#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Downloads are explicit setup, never part of the default offline test run.
const digest = "7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d";
const jar = process.env.TLA2TOOLS_JAR;
if (!jar) throw new Error("Set TLA2TOOLS_JAR to the pinned v1.8.0 jar; see verification/authorization/README.md");
if (createHash("sha256").update(readFileSync(jar)).digest("hex") !== digest) {
  throw new Error("Unexpected TLC jar SHA-256; refusing to validate with an unpinned checker");
}
const root = path.resolve(import.meta.dirname, "..");
const model = path.join(root, "verification/authorization");
const output = path.resolve(process.env.CHANGESAFE_MODEL_RESULTS ?? path.join(root, "artifacts/authorization"));
mkdirSync(output, { recursive: true });
const cases = [
  ["protected", null], ["default", null],
  ["broken-restart", "AtMostOnce"], ["broken-retry", "OneIdentityPerReview"],
  ["broken-object", "ExactAuthorization"], ["broken-storage", "ConsumptionBeforeAllow"],
  ["broken-dry-run", "NoDryRunConsumption"], ["default-overclaim", "NoAdmissionWithoutGrant"],
];
const results = [];
for (const [name, invariant] of cases) {
  const work = mkdtempSync(path.join(tmpdir(), "changesafe-tlc-"));
  try {
    const run = spawnSync("java", ["-Xmx512m", "-XX:+UseParallelGC", "-cp", path.resolve(jar), "tlc2.TLC",
      "-noGenerateSpecTE", "-workers", "1", "-seed", "1", "-metadir", work,
      "-config", path.join(model, `${name}.cfg`), path.join(model, "Authorization.tla")],
    { cwd: model, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    const log = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    writeFileSync(path.join(output, `${name}.txt`), log);
    const expected = invariant === null
      ? run.status === 0 && log.includes("Model checking completed. No error has been found.")
      : run.status === 12 && log.includes(`Invariant ${invariant} is violated.`)
        && log.includes("The behavior up to this point is:");
    if (run.error || !expected) throw new Error(`Unexpected ${name} result (exit ${run.status}); inspect ${path.join(output, `${name}.txt`)}`);
    const states = /([\d,]+) states generated, ([\d,]+) distinct states found/.exec(log)?.slice(1);
    if (!states) throw new Error(`No explored-state evidence for ${name}`);
    results.push({ case: name, expectedInvariantViolation: invariant, exitCode: run.status,
      configSha256: createHash("sha256").update(readFileSync(path.join(model, `${name}.cfg`))).digest("hex"), states });
    console.log(`${name}: ${invariant ? `expected counterexample (${invariant})` : "bounded safety invariants hold"}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}
const record = {
  checker: "tla2tools v1.8.0", checkerSha256: digest,
  modelSha256: createHash("sha256").update(readFileSync(path.join(model, "Authorization.tla"))).digest("hex"),
  results,
};
writeFileSync(path.join(output, "results.json"), JSON.stringify(record, null, 2) + "\n");
if (process.argv.includes("--check-snapshot")) {
  const snapshot = JSON.parse(readFileSync(path.join(model, "results/results.json"), "utf8"));
  if (snapshot.modelSha256 !== record.modelSha256 || snapshot.checkerSha256 !== digest ||
    JSON.stringify(snapshot.results) !== JSON.stringify(results)) {
    throw new Error("Checked-in model result snapshot is stale; reproduce and update it from the fresh logs");
  }
}
