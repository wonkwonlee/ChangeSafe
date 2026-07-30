"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { BoundedJsonBlock } from "@/components/BoundedEvidence";
import { DomainCoverageCatalog } from "@/components/DomainCoverageCatalog";
import { TopologyView } from "@/components/TopologyView";
import { NETWORK_REVIEW_EXAMPLES } from "@/features/domains/network/examples";
import type { LoadedDomainCoverageCatalog } from "@/features/domains/registry";
import { publicReplayTransport } from "@/features/reviews/publicReplayTransport";
import { useReviewController } from "@/features/reviews/useReviewController";
import { getScenario, type ScenarioDefinition } from "@/scenarios";
import type { WorkflowState } from "@changesafe/core";
import type { IncidentBundle } from "@changesafe/domain-network";

const initialExample = NETWORK_REVIEW_EXAMPLES[0];
if (!initialExample) {
  throw new Error("The public Network workbench requires a bundled example");
}
const INITIAL_EXAMPLE = initialExample;

type ClassifiedWorkflow = Extract<
  WorkflowState<IncidentBundle>,
  { phase: "VALIDATED" | "BLOCKED" | "APPROVAL_REQUIRED" | "APPROVED" | "REJECTED" | "SIMULATED" | "RECEIPT_ISSUED" }
>;

function hasFindings(state: WorkflowState<IncidentBundle>): state is ClassifiedWorkflow {
  return [
    "VALIDATED",
    "BLOCKED",
    "APPROVAL_REQUIRED",
    "APPROVED",
    "REJECTED",
    "SIMULATED",
    "RECEIPT_ISSUED",
  ].includes(state.phase);
}

function scenarioFor(
  sourceId: string,
): ScenarioDefinition & { fixture: NonNullable<ScenarioDefinition["fixture"]> } {
  const scenario = getScenario(sourceId);
  if (!scenario || scenario.domainId !== "network" || !scenario.fixture) {
    throw new Error(`Bundled Network scenario "${sourceId}" is unavailable`);
  }
  return { ...scenario, fixture: scenario.fixture };
}

function exampleFor(sourceId: string) {
  const example = NETWORK_REVIEW_EXAMPLES.find((candidate) => candidate.sourceId === sourceId);
  if (!example) throw new Error(`Network review example "${sourceId}" is unavailable`);
  return example;
}

