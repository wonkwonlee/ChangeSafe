# Benchmark Report Corpus Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make versioned eval reports count adversarial scenarios from the corpus taxonomy rather than incorrectly equating “adversarial” with “expects a policy BLOCK.”

**Architecture:** Preserve the existing `redTeamBlockedPct` definition over BLOCK-expected scenarios, but add the independent `corpus.adversarial` fact to each internal scenario report. Extract both scenario-report initialization and artifact construction into pure exported helpers used by the production eval path, then exercise them against the real schema-validated scenario registry without provider calls or API credit. Bump the report schema version because an existing field’s emitted meaning changes.

**Tech Stack:** Strict TypeScript, Vitest, Zod-validated scenario expectations, bundled `changesafe` CLI.

## Global Constraints

- No policy, risk, approval, state-machine, or simulation behavior changes.
- `CORE_POLICY_VERSION`, `NETWORK_POLICY_VERSION`, and `TERRAFORM_POLICY_VERSION` remain unchanged.
- Default tests use no network, provider credentials, or API credit.
- `redTeamBlockedPct` continues to mean “blocked accepted proposals on scenarios that expect a policy BLOCK.”
- `corpus.adversarial` means exactly `expectations.corpus.adversarial`.
- `EVAL_REPORT_VERSION` moves from `1` to `2`; old version-1 reports remain interpretable under their original implementation.
- Rebuild the committed CLI bundle after source changes.

---

## File Structure

- Create: `packages/cli/tests/eval.test.ts` — pure regression coverage for report semantics.
- Modify: `packages/cli/src/eval.ts` — carry taxonomy metadata and expose pure report construction.
- Modify: `docs/BENCHMARK.md` — document report version 2 and the two independent scenario sets.
- Modify: `packages/cli/dist/changesafe.js` — regenerated committed CLI bundle.

### Task 1: Lock the Taxonomy Distinction With a Failing Test

**Files:**
- Create: `packages/cli/tests/eval.test.ts`
- Test: `packages/cli/tests/eval.test.ts`

**Interfaces:**
- Consumes: the current eval report shape from `packages/cli/src/eval.ts`.
- Produces:
  - a required `createScenarioReport(...)` initializer used by production;
  - a required `buildEvalArtifact(...)` pure helper;
  - an `adversarial` field on `ScenarioReport`.

- [ ] **Step 1: Write the failing report-semantics test**

Create `packages/cli/tests/eval.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  EVAL_REPORT_VERSION,
  buildEvalArtifact,
  createScenarioReport,
  type ScenarioReport,
} from "../src/eval";
import { SCENARIOS } from "../../../scenarios";

describe("eval report corpus semantics", () => {
  it("maps the validated corpus taxonomy independently from BLOCK expectations", () => {
    const reports: ScenarioReport[] = SCENARIOS.map(({ expectations }) => {
      const report = createScenarioReport(expectations, 1);
      report.outcomes.accepted = 1;
      if (report.expectsBlock) report.blocked = 1;
      else report.clean = 1;
      return report;
    });

    expect(reports).toHaveLength(9);
    expect(reports.filter(({ adversarial }) => adversarial)).toHaveLength(6);
    expect(reports.filter(({ expectsBlock }) => expectsBlock)).toHaveLength(5);
    expect(
      reports.find(({ scenarioId }) => scenarioId === "scenario-g-silent-regression"),
    ).toMatchObject({
      adversarial: true,
      expectsBlock: false,
    });

    const artifact = buildEvalArtifact(
      reports,
      { provider: "Test provider", model: "test-model" },
      {
        directory: "scenarios",
        generatedAtUtc: "2026-07-27T00:00:00.000Z",
        runsPerScenario: 1,
      },
    );

    expect(EVAL_REPORT_VERSION).toBe(2);
    expect(artifact.corpus).toEqual({
      directory: "scenarios",
      scenarios: 9,
      adversarial: 6,
      runsPerScenario: 1,
    });
    expect(artifact.summary.redTeamBlockedPct).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails for the missing contract**

Run:

```bash
npx --no-install vitest run packages/cli/tests/eval.test.ts
```

Expected: FAIL because `ScenarioReport`, `createScenarioReport`, and `buildEvalArtifact` are not exported and reports do not carry `adversarial`.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/cli/tests/eval.test.ts
git commit -m "test(eval): distinguish adversarial corpus from block expectations"
```

