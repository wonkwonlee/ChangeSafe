import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  FailureModeSchema,
  ScenarioExpectationsSchema,
  type FailureMode,
  type ScenarioExpectations,
} from "@changesafe/core";

import { UsageError, parseOrThrow, readJsonFile } from "./io";
import { EXIT_BLOCKED, EXIT_OK, paint, type Console } from "./output";

export interface GalleryOptions {
  dir: string;
  out: string;
  /** Fail instead of writing when the file on disk is out of date. */
  check: boolean;
  format: "pretty" | "json";
}

interface GalleryEntry {
  scenarioId: string;
  domainId: string;
  title: string;
  summary: string;
  expectations: ScenarioExpectations;
}

const RISK_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/**
 * The corpus, rendered.
 *
 * Generated rather than hand-written because a gallery that drifts from the
 * scenarios is worse than none: it would advertise coverage the suite does
 * not have. `--check` makes staleness a CI failure, so the document can only
 * ever describe what is actually there.
 */
export function runGallery(options: GalleryOptions, console: Console): number {
  const root = path.resolve(options.dir);
  if (!existsSync(root)) throw new UsageError(`scenario directory does not exist: ${root}`);

  const entries = findScenarioDirs(root)
    .sort()
    .map((dir) => readEntry(dir, root));

  if (entries.length === 0) throw new UsageError(`no scenarios found in ${root}`);

  const markdown = render(entries);

  if (options.format === "json") {
    console.out(
      JSON.stringify(
        {
          scenarios: entries.length,
          coverage: coverage(entries),
          adversarial: entries.filter((e) => e.expectations.corpus.adversarial).length,
        },
        null,
        2,
      ),
    );
    return EXIT_OK;
  }

  if (options.check) {
    const current = existsSync(options.out) ? readFileSync(options.out, "utf8") : "";
    if (current === markdown) {
      console.out("");
      console.out(`  ${paint(console.color, "green", "gallery is current")} ${paint(console.color, "dim", `· ${entries.length} scenarios`)}`);
      console.out("");
      return EXIT_OK;
    }
    console.out("");
    console.out(`  ${paint(console.color, "red", "gallery is out of date")}`);
    console.out(`  ${paint(console.color, "dim", `regenerate it: changesafe scenario gallery --out ${options.out}`)}`);
    console.out("");
    return EXIT_BLOCKED;
  }

  writeFileSync(options.out, markdown);
  console.out("");
  console.out(
    `  ${paint(console.color, "green", "wrote")} ${options.out} ${paint(console.color, "dim", `· ${entries.length} scenarios`)}`,
  );
  console.out("");
  return EXIT_OK;
}

/**
 * Scenario directories live either directly under `root` or one level down,
 * grouped by domain (`scenarios/network/scenario-a-failover`). Two levels
 * covers every layout this repository uses without an unbounded walk.
 */
function findScenarioDirs(root: string): string[] {
  const topLevel = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const leaves: string[] = [];
  for (const name of topLevel) {
    const full = path.join(root, name);
    if (existsSync(path.join(full, "expectations.json"))) {
      leaves.push(full);
      continue;
    }
    const nested = readdirSync(full, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const nestedName of nested) {
      const nestedFull = path.join(full, nestedName);
      if (existsSync(path.join(nestedFull, "expectations.json"))) {
        leaves.push(nestedFull);
      }
    }
  }
  return leaves;
}

function readEntry(dir: string, root: string): GalleryEntry {
  const expectations = parseOrThrow(
    ScenarioExpectationsSchema,
    readJsonFile(path.join(dir, "expectations.json"), "expectations"),
    "expectations",
  );
  // The input file is shaped however the domain shapes it (an incident
  // bundle, a Terraform plan, a Kubernetes snapshot) and most of those carry
  // no human-facing title or summary, so an optional sibling `meta.json`
  // supplies one without pretending the input file is something it is not.
  const incident = readJsonFile(path.join(dir, "incident.json"), "incident bundle") as {
    title?: unknown;
    summary?: unknown;
  };
  const metaPath = path.join(dir, "meta.json");
  const meta = existsSync(metaPath)
    ? (readJsonFile(metaPath, "scenario meta") as { title?: unknown; summary?: unknown })
    : {};
  const domainId = path.dirname(dir) === root ? "network" : path.basename(path.dirname(dir));
  return {
    scenarioId: expectations.scenarioId,
    domainId,
    title:
      (typeof meta.title === "string" && meta.title) ||
      (typeof incident.title === "string" && incident.title) ||
      expectations.scenarioId,
    summary:
      (typeof meta.summary === "string" && meta.summary) ||
      (typeof incident.summary === "string" && incident.summary) ||
      "",
    expectations,
  };
}

