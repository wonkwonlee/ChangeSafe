"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TerraformInput } from "@changesafe/domain-terraform";
import type { WorkflowState } from "@changesafe/core";

import {
  BoundedJsonBlock,
  EvidencePager,
} from "@/components/BoundedEvidence";
import { CaseStudyBadge } from "@/components/CaseStudyBadge";
import { DiffBlock } from "@/components/DiffBlock";
import { DomainCoverageCatalog } from "@/components/DomainCoverageCatalog";
import { readScenarioLookup, useScenarioDeepLink } from "@/components/hooks/useScenarioDeepLink";
import { ActionBadge, FindingsList, PhasePill, RiskValue } from "@/components/StatusTone";
import { UnknownScenarioNotice } from "@/components/UnknownScenarioNotice";
import { WorkbenchNav } from "@/components/WorkbenchNav";
import { searchAndPageOfflineCollection } from "@/features/domains/presentation-limit";
import { TERRAFORM_REVIEW_EXAMPLES } from "@/features/domains/terraform/examples";
import type { LoadedDomainCoverageCatalog } from "@/features/domains/registry";
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

function initialSource() {
  const fixture = fixtureFor(INITIAL_EXAMPLE.sourceId);
  return {
    sourceId: fixture.sourceId,
    input: fixture.input,
    expectedInputId: fixture.inputId,
    session: INITIAL_EXAMPLE.session,
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow text-ink-faint">{children}</p>;
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
  return <FindingsList ariaLabel="Evaluated Terraform policy findings" findings={state.findings} />;
}

function ProposalPanel({ state }: { state: WorkflowState<TerraformInput> }) {
  if (!hasFindings(state)) {
    return <p className="mt-3 text-sm text-ink-dim">No evaluated proposal is available yet.</p>;
  }
  return <BoundedJsonBlock label="Terraform proposal JSON" value={state.proposal} />;
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
export function TerraformWorkbenchShell({
  coverageCatalog,
}: {
  readonly coverageCatalog: LoadedDomainCoverageCatalog;
}) {
  const controller = useReviewController<TerraformInput>({
    ...initialSource(),
    transport: publicReplayTransport,
  });
  const [selectedSourceId, setSelectedSourceId] = useState(INITIAL_EXAMPLE.sourceId);
  const fixture = useMemo(() => fixtureFor(selectedSourceId), [selectedSourceId]);
  const example = useMemo(() => exampleFor(selectedSourceId), [selectedSourceId]);
  const input = fixture.input;
  const workflow = controller.state.workflow;
  const outcomeHeadingRef = useRef<HTMLSpanElement>(null);
  const { setScenarioInUrl } = useScenarioDeepLink();
  const [changeQuery, setChangeQuery] = useState("");
  const [changePageIndex, setChangePageIndex] = useState(0);
  const changePage = useMemo(
    () =>
      searchAndPageOfflineCollection(
        input.changes,
        changeQuery,
        (change) => JSON.stringify(change),
        changePageIndex,
      ),
    [changePageIndex, changeQuery, input.changes],
  );

  const [unknownScenarioId, setUnknownScenarioId] = useState<string | null>(null);

  const selectExample = useCallback((sourceId: string) => {
    const nextFixture = fixtureFor(sourceId);
    const nextExample = exampleFor(sourceId);
    controller.rebind({
      sourceId: nextFixture.sourceId,
      input: nextFixture.input,
      expectedInputId: nextFixture.inputId,
      session: nextExample.session,
    });
    setSelectedSourceId(sourceId);
    setChangeQuery("");
    setChangePageIndex(0);
    setScenarioInUrl(sourceId);
    setUnknownScenarioId(null);
  }, [controller, setScenarioInUrl]);

  const canRunReplay = workflow.phase === "READY" || workflow.phase === "ERROR";

  useEffect(() => {
    const { requestedId, resolvedId } = readScenarioLookup(
      TERRAFORM_REVIEW_EXAMPLES.map((example) => example.sourceId),
    );
    if (resolvedId && resolvedId !== INITIAL_EXAMPLE.sourceId) {
      // Deep-link resolution: sync initial selection from the URL, once on
      // mount only. window.location is unavailable during SSR, so this can't
      // move into the useState initializer without a hydration mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      selectExample(resolvedId);
    } else if (requestedId && !resolvedId) {
      setUnknownScenarioId(requestedId);
      setScenarioInUrl(INITIAL_EXAMPLE.sourceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasFindings(workflow) || workflow.phase === "ERROR") {
      outcomeHeadingRef.current?.focus();
    }
  }, [workflow]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-edge bg-surface">
        <WorkbenchNav active="terraform" showSources />
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

      {unknownScenarioId ? (
        <div className="mx-auto max-w-[1600px] px-4 pt-4 sm:px-6">
          <UnknownScenarioNotice
            fallbackLabel={INITIAL_EXAMPLE.label}
            onDismiss={() => setUnknownScenarioId(null)}
            requestedId={unknownScenarioId}
          />
        </div>
      ) : null}

      <div id="review" className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(220px,0.75fr)_minmax(0,2fr)_minmax(280px,0.95fr)]">
        <main aria-busy={workflow.phase === "ANALYZING"} aria-label="Terraform review canvas" className="min-w-0 rounded-xl border border-edge bg-surface p-4 sm:p-6 lg:col-start-2 lg:row-start-1">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-edge pb-5">
            <div><Label>External-diff replay evaluation</Label><h1 className="mt-2 text-xl font-semibold">{example.label}</h1><PhasePill phase={workflow.phase} ref={outcomeHeadingRef} /><p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim"><StateValue state={workflow} /></p><p aria-atomic="true" aria-live="polite" className="sr-only" role="status"><ReplayStatus state={workflow} /></p></div>
            <button className="rounded bg-active px-4 py-2 text-sm font-semibold text-action-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={!canRunReplay} onClick={() => void controller.analyze()} type="button">{workflow.phase === "ANALYZING" ? "Running replay…" : canRunReplay ? "Run replay" : "Replay evaluated"}</button>
          </header>

          <div className="mt-5 grid min-w-0 grid-cols-1 gap-4">
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="findings-title"><Label>Deterministic findings</Label><h2 id="findings-title" className="mt-2 text-base font-semibold">Policy, reversibility, and context evidence</h2><FindingsPanel state={workflow} /></section>
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="proposal-title"><Label>Evaluated proposal</Label><h2 id="proposal-title" className="mt-2 text-base font-semibold">Replay result only</h2><ProposalPanel state={workflow} /></section>
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="plan-title"><Label>Supplied Terraform plan</Label><h2 id="plan-title" className="mt-2 text-base font-semibold">{input.changes.length} actionable resource change{input.changes.length === 1 ? "" : "s"}</h2><p className="mt-2 text-sm text-ink-dim">Module, provider resource type, address, and before/after values are read from the bundled plan. No result is declared before the deterministic evaluation runs.</p></section>
            <section className="min-w-0 overflow-hidden rounded-lg border border-edge bg-raised" aria-labelledby="resources-title">
              <div className="p-4">
                <Label>Structured diff</Label>
                <h2 id="resources-title" className="mt-2 text-base font-semibold">Resources and actions</h2>
                <p className="mt-2 text-xs text-ink-faint">Deterministic evaluation always covers all {input.changes.length} changes; search and paging bound only the rendered evidence table.</p>
                <EvidencePager
                  id="terraform-change-search"
                  label="Search all Terraform changes"
                  noun="changes"
                  onPageChange={setChangePageIndex}
                  onQueryChange={(query) => {
                    setChangeQuery(query);
                    setChangePageIndex(0);
                  }}
                  page={changePage}
                  query={changeQuery}
                />
              </div>
              {/* contain-layout: table-layout:auto's intrinsic max-content sizing pass
                  otherwise leaks into the document's own scrollable overflow even
                  though this container visually clips and scrolls the table fine —
                  a real 196px horizontal page drift on mobile that a plain
                  scrollWidth/clientWidth check on this div can't see, because the
                  div itself never reports overflowing. */}
              <div className="overflow-x-auto contain-layout">
                <table className="min-w-full border-collapse text-left text-xs">
                  <caption className="sr-only">Terraform resource changes</caption>
                  <thead className="border-y border-edge bg-surface text-ink-faint"><tr><th className="px-4 py-3 font-medium" scope="col">Module</th><th className="px-4 py-3 font-medium" scope="col">Type / address</th><th className="px-4 py-3 font-medium" scope="col">Action</th><th className="px-4 py-3 font-medium" scope="col">Before / after</th></tr></thead>
                  <tbody>{changePage.items.map((change) => { const destructive = change.action === "delete" || change.action === "replace"; return <tr className="border-b border-edge align-top" key={change.evidenceId}><td className="px-4 py-3 font-mono">{change.moduleAddress}</td><td className="px-4 py-3"><p className="font-mono text-ink">{change.resourceType}</p><p className="mt-1 font-mono text-ink-dim">{change.address}</p></td><td className="px-4 py-3"><ActionBadge action={change.action} destructive={destructive} />{destructive ? <p className="mt-2 text-ink-dim">Destructive plan action</p> : null}</td><td className="min-w-72 px-4 py-3"><details open={destructive}><summary className="cursor-pointer text-ink-dim">Inspect values for {change.address}</summary><DiffBlock after={change.after} before={change.before} label={change.address} /></details></td></tr>; })}</tbody>
                </table>
              </div>
            </section>
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="context-title"><Label>Untrusted context</Label><h2 id="context-title" className="mt-2 text-base font-semibold">Bundled plan context</h2>{input.context.length === 0 ? <p className="mt-3 text-sm text-ink-dim">No untrusted context was supplied with this plan.</p> : <ul className="mt-3 space-y-2">{input.context.map((entry) => <li className="rounded border border-edge bg-canvas p-3 text-sm" key={entry.evidenceId}><p className="font-mono text-xs">{entry.evidenceId} · {entry.kind}</p><p className="mt-2 whitespace-pre-wrap text-ink-dim">{entry.text}</p></li>)}</ul>}</section>
            <div>
              <DomainCoverageCatalog
                catalog={coverageCatalog}
                evaluatedPolicyIds={
                  hasFindings(workflow)
                    ? workflow.findings.map((finding) => finding.policyId)
                    : []
                }
                simulationDisclosure="Terraform is external-diff only. ChangeSafe evaluates the supplied plan and never claims to simulate it."
                source={{
                  sourceId: selectedSourceId,
                  source: example.session.source,
                  analysisMode: example.session.analysisMode,
                  provenance: example.session.provenance,
                }}
              />
            </div>
          </div>
        </main>

        <aside aria-label="Terraform review authority" className="min-w-0 self-start rounded-xl border border-edge bg-surface p-4 lg:sticky lg:top-4 lg:col-start-3 lg:row-start-1 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <Label>Airlock status</Label>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="risk-title"><h2 id="risk-title" className="text-sm font-semibold">Risk</h2><RiskValue riskLevel={hasFindings(workflow) ? workflow.riskLevel : null} /></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="decision-title"><h2 id="decision-title" className="text-sm font-semibold">Decision</h2><DecisionPanel state={workflow} /></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="simulation-title"><h2 id="simulation-title" className="text-sm font-semibold">Simulation</h2><p className="mt-2 text-sm text-ink-dim">Unavailable and not run. Terraform is an external-diff domain: the supplied plan is the read-only diff, not a sandbox state transition.</p></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="receipt-title"><h2 id="receipt-title" className="text-sm font-semibold">Receipt</h2><p className="mt-2 text-sm text-ink-dim">Not created. This ephemeral public replay has no durable decision or signed receipt.</p></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="execution-title"><h2 id="execution-title" className="text-sm font-semibold">Terraform execution</h2><p className="mt-2 text-sm text-ink-dim">Not performed or observed. ChangeSafe never runs Terraform or executes infrastructure changes.</p></section>
        </aside>

        <aside aria-label="Terraform review context" className="min-w-0 rounded-xl border border-edge bg-surface p-4 lg:col-start-1 lg:row-start-1">
          <Label>Terraform examples</Label>
          <h2 className="mt-2 text-lg font-semibold">{fixture.label}</h2>
          <ul className="mt-4 grid gap-2" role="list" aria-label="Bundled Terraform examples">
            {TERRAFORM_REVIEW_EXAMPLES.map((candidate) => (
              <li key={candidate.sourceId}><button aria-pressed={candidate.sourceId === selectedSourceId} className={`w-full rounded border px-3 py-2 text-left text-sm hover:border-active focus:outline-none focus:ring-2 focus:ring-active disabled:cursor-wait ${candidate.sourceId === selectedSourceId ? "border-active bg-active/10 text-ink" : "border-edge text-ink-dim"}`} disabled={workflow.phase === "ANALYZING"} onClick={() => selectExample(candidate.sourceId)} type="button"><span className="block font-medium text-ink">{candidate.label}{candidate.caseStudy ? <CaseStudyBadge label={candidate.caseStudy} /> : null}</span><span className="mt-1 block text-xs">{candidate.description}</span></button></li>
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
      </div>
    </div>
  );
}