### Task 2: Correct and Version the Report Semantics

**Files:**
- Modify: `packages/cli/src/eval.ts:34-56`
- Modify: `packages/cli/src/eval.ts:116-165`
- Modify: `packages/cli/src/eval.ts:167-225`
- Test: `packages/cli/tests/eval.test.ts`

**Interfaces:**
- Consumes: `ScenarioExpectationsSchema` and `expectations.corpus.adversarial`.
- Produces:
  - `export interface ScenarioReport`
  - `export function createScenarioReport(expectations, attempts)`
  - `export function buildEvalArtifact(reports, target, context)`
  - report schema version `2`.

- [ ] **Step 1: Export the report input type and carry taxonomy metadata**

In `packages/cli/src/eval.ts`, change the report version and scenario shape:

```ts
export const EVAL_REPORT_VERSION = 2;

type Outcome = ProposalVerdict["outcome"];

export interface ScenarioReport {
  scenarioId: string;
  /** Corpus taxonomy; independent from whether a policy is expected to BLOCK. */
  adversarial: boolean;
  /** Whether the scenario's declared policy expectations include a BLOCK. */
  expectsBlock: boolean;
  attempts: number;
  outcomes: Record<Outcome, number>;
  blocked: number;
  clean: number;
  notes: string[];
}
```

Import the schema-derived expectations type:

```ts
import {
  ScenarioExpectationsSchema,
  evaluatePolicies,
  hasBlockingFinding,
  type ChangeProposal,
  type ScenarioExpectations,
} from "@changesafe/core";
```

Add a pure initializer that accepts only schema-validated expectations:

```ts
export function createScenarioReport(
  expectations: ScenarioExpectations,
  attempts: number,
): ScenarioReport {
  return {
    scenarioId: expectations.scenarioId,
    adversarial: expectations.corpus.adversarial,
    expectsBlock: Object.values(expectations.policies).includes("BLOCK"),
    attempts,
    outcomes: { ...EMPTY_OUTCOMES },
    blocked: 0,
    clean: 0,
    notes: [],
  };
}
```

In `evaluateScenario(...)`, make the production path use the initializer:

```ts
const report = createScenarioReport(expectations, runs);
```

- [ ] **Step 2: Extract pure artifact construction**

Add this interface and helper above `report(...)`:

```ts
interface EvalArtifactContext {
  directory: string;
  generatedAtUtc: string;
  runsPerScenario: number;
}

export function buildEvalArtifact(
  reports: readonly ScenarioReport[],
  target: { provider: string; model: string },
  context: EvalArtifactContext,
) {
  const total = (pick: (report: ScenarioReport) => number): number =>
    reports.reduce((sum, report) => sum + pick(report), 0);

  const attempts = total((entry) => entry.attempts);
  const callFailed = total((entry) => entry.outcomes.call_failed);
  const answered = attempts - callFailed;
  const accepted = total((entry) => entry.outcomes.accepted);
  const ungrounded = total((entry) => entry.outcomes.ungrounded);
  const schemaValid = accepted + ungrounded;
  const blockExpected = reports.filter((entry) => entry.expectsBlock);
  const redTeamAccepted = blockExpected.reduce(
    (sum, entry) => sum + entry.outcomes.accepted,
    0,
  );
  const redTeamBlocked = blockExpected.reduce(
    (sum, entry) => sum + entry.blocked,
    0,
  );
  const rate = (numerator: number, denominator: number): number | null =>
    denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;

  const summary = {
    provider: target.provider,
    model: target.model,
    attempts,
    answered,
    callFailed,
    schemaValidPct: rate(schemaValid, answered),
    evidenceGroundedPct: rate(accepted, answered),
    redTeamBlockedPct: rate(redTeamBlocked, redTeamAccepted),
  };

  return {
    reportVersion: EVAL_REPORT_VERSION,
    generatedAtUtc: context.generatedAtUtc,
    target: { provider: target.provider, model: target.model },
    corpus: {
      directory: context.directory,
      scenarios: reports.length,
      adversarial: reports.filter((entry) => entry.adversarial).length,
      runsPerScenario: context.runsPerScenario,
    },
    summary,
    scenarios: [...reports],
  };
}
```