function initialSource() {
  const scenario = scenarioFor(INITIAL_EXAMPLE.sourceId);
  return {
    sourceId: scenario.scenarioId,
    input: scenario.input as IncidentBundle,
    expectedInputId: scenario.inputId,
    session: INITIAL_EXAMPLE.session,
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow text-ink-faint">{children}</p>;
}

function StateValue({ state }: { state: WorkflowState<IncidentBundle> }) {
  switch (state.phase) {
    case "ANALYZING":
      return "Replay analysis is running.";
    case "ERROR":
      return state.userMessage;
    case "READY":
      return "Choose Run replay to evaluate this bundled fixture.";
    default:
      return "Deterministic gate evaluation completed from the replay response.";
  }
}

/**
 * Keep live announcements limited to trusted, fixed lifecycle copy. Scenario
 * fixtures and replay error detail are untrusted data and must never become
 * instructions through an assistive-technology announcement.
 */
function ReplayStatus({ state }: { state: WorkflowState<IncidentBundle> }) {
  switch (state.phase) {
    case "ANALYZING":
      return "Replay analysis is running.";
    case "ERROR":
      return "Replay could not be evaluated. Choose Run replay to try again.";
    case "READY":
      return "Replay is ready to evaluate.";
    case "BLOCKED":
      return "Replay evaluated. Deterministic findings blocked this proposal.";
    default:
      return "Replay evaluated through the deterministic gate.";
  }
}

function ProposalPanel({ state }: { state: WorkflowState<IncidentBundle> }) {
  if (state.phase === "READY" || state.phase === "ANALYZING" || state.phase === "ERROR") {
    return <p className="mt-3 text-sm text-ink-dim">No evaluated proposal is available yet.</p>;
  }
  return <BoundedJsonBlock label="Network proposal JSON" value={state.proposal} />;
}

function FindingsPanel({ state }: { state: WorkflowState<IncidentBundle> }) {
  if (!hasFindings(state)) {
    return <p className="mt-3 text-sm text-ink-dim">Findings appear only after replay evaluation.</p>;
  }
  return (
    <ul className="mt-3 space-y-2" aria-label="Evaluated policy findings">
      {state.findings.map((finding) => (
        <li className="rounded border border-edge bg-canvas p-3 text-sm" key={finding.policyId}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs">{finding.policyId}</span>
            <span className="eyebrow rounded border border-edge px-2 py-1">{finding.status}</span>
          </div>
          <p className="mt-2 font-medium text-ink">{finding.title}</p>
          <p className="mt-1 text-ink-dim">{finding.explanation}</p>
          {finding.affectedResources.length > 0 ? (
            <p className="mt-2 text-xs text-ink-faint">
              Affected: {finding.affectedResources.join(", ")}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function DecisionPanel({ state }: { state: WorkflowState<IncidentBundle> }) {
  if (state.phase === "BLOCKED") {
    return (
      <p className="mt-3 rounded border border-block/50 bg-block/10 p-3 text-sm text-block">
        BLOCKED by deterministic findings. This proposal is unapprovable; public replay offers no
        override or decision action.
      </p>
    );
  }
  if (state.phase === "APPROVAL_REQUIRED") {
    return (
      <p className="mt-3 text-sm text-ink-dim">
        The gate permits a human decision, but public replay intentionally has no approval or
        rejection controls and records no decision.
      </p>
    );
  }
  return <p className="mt-3 text-sm text-ink-dim">No decision has been made.</p>;
}

/**
 * Interactive public replay surface for the Network domain.
 *
 * It can request only the replay transport. Human decisions, simulations, and
 * receipt writes deliberately remain unavailable, so this client UI cannot
 * expand the public trust boundary.
 */
export function ReviewWorkbenchShell({
  coverageCatalog,
}: {
  readonly coverageCatalog: LoadedDomainCoverageCatalog;
}) {
  const controller = useReviewController<IncidentBundle>({
    ...initialSource(),
    transport: publicReplayTransport,
  });
  const [selectedSourceId, setSelectedSourceId] = useState(INITIAL_EXAMPLE.sourceId);
  const scenario = useMemo(() => scenarioFor(selectedSourceId), [selectedSourceId]);
  const selectedExample = useMemo(() => exampleFor(selectedSourceId), [selectedSourceId]);
  const workflow = controller.state.workflow;
  const outcomeHeadingRef = useRef<HTMLHeadingElement>(null);

  const selectExample = useCallback(
    (sourceId: string) => {
      const nextScenario = scenarioFor(sourceId);
      const nextExample = exampleFor(sourceId);
      controller.rebind({
        sourceId: nextScenario.scenarioId,
        input: nextScenario.input as IncidentBundle,
        expectedInputId: nextScenario.inputId,
        session: nextExample.session,
      });
      setSelectedSourceId(sourceId);
    },
    [controller],
  );

  const canRunReplay = workflow.phase === "READY" || workflow.phase === "ERROR";

  useEffect(() => {
    if (hasFindings(workflow) || workflow.phase === "ERROR") {
      outcomeHeadingRef.current?.focus();
    }
  }, [workflow]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-edge bg-surface">
        <nav aria-label="Product navigation" className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
          <a className="mr-auto text-base font-bold tracking-tight text-ink" href="#review">
            ChangeSafe <span className="ml-2 text-xs font-normal text-ink-dim">infrastructure change airlock</span>
          </a>
          <span aria-current="page" className="inline-flex rounded-md border border-active/50 bg-active/10 px-3 py-2 text-sm text-active">Network</span>
          <Link className="inline-flex rounded-md px-3 py-2 text-sm text-ink-dim hover:text-ink" href="/workbench/terraform">Terraform</Link>
          <Link className="inline-flex rounded-md px-3 py-2 text-sm text-ink-dim hover:text-ink" href="/workbench/kubernetes">Kubernetes</Link>
          <Link className="inline-flex rounded-md px-3 py-2 text-sm text-ink-dim hover:text-ink" href="/workbench/self-hosted">Authenticated self-hosted</Link>
          <a className="inline-flex rounded-md px-3 py-2 text-sm text-ink-dim hover:text-ink" href="#sources">Sources</a>
        </nav>
      </header>

      <section className="border-b border-edge bg-overlay" aria-labelledby="runtime-title">
        <div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div>
            <p id="runtime-title" className="eyebrow text-ai">Public replay</p>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-dim">
              Run a schema-validated bundled Network replay through the deterministic gate. This
              ephemeral surface never executes infrastructure and cannot make or store a decision.
            </p>
          </div>
          <div role="group" aria-labelledby="runtime-variants-title" className="rounded-lg border border-edge bg-surface p-3">
            <p id="runtime-variants-title" className="eyebrow text-ink-faint">Runtime variant</p>
            <p className="mt-2 rounded border border-active/50 bg-active/10 px-3 py-2 text-sm text-active">Examples / public replay · available</p>
            <p className="mt-2 text-xs text-warn">Ephemeral session · no durable review record</p>
          </div>
        </div>
      </section>

      <div id="review" className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(220px,0.75fr)_minmax(0,2fr)_minmax(280px,0.95fr)]">
        <main aria-busy={workflow.phase === "ANALYZING"} aria-label="Review canvas" className="min-w-0 rounded-xl border border-edge bg-surface p-4 sm:p-6 xl:col-start-2 xl:row-start-1">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-edge pb-5">
            <div>
              <Label>Replay evaluation</Label>
              <h1 className="mt-2 text-xl font-semibold" ref={outcomeHeadingRef} tabIndex={-1}>{workflow.phase}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim"><StateValue state={workflow} /></p>
              <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
                <ReplayStatus state={workflow} />
              </p>
            </div>
            <button className="rounded bg-active px-4 py-2 text-sm font-semibold text-action-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={!canRunReplay} onClick={() => void controller.analyze()} type="button">
              {workflow.phase === "ANALYZING" ? "Running replay…" : "Run replay"}
            </button>
          </header>

          <div className="mt-5 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="findings-title"><Label>Deterministic findings</Label><h2 id="findings-title" className="mt-2 text-base font-semibold">Policy results</h2><FindingsPanel state={workflow} /></section>
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="proposal-title"><Label>Evaluated proposal</Label><h2 id="proposal-title" className="mt-2 text-base font-semibold">Replay result only</h2><ProposalPanel state={workflow} /></section>
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="input-title">
              <Label>Scenario input</Label><h2 id="input-title" className="mt-2 text-base font-semibold">{scenario.inputId}</h2><BoundedJsonBlock label="Network scenario input JSON" value={scenario.input} />
            </section>
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="evidence-title">
              <Label>Evidence</Label><h2 id="evidence-title" className="mt-2 text-base font-semibold">Untrusted incident data</h2>
              <ul className="mt-3 space-y-2 text-sm">{(scenario.input as IncidentBundle).alerts.map((alert) => <li className="rounded border border-edge p-3" key={alert.evidenceId}><span className="font-mono text-xs">{alert.evidenceId}</span><p className="mt-1 text-ink-dim">{alert.message}</p></li>)}</ul>
            </section>
            <section className="min-w-0 rounded-lg border border-edge bg-raised p-4 lg:col-span-2" aria-labelledby="topology-title"><Label>Topology</Label><h2 id="topology-title" className="mt-2 text-base font-semibold">Bundled topology</h2><div className="mt-3 min-w-0 rounded border border-edge bg-canvas p-3"><TopologyView topology={(scenario.input as IncidentBundle).topology} state={(scenario.input as IncidentBundle).currentState} /></div></section>
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="state-title"><Label>Current state</Label><h2 id="state-title" className="mt-2 text-base font-semibold">Read-only declarative model</h2><BoundedJsonBlock label="Network current-state JSON" value={(scenario.input as IncidentBundle).currentState} /></section>
            <div className="lg:col-span-2">
              <DomainCoverageCatalog
                catalog={coverageCatalog}
                evaluatedPolicyIds={
                  hasFindings(workflow)
                    ? workflow.findings.map((finding) => finding.policyId)
                    : []
                }
                simulationDisclosure="This public replay never requests sandbox simulation because it has no decision authority."
                source={{
                  sourceId: selectedSourceId,
                  source: selectedExample.session.source,
                  analysisMode: selectedExample.session.analysisMode,
                  provenance: selectedExample.session.provenance,
                }}
              />
            </div>
          </div>
        </main>

        <aside aria-label="Review authority" className="min-w-0 rounded-xl border border-edge bg-surface p-4 xl:col-start-3 xl:row-start-1">
          <Label>Airlock status</Label>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="risk-title"><h2 id="risk-title" className="text-sm font-semibold">Risk</h2><p className="mt-2 text-sm text-ink-dim">{hasFindings(workflow) ? workflow.riskLevel : "Not evaluated"}</p></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="decision-title"><h2 id="decision-title" className="text-sm font-semibold">Decision</h2><DecisionPanel state={workflow} /></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="simulation-title"><h2 id="simulation-title" className="text-sm font-semibold">Simulation</h2><p className="mt-2 text-sm text-ink-dim">Not run. Public replay cannot approve a proposal, so no sandbox simulation is requested.</p></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="receipt-title"><h2 id="receipt-title" className="text-sm font-semibold">Receipt</h2><p className="mt-2 text-sm text-ink-dim">Not created. This ephemeral public replay has no durable decision or signed receipt.</p></section>
          <section className="mt-4 border-t border-edge pt-4" aria-labelledby="execution-title"><h2 id="execution-title" className="text-sm font-semibold">Execution outside ChangeSafe</h2><p className="mt-2 text-sm text-ink-dim">Not performed or observed. ChangeSafe never executes infrastructure changes.</p></section>
        </aside>

        <aside aria-label="Review context" className="min-w-0 rounded-xl border border-edge bg-surface p-4 xl:col-start-1 xl:row-start-1">
          <Label>Network examples</Label>
          <h2 className="mt-2 text-lg font-semibold">{scenario.label}</h2>
          <ul className="mt-4 grid gap-2" role="list" aria-label="Bundled Network examples">
            {NETWORK_REVIEW_EXAMPLES.map((example) => (
              <li key={example.sourceId}>
                <button
                  className="w-full rounded border border-edge px-3 py-2 text-left text-sm text-ink-dim hover:border-active focus:outline-none focus:ring-2 focus:ring-active disabled:cursor-wait"
                  disabled={workflow.phase === "ANALYZING"}
                  onClick={() => selectExample(example.sourceId)}
                  type="button"
                  aria-pressed={example.sourceId === selectedSourceId}
                >
                  <span className="block font-medium text-ink">{example.label}</span>
                  <span className="mt-1 block text-xs">{example.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <section id="sources" className="mt-5 border-t border-edge pt-4" aria-labelledby="source-title">
            <h2 id="source-title" className="text-sm font-semibold">Replay source</h2>
            <dl className="mt-3 grid gap-3 text-xs">
              <div><dt className="text-ink-faint">Scenario</dt><dd className="mt-1 font-mono">{scenario.scenarioId}</dd></div>
              <div><dt className="text-ink-faint">Fixture provenance</dt><dd className="mt-1">{scenario.fixture.provenance}</dd></div>
              <div><dt className="text-ink-faint">Fixture ID</dt><dd className="mt-1 font-mono">{scenario.fixture.fixtureId}</dd></div>
              <div><dt className="text-ink-faint">Policy version</dt><dd className="mt-1 font-mono">{selectedExample.session.policyVersion}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
