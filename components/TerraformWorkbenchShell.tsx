"use client";

import { useCallback, useMemo, useState } from "react";

import { normalizePlan, type TerraformInput } from "@changesafe/domain-terraform";
import type { WorkflowState } from "@changesafe/core";

import { TERRAFORM_REVIEW_EXAMPLES } from "@/features/domains/terraform/examples";
import {
  TERRAFORM_PUBLIC_REPLAY_FIXTURES,
  type TerraformPublicReplayFixture,
} from "@/features/domains/terraform/fixtures";
import { publicReplayTransport } from "@/features/reviews/publicReplayTransport";
import { useReviewController } from "@/features/reviews/useReviewController";

const initialExample = TERRAFORM_REVIEW_EXAMPLES[0];
if (!initialExample) {
  throw new Error("The public Terraform workbench requires a bundled example");
}
const INITIAL_EXAMPLE = initialExample;

type ClassifiedWorkflow = Extract<
  WorkflowState<TerraformInput>,
  {
    phase:
      | "VALIDATED"
      | "BLOCKED"
      | "APPROVAL_REQUIRED"
      | "APPROVED"
      | "REJECTED"
      | "SIMULATED"
      | "RECEIPT_ISSUED";
  }
>;

function hasFindings(
  workflow: WorkflowState<TerraformInput>,
): workflow is ClassifiedWorkflow {
  return [
    "VALIDATED",
    "BLOCKED",
    "APPROVAL_REQUIRED",
    "APPROVED",
    "REJECTED",
    "SIMULATED",
    "RECEIPT_ISSUED",
  ].includes(workflow.phase);
}

function fixtureFor(sourceId: string): TerraformPublicReplayFixture {
  const fixture = TERRAFORM_PUBLIC_REPLAY_FIXTURES.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!fixture) {
    throw new Error(`Bundled Terraform fixture "${sourceId}" is unavailable`);
  }
  return fixture;
}

function exampleFor(sourceId: string) {
  const example = TERRAFORM_REVIEW_EXAMPLES.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!example) {
    throw new Error(`Terraform review example "${sourceId}" is unavailable`);
  }
  return example;
}

function inputFor(fixture: TerraformPublicReplayFixture): TerraformInput {
  return normalizePlan(fixture.plan, {
    planId: fixture.inputId,
    context: [...fixture.context],
  });
}

