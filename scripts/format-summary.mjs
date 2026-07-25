#!/usr/bin/env node
/**
 * Render a gate result as Markdown for a pull request comment and the job
 * summary. Kept dependency-free so the Action needs no install beyond the
 * CLI bundle it already builds.
 */
import { readFileSync } from "node:fs";

const [, , resultPath] = process.argv;
if (!resultPath) {
  console.error("usage: format-summary.mjs <gate-result.json>");
  process.exit(2);
}

const result = JSON.parse(readFileSync(resultPath, "utf8"));

const ICON = { PASS: "✅", WARN: "⚠️", BLOCK: "⛔" };
const RISK_NOTE = {
  LOW: "no warnings",
  MEDIUM: "one warning",
  HIGH: "multiple warnings",
  CRITICAL: "at least one blocking finding",
};

const counts = { PASS: 0, WARN: 0, BLOCK: 0 };
for (const finding of result.findings) counts[finding.status] += 1;

const lines = [];
lines.push("<!-- changesafe-gate -->");
lines.push(
  result.blocked
    ? "## ⛔ ChangeSafe blocked this change"
    : "## ✅ ChangeSafe found nothing blocking",
);
lines.push("");
lines.push(
  `**Risk: ${result.riskLevel}** (${RISK_NOTE[result.riskLevel]}) · ` +
    `${counts.PASS} pass · ${counts.WARN} warn · ${counts.BLOCK} block · ` +
    `domain \`${result.domain}\``,
);
lines.push("");
lines.push("| | Policy | Finding |");
lines.push("| --- | --- | --- |");
for (const finding of result.findings) {
  const detail =
    finding.status === "PASS"
      ? finding.title
      : `**${finding.title}** — ${finding.explanation}`;
  lines.push(`| ${ICON[finding.status]} | \`${finding.policyId}\` | ${detail} |`);
}
lines.push("");

const actionable = result.findings.filter((finding) => finding.remediation);
if (actionable.length > 0) {
  lines.push("<details><summary>What to do</summary>");
  lines.push("");
  for (const finding of actionable) {
    lines.push(`- \`${finding.policyId}\`: ${finding.remediation}`);
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
}

lines.push(
  result.blocked
    ? "_A blocking finding cannot be approved by this check. Change the plan, or lift the block deliberately in a separate reviewed change._"
    : "_Nothing blocked. This is not an approval — the review on this pull request is the human decision._",
);

console.log(lines.join("\n"));