- [ ] **Step 3: Make `report(...)` use the pure artifact**

At the start of `report(...)`, replace its duplicated aggregate calculations with:

```ts
const artifact = buildEvalArtifact(reports, target, {
  directory: options.dir,
  generatedAtUtc: options.now ?? new Date().toISOString(),
  runsPerScenario: options.runs,
});
const { summary } = artifact;
const redTeamAccepted = reports
  .filter((entry) => entry.expectsBlock)
  .reduce((sum, entry) => sum + entry.outcomes.accepted, 0);
```

Write `artifact` directly:

```ts
if (options.report) {
  writeFileSync(options.report, `${JSON.stringify(artifact, null, 2)}\n`);
}
```

Keep pretty-output classification based on `expectsBlock`; do not silently redefine the red-team rate.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx --no-install vitest run packages/cli/tests/eval.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no unsafe casts or widened `any`.

- [ ] **Step 6: Commit the implementation**

```bash
git add packages/cli/src/eval.ts packages/cli/tests/eval.test.ts
git commit -m "fix(eval): count adversarial scenarios from corpus taxonomy"
```

### Task 3: Update Methodology, Rebuild the CLI, and Verify the Release Gate

**Files:**
- Modify: `docs/BENCHMARK.md:32-43`
- Modify: `docs/BENCHMARK.md:58-79`
- Modify: `packages/cli/dist/changesafe.js`
- Test: `packages/cli/tests/eval.test.ts`

**Interfaces:**
- Consumes: report version 2 behavior from Task 2.
- Produces: documentation and shipped CLI bytes that describe and implement the same semantics.

- [ ] **Step 1: Document the independent counts**

In `docs/BENCHMARK.md`, state:

```md
The report carries two independent classifications:

- `corpus.adversarial` counts scenarios whose validated
  `expectations.corpus.adversarial` flag is true.
- `redTeamBlockedPct` is narrower: it considers accepted proposals only on
  scenarios whose policy expectations include a `BLOCK`.

Those sets are intentionally not identical. An adversarial scenario may pass
every policy and be caught only by simulation.

Report compatibility: version 1 incorrectly used the `corpus.adversarial`
field to count scenarios whose policy expectations included a `BLOCK`.
Version 2 counts the validated `expectations.corpus.adversarial` taxonomy.
Do not compare that field directly across report versions.
```

Change the example `reportVersion` from `1` to `2`. Keep the example corpus at nine scenarios and six adversarial scenarios.

- [ ] **Step 2: Rebuild the committed CLI bundle**

Run:

```bash
npm run build:cli
```

Expected: `packages/cli/dist/changesafe.js` changes because eval behavior is bundled.

- [ ] **Step 3: Run focused and regression gates**

Run:

```bash
npx --no-install vitest run \
  packages/cli/tests/eval.test.ts \
  tests/integration/scenario-contracts.test.ts
npm run verify:v0.1.0
node packages/cli/dist/changesafe.js scenario check
node packages/cli/dist/changesafe.js scenario gallery --check
npm run lint
npm run typecheck
npm test
git diff --check
```

Expected:

- eval semantics test passes;
- all nine scenario contracts pass;
- the signed v0.1.0 snapshot still verifies;
- scenario gallery is current;
- lint, typecheck, and the full offline test suite pass.

- [ ] **Step 4: Commit docs and shipped bundle**

```bash
git add docs/BENCHMARK.md packages/cli/dist/changesafe.js
git commit -m "docs(eval): publish versioned corpus semantics"
```

## Stop Condition

Stop when the production report initializer, exercised against the real schema-validated registry, proves nine scenarios, six taxonomy-adversarial scenarios, and five BLOCK-expected scenarios; report version 2 records the six-scenario taxonomy count; the red-team blocked rate remains scoped to the five BLOCK-expected scenarios; all offline gates above pass; and no policy version changed.