function initialSource() {
  const fixture = fixtureFor(INITIAL_EXAMPLE.sourceId);
  return {
    sourceId: fixture.sourceId,
    input: inputFor(fixture),
    expectedInputId: fixture.inputId,
    session: INITIAL_EXAMPLE.session,
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow text-ink-faint">{children}</p>;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-3 max-h-72 overflow-auto rounded border border-edge bg-canvas p-3 text-xs leading-relaxed text-ink-dim">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ActionBadge({ action }: { action: TerraformInput["changes"][number]["action"] }) {
  const tone = action === "delete" || action === "replace" ? "border-block/50 bg-block/10 text-block" : "border-active/50 bg-active/10 text-active";
  return <span className={`eyebrow rounded border px-2 py-1 ${tone}`}>{action}</span>;
}

function ReplayStatus({ state }: { state: WorkflowState<TerraformInput> }) {
  switch (state.phase) {
    case "ANALYZING":
      return "Terraform replay analysis is running.";
    case "ERROR":
      return "Terraform replay could not be evaluated. Choose Run replay to try again.";
    case "READY":
      return "Terraform replay is ready to evaluate.";
    case "BLOCKED":
      return "Terraform replay evaluated. Deterministic findings blocked this supplied plan.";
    default:
      return "Terraform replay evaluated through the deterministic gate.";
  }
}

function StateValue({ state }: { state: WorkflowState<TerraformInput> }) {
  switch (state.phase) {
    case "ANALYZING":
      return "Replay analysis is running against the supplied external diff.";
    case "ERROR":
      return state.userMessage;
    case "READY":
      return "Choose Run replay to evaluate this bundled Terraform plan.";
    default:
      return "Deterministic gate evaluation completed from the replay response.";
  }
}

function FindingsPanel({ state }: { state: WorkflowState<TerraformInput> }) {
  if (!hasFindings(state)) {
    return <p className="mt-3 text-sm text-ink-dim">Policy, reversibility, and untrusted-context evidence appear only after replay evaluation.</p>;
  }
  return (
    <ul className="mt-3 space-y-2" aria-label="Evaluated Terraform policy findings">
      {state.findings.map((finding) => (
        <li className="rounded border border-edge bg-canvas p-3 text-sm" key={finding.policyId}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs">{finding.policyId}</span>
            <span className="eyebrow rounded border border-edge px-2 py-1">{finding.status}</span>
          </div>
          <p className="mt-2 font-medium text-ink">{finding.title}</p>
          <p className="mt-1 text-ink-dim">{finding.explanation}</p>
          {finding.affectedResources.length > 0 ? <p className="mt-2 text-xs text-ink-faint">Affected: {finding.affectedResources.join(", ")}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function ProposalPanel({ state }: { state: WorkflowState<TerraformInput> }) {
  if (!hasFindings(state)) {
    return <p className="mt-3 text-sm text-ink-dim">No evaluated proposal is available yet.</p>;
  }
  return <JsonBlock value={state.proposal} />;
}

function DecisionPanel({ state }: { state: WorkflowState<TerraformInput> }) {
  if (state.phase === "BLOCKED") {
    return <p className="mt-3 rounded border border-block/50 bg-block/10 p-3 text-sm text-block">BLOCKED by deterministic findings. This supplied plan is unapprovable; public replay provides no override or decision control.</p>;
  }
  if (state.phase === "APPROVAL_REQUIRED") {
    return <p className="mt-3 text-sm text-ink-dim">The gate permits a human decision, but public replay intentionally provides no decision controls and stores no decision.</p>;
  }
  return <p className="mt-3 text-sm text-ink-dim">No decision has been made.</p>;
}

/**
 * Public, replay-only UI for supplied Terraform external diffs. The plan is
 * read-only evidence: this component neither runs Terraform nor asks the
 * domain to simulate a state transition.
 */
export function TerraformWorkbenchShell() {
  const controller = useReviewController<TerraformInput>({
    ...initialSource(),
    transport: publicReplayTransport,
  });
  const [selectedSourceId, setSelectedSourceId] = useState(INITIAL_EXAMPLE.sourceId);
  const fixture = useMemo(() => fixtureFor(selectedSourceId), [selectedSourceId]);
  const example = useMemo(() => exampleFor(selectedSourceId), [selectedSourceId]);
  const input = useMemo(() => inputFor(fixture), [fixture]);
  const workflow = controller.state.workflow;

  const selectExample = useCallback((sourceId: string) => {
    const nextFixture = fixtureFor(sourceId);
    const nextExample = exampleFor(sourceId);
    controller.rebind({
      sourceId: nextFixture.sourceId,
      input: inputFor(nextFixture),
      expectedInputId: nextFixture.inputId,
      session: nextExample.session,
    });
    setSelectedSourceId(sourceId);
  }, [controller]);

  const canRunReplay = workflow.phase === "READY" || workflow.phase === "ERROR";

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-edge bg-surface">
        <nav aria-label="Product navigation" className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
          <a className="mr-auto text-base font-bold tracking-tight text-ink" href="#review">ChangeSafe <span className="ml-2 text-xs font-normal text-ink-dim">infrastructure change airlock</span></a>
          <a className="inline-flex rounded-md px-3 py-2 text-sm text-ink-dim hover:text-ink" href="#sources">Sources</a>
        </nav>
      </header>

      <section className="border-b border-edge bg-overlay" aria-labelledby="runtime-title">
        <div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div>
            <p id="runtime-title" className="eyebrow text-ai">Public replay · Terraform external diff</p>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-dim">Inspect a schema-validated bundled Terraform plan through the deterministic gate. The supplied diff is read-only evidence: Terraform is not run, ChangeSafe simulation is unavailable, and this ephemeral surface cannot make or store a decision.</p>
          </div>
          <div role="group" aria-labelledby="runtime-variants-title" className="rounded-lg border border-edge bg-surface p-3">
            <p id="runtime-variants-title" className="eyebrow text-ink-faint">Runtime variant</p>
            <p className="mt-2 rounded border border-active/50 bg-active/10 px-3 py-2 text-sm text-active">Examples / public replay · available</p>
            <p className="mt-2 text-xs text-warn">External diff · no simulation · no durable review record</p>
          </div>
        </div>
      </section>

      <div id="review" className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(220px,0.75fr)_minmax(0,2fr)_minmax(280px,0.95fr)]">
        <aside aria-label="Terraform review context" className="min-w-0 rounded-xl border border-edge bg-surface p-4">
          <Label>Terraform examples</Label>
          <h1 className="mt-2 text-lg font-semibold">{fixture.label}</h1>
          <ul className="mt-4 grid gap-2" role="list" aria-label="Bundled Terraform examples">
            {TERRAFORM_REVIEW_EXAMPLES.map((candidate) => (
              <li key={candidate.sourceId}><button aria-pressed={candidate.sourceId === selectedSourceId} className="w-full rounded border border-edge px-3 py-2 text-left text-sm text-ink-dim hover:border-active focus:outline-none focus:ring-2 focus:ring-active disabled:cursor-wait" disabled={workflow.phase === "ANALYZING"} onClick={() => selectExample(candidate.sourceId)} type="button"><span className="block font-medium text-ink">{candidate.label}</span><span className="mt-1 block text-xs">{candidate.description}</span></button></li>
            ))}
          </ul>
          <section id="sources" className="mt-5 border-t border-edge pt-4" aria-labelledby="source-title">
            <h2 id="source-title" className="text-sm font-semibold">Supplied plan source</h2>
            <dl className="mt-3 grid gap-3 text-xs">
              <div><dt className="text-ink-faint">Plan ID</dt><dd className="mt-1 font-mono">{input.planId}</dd></div>
              <div><dt className="text-ink-faint">Fixture provenance</dt><dd className="mt-1">{fixture.provenance}</dd></div>
              <div><dt className="text-ink-faint">Terraform version</dt><dd className="mt-1 font-mono">{input.terraformVersion ?? "not declared"}</dd></div>
              <div><dt className="text-ink-faint">Policy version</dt><dd className="mt-1 font-mono">{example.session.policyVersion}</dd></div>
            </dl>
          </section>
        </aside>

        <main aria-busy={workflow.phase === "ANALYZING"} aria-label="Terraform review canvas" className="min-w-0 rounded-xl border border-edge bg-surface p-4 sm:p-6">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-edge pb-5">
            <div><Label>External-diff replay evaluation</Label><h2 className="mt-2 text-xl font-semibold">{workflow.phase}</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim"><StateValue state={workflow} /></p><p aria-atomic="true" aria-live="polite" className="sr-only" role="status"><ReplayStatus state={workflow} /></p></div>
            <button className="rounded bg-active px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!canRunReplay} onClick={() => void controller.analyze()} type="button">{workflow.phase === "ANALYZING" ? "Running replay…" : "Run replay"}</button>
          </header>

          <div className="mt-5 grid gap-4">
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="plan-title"><Label>Supplied Terraform plan</Label><h3 id="plan-title" className="mt-2 text-base font-semibold">{input.changes.length} actionable resource change{input.changes.length === 1 ? "" : "s"}</h3><p className="mt-2 text-sm text-ink-dim">Module, provider resource type, address, and before/after values are read from the bundled plan. No result is declared before the deterministic evaluation runs.</p></section>
            <section className="overflow-hidden rounded-lg border border-edge bg-raised" aria-labelledby="resources-title"><div className="p-4"><Label>Structured diff</Label><h3 id="resources-title" className="mt-2 text-base font-semibold">Resources and actions</h3></div><div className="overflow-x-auto"><table className="min-w-full border-collapse text-left text-xs"><thead className="border-y border-edge bg-surface text-ink-faint"><tr><th className="px-4 py-3 font-medium">Module</th><th className="px-4 py-3 font-medium">Type / address</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Before / after</th></tr></thead><tbody>{input.changes.map((change) => <tr className="border-b border-edge align-top" key={change.evidenceId}><td className="px-4 py-3 font-mono">{change.moduleAddress}</td><td className="px-4 py-3"><p className="font-mono text-ink">{change.resourceType}</p><p className="mt-1 font-mono text-ink-dim">{change.address}</p></td><td className="px-4 py-3"><ActionBadge action={change.action} />{change.action === "delete" || change.action === "replace" ? <p className="mt-2 text-ink-dim">Destructive plan action</p> : null}</td><td className="min-w-72 px-4 py-3"><details><summary className="cursor-pointer text-ink-dim">Inspect values</summary><p className="mt-2 text-ink-faint">Before</p><JsonBlock value={change.before} /><p className="mt-3 text-ink-faint">After</p><JsonBlock value={change.after} /></details></td></tr>)}</tbody></table></div></section>
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="context-title"><Label>Untrusted context</Label><h3 id="context-title" className="mt-2 text-base font-semibold">Bundled plan context</h3>{input.context.length === 0 ? <p className="mt-3 text-sm text-ink-dim">No untrusted context was supplied with this plan.</p> : <ul className="mt-3 space-y-2">{input.context.map((entry) => <li className="rounded border border-edge bg-canvas p-3 text-sm" key={entry.evidenceId}><p className="font-mono text-xs">{entry.evidenceId} · {entry.kind}</p><p className="mt-2 whitespace-pre-wrap text-ink-dim">{entry.text}</p></li>)}</ul>}</section>
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="proposal-title"><Label>Evaluated proposal</Label><h3 id="proposal-title" className="mt-2 text-base font-semibold">Replay result only</h3><ProposalPanel state={workflow} /></section>
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="findings-title"><Label>Deterministic findings</Label><h3 id="findings-title" className="mt-2 text-base font-semibold">Policy, reversibility, and context evidence</h3><FindingsPanel state={workflow} /></section>
          </div>
        </main>

        <aside aria-label="Terraform review authority" className="min-w-0 rounded-xl border border-edge bg-surface p-4">
          <Label>Airlock status</Label>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="risk-title"><h2 id="risk-title" className="text-sm font-semibold">Risk</h2><p className="mt-2 text-sm text-ink-dim">{hasFindings(workflow) ? workflow.riskLevel : "Not evaluated"}</p></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="decision-title"><h2 id="decision-title" className="text-sm font-semibold">Decision</h2><DecisionPanel state={workflow} /></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="simulation-title"><h2 id="simulation-title" className="text-sm font-semibold">Simulation</h2><p className="mt-2 text-sm text-ink-dim">Unavailable and not run. Terraform is an external-diff domain: the supplied plan is the read-only diff, not a sandbox state transition.</p></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="receipt-title"><h2 id="receipt-title" className="text-sm font-semibold">Receipt</h2><p className="mt-2 text-sm text-ink-dim">Not created. This ephemeral public replay has no durable decision or signed receipt.</p></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="execution-title"><h2 id="execution-title" className="text-sm font-semibold">Terraform execution</h2><p className="mt-2 text-sm text-ink-dim">Not performed or observed. ChangeSafe never runs Terraform or executes infrastructure changes.</p></section>
        </aside>
      </div>
    </div>
  );
}
