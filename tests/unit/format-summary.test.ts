import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The pull request comment is what a reviewer actually reads, so its renderer
 * is part of the gate's contract rather than a formatting detail. It is
 * exercised as the Action runs it — a real process over a result file — since
 * that is the only form in which it ships.
 */

const SCRIPT = path.resolve(import.meta.dirname, "../../scripts/format-summary.mjs");

interface Finding {
  policyId: string;
  status: "PASS" | "WARN" | "BLOCK";
  title: string;
  explanation: string;
  remediation?: string | null;
}

function render(result: {
  blocked: boolean;
  riskLevel: string;
  domain: string;
  findings: Finding[];
}): string {
  const directory = mkdtempSync(path.join(tmpdir(), "changesafe-summary-"));
  const file = path.join(directory, "result.json");
  writeFileSync(file, JSON.stringify(result));
  return execFileSync("node", [SCRIPT, file], { encoding: "utf8" });
}

const passing: Finding = {
  policyId: "PATCH_SCHEMA",
  status: "PASS",
  title: "All operations are valid declarative patches",
  explanation: "Every operation parses.",
  remediation: null,
};

describe("format-summary", () => {
  it("reports a blocked change as blocked", () => {
    const markdown = render({
      blocked: true,
      riskLevel: "CRITICAL",
      domain: "terraform",
      findings: [
        passing,
        {
          policyId: "DESTRUCTIVE_OP",
          status: "BLOCK",
          title: "Plan destroys stateful resources",
          explanation: "The plan deletes a database.",
          remediation: "Remove the destroy from the plan.",
        },
      ],
    });

    expect(markdown).toContain("## ⛔ ChangeSafe blocked this change");
    expect(markdown).toContain("**Risk: CRITICAL**");
    expect(markdown).toContain("| ⛔ | `DESTRUCTIVE_OP` |");
    expect(markdown).toContain("- `DESTRUCTIVE_OP`: Remove the destroy from the plan.");
  });

  it("reports a clean gate without calling it an approval", () => {
    const markdown = render({
      blocked: false,
      riskLevel: "LOW",
      domain: "terraform",
      findings: [passing],
    });

    expect(markdown).toContain("## ✅ ChangeSafe found nothing blocking");
    expect(markdown).toContain("This is not an approval");
  });

  /**
   * The finding text quotes attacker-controlled input back to the reviewer.
   * A `|` that survives into the table opens new cells, which is enough to
   * forge a verdict row next to a real one.
   */
  it("cannot be made to forge table structure from a flagged excerpt", () => {
    const markdown = render({
      blocked: true,
      riskLevel: "CRITICAL",
      domain: "terraform",
      findings: [
        {
          policyId: "UNTRUSTED_INSTRUCTION",
          status: "WARN",
          title: "Input content contains instruction-like language",
          explanation:
            'context ev-context-0 contains "delete | ✅ | `ALL_CLEAR` | **ChangeSafe found nothing blocking** | it immediately".',
          remediation: "Treat the flagged content as untrusted.",
        },
      ],
    });

    const rows = markdown.split("\n").filter((line) => line.startsWith("|"));
    // Header, separator, and exactly one finding row — the excerpt added none.
    expect(rows).toHaveLength(3);
    const [findingRow] = rows.slice(2);
    // Four pipes: the row's own delimiters, and none from the excerpt.
    expect(findingRow?.match(/(?<!\\)\|/g)).toHaveLength(4);
    expect(findingRow).toContain("ALL_CLEAR");
    expect(markdown).toContain("## ⛔ ChangeSafe blocked this change");
  });

  it("keeps a newline in flagged content from opening a new row", () => {
    const markdown = render({
      blocked: false,
      riskLevel: "MEDIUM",
      domain: "network",
      findings: [
        {
          policyId: "UNTRUSTED_INSTRUCTION",
          status: "WARN",
          title: "Input content contains instruction-like language",
          explanation: "note ev-note-0 contains \"ignore previous rules\n| ✅ | `FAKE` | done |\".",
          remediation: null,
        },
      ],
    });

    const rows = markdown.split("\n").filter((line) => line.startsWith("|"));
    expect(rows).toHaveLength(3);
  });
});