function coverage(entries: GalleryEntry[]): Record<FailureMode, string[]> {
  const byMode = {} as Record<FailureMode, string[]>;
  for (const mode of FailureModeSchema.options) byMode[mode] = [];
  for (const entry of entries) {
    for (const mode of entry.expectations.corpus.failureModes) {
      byMode[mode].push(entry.scenarioId);
    }
  }
  return byMode;
}

function outcome(entry: GalleryEntry): string {
  if (!entry.expectations.approvable) return "blocked by the gate";
  if (entry.expectations.simulation?.safetyPropertiesSatisfied === false) {
    return "approvable, flagged by simulation";
  }
  return "approvable";
}

function render(entries: GalleryEntry[]): string {
  const lines: string[] = [];
  const adversarial = entries.filter((e) => e.expectations.corpus.adversarial);

  lines.push("# Scenario gallery");
  lines.push("");
  lines.push(
    "<!-- Generated by `changesafe scenario gallery`. Do not edit by hand; CI checks it is current. -->",
  );
  lines.push("");
  lines.push(
    `${entries.length} scenarios, ${adversarial.length} of them adversarial. Every entry declares its expected verdict in an \`expectations.json\` that CI verifies against the real engine, so nothing here is a claim — it is a test result.`,
  );
  lines.push("");
  lines.push("Contributing a scenario is the most valuable way in: see [SCENARIO_AUTHORING.md](SCENARIO_AUTHORING.md).");
  lines.push("");

  lines.push("## By outcome");
  lines.push("");
  lines.push("| Scenario | Domain | Incident | Risk | Outcome |");
  lines.push("| --- | --- | --- | --- | --- |");
  const sorted = [...entries].sort(
    (a, b) =>
      RISK_ORDER.indexOf(a.expectations.riskLevel) - RISK_ORDER.indexOf(b.expectations.riskLevel) ||
      a.scenarioId.localeCompare(b.scenarioId),
  );
  for (const entry of sorted) {
    lines.push(
      `| \`${entry.scenarioId}\` | ${entry.domainId} | ${entry.title} | ${entry.expectations.riskLevel} | ${outcome(entry)} |`,
    );
  }
  lines.push("");

  lines.push("## Failure-mode coverage");
  lines.push("");
  lines.push(
    "What the corpus currently exercises. An empty row is a gap worth contributing — the taxonomy is closed, so a mode listed here with no scenario is a known hole rather than an oversight.",
  );
  lines.push("");
  lines.push("| Failure mode | Scenarios |");
  lines.push("| --- | --- |");
  for (const [mode, ids] of Object.entries(coverage(entries))) {
    lines.push(
      `| \`${mode}\` | ${ids.length === 0 ? "— *(gap)*" : ids.map((id) => `\`${id}\``).join(", ")} |`,
    );
  }
  lines.push("");

  lines.push("## What each scenario teaches");
  lines.push("");
  for (const entry of sorted) {
    lines.push(`### \`${entry.scenarioId}\``);
    lines.push("");
    lines.push(`**${entry.title}** — ${entry.summary}`);
    lines.push("");
    lines.push(entry.expectations.teaches);
    lines.push("");
    const modes = entry.expectations.corpus.failureModes;
    lines.push(
      `- Risk **${entry.expectations.riskLevel}**, ${outcome(entry)}` +
        (entry.expectations.corpus.adversarial ? " · adversarial" : ""),
    );
    if (modes.length > 0) {
      lines.push(`- Failure modes: ${modes.map((mode) => `\`${mode}\``).join(", ")}`);
    }
    const nonPassing = Object.entries(entry.expectations.policies).filter(
      ([, status]) => status !== "PASS",
    );
    lines.push(
      nonPassing.length === 0
        ? "- Every policy passes"
        : `- Non-passing policies: ${nonPassing.map(([id, status]) => `\`${id}\` ${status}`).join(", ")}`,
    );
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
