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

/**
 * Findings quote the change under review — `UNTRUSTED_INSTRUCTION` embeds the
 * matched excerpt of a pull request body verbatim, which is exactly the text
 * an attacker controls. Rendered raw, a `|` opens new table cells and a
 * newline opens a new row, so the flagged content could forge a passing
 * verdict inside ChangeSafe's own comment. Neutralize the characters that
 * carry table structure; everything else may render as it likes.
 */
function cell(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .replace(/</g, "&lt;");
}

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
    `domain \`${cell(result.domain)}\``,
);
lines.push("");
lines.push("| | Policy | Finding |");
lines.push("| --- | --- | --- |");
for (const finding of result.findings) {
  const detail =
    finding.status === "PASS"
      ? cell(finding.title)
      : `**${cell(finding.title)}** — ${cell(finding.explanation)}`;
  lines.push(`| ${ICON[finding.status]} | \`${cell(finding.policyId)}\` | ${detail} |`);
}
lines.push("");

const actionable = result.findings.filter((finding) => finding.remediation);
if (actionable.length > 0) {
  lines.push("<details><summary>What to do</summary>");
  lines.push("");
  for (const finding of actionable) {
    lines.push(`- \`${cell(finding.policyId)}\`: ${cell(finding.remediation)}`);
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
