"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  KubernetesChangeProposal,
  KubernetesSnapshot,
} from "@changesafe/domain-kubernetes/offline";
import type { WorkflowState } from "@changesafe/core";

import { DomainCoverageCatalog } from "@/components/DomainCoverageCatalog";
import { boundOfflineCollection } from "@/features/domains/presentation-limit";
import { KUBERNETES_REVIEW_EXAMPLES } from "@/features/domains/kubernetes/examples";
import type { LoadedDomainCoverageCatalog } from "@/features/domains/registry";
import {
  KUBERNETES_PUBLIC_REPLAY_FIXTURES,
  KUBERNETES_PUBLIC_REPLAY_SNAPSHOT,
  type KubernetesPublicReplayFixture,
} from "@/features/domains/kubernetes/fixtures";
import { publicReplayTransport } from "@/features/reviews/publicReplayTransport";
import { useReviewController } from "@/features/reviews/useReviewController";

const initialExample = KUBERNETES_REVIEW_EXAMPLES[0];
if (!initialExample) {
  throw new Error("The public Kubernetes workbench requires a bundled example");
}
const INITIAL_EXAMPLE = initialExample;

type ClassifiedWorkflow = Extract<
  WorkflowState<KubernetesSnapshot>,
  { phase: "VALIDATED" | "BLOCKED" | "APPROVAL_REQUIRED" | "APPROVED" | "REJECTED" | "SIMULATED" | "RECEIPT_ISSUED" }
>;

function hasFindings(
  workflow: WorkflowState<KubernetesSnapshot>,
): workflow is ClassifiedWorkflow {
  return [
    "VALIDATED", "BLOCKED", "APPROVAL_REQUIRED", "APPROVED", "REJECTED", "SIMULATED", "RECEIPT_ISSUED",
  ].includes(workflow.phase);
}

function fixtureFor(sourceId: string): KubernetesPublicReplayFixture {
  const fixture = KUBERNETES_PUBLIC_REPLAY_FIXTURES.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!fixture) throw new Error(`Bundled Kubernetes fixture "${sourceId}" is unavailable`);
  return fixture;
}

function exampleFor(sourceId: string) {
  const example = KUBERNETES_REVIEW_EXAMPLES.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!example) throw new Error(`Kubernetes review example "${sourceId}" is unavailable`);
  return example;
}

function initialSource() {
  const fixture = fixtureFor(INITIAL_EXAMPLE.sourceId);
  return {
    sourceId: fixture.sourceId,
    input: KUBERNETES_PUBLIC_REPLAY_SNAPSHOT,
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

type KubernetesResource = KubernetesSnapshot["resources"][number];

function resourceName(resource: KubernetesResource): string {
  const { kind, namespace, name } = resource.identity;
  return `${kind} ${namespace}/${name}`;
}

function resourceLabelEntries(resource: KubernetesResource): readonly [string, string][] {
  return Object.entries(resource.metadata.labels ?? {});
}

function workloadPodLabels(resource: KubernetesResource): Readonly<Record<string, string>> {
  return "podLabels" in resource.spec ? resource.spec.podLabels ?? {} : {};
}

export function selectorRelationships(snapshot: KubernetesSnapshot) {
  const workloads = snapshot.resources.filter(
    (resource) => resource.identity.kind === "Deployment" || resource.identity.kind === "StatefulSet" || resource.identity.kind === "DaemonSet",
  );
  const services = snapshot.resources.filter(
    (resource): resource is Extract<KubernetesResource, { identity: { kind: "Service" } }> =>
      resource.identity.kind === "Service",
  );
  return services
    .map((service) => {
      const selector = service.spec.selector ?? {};
      const matches = workloads.filter((workload) =>
        workload.identity.namespace === service.identity.namespace &&
        Object.entries(selector).every(([key, value]) => workloadPodLabels(workload)[key] === value),
      );
      return { service, selector, matches };
    });
}

function StateValue({ state }: { state: WorkflowState<KubernetesSnapshot> }) {
  switch (state.phase) {
    case "ANALYZING": return "Replay analysis is running against the bundled offline snapshot.";
    case "ERROR": return state.userMessage;
    case "READY": return "Choose Run replay to evaluate this bundled manifest proposal.";
    default: return "Deterministic gate evaluation completed from the replay response.";
  }
}

function ReplayStatus({ state }: { state: WorkflowState<KubernetesSnapshot> }) {
  switch (state.phase) {
    case "ANALYZING": return "Kubernetes replay analysis is running.";
    case "ERROR": return "Kubernetes replay could not be evaluated. Choose Run replay to try again.";
    case "READY": return "Kubernetes replay is ready to evaluate.";
    case "BLOCKED": return "Kubernetes replay evaluated. Deterministic findings blocked this manifest proposal.";
    default: return "Kubernetes replay evaluated through the deterministic gate.";
  }
}

function ProposalPanel({ state }: { state: WorkflowState<KubernetesSnapshot> }) {
  if (!hasFindings(state)) return <p className="mt-3 text-sm text-ink-dim">No evaluated proposal is available yet.</p>;
  return <JsonBlock value={state.proposal} />;
}

function FindingsPanel({ state }: { state: WorkflowState<KubernetesSnapshot> }) {
  if (!hasFindings(state)) return <p className="mt-3 text-sm text-ink-dim">Policy evidence appears only after replay evaluation.</p>;
  return <ul className="mt-3 space-y-2" aria-label="Evaluated Kubernetes policy findings">{state.findings.map((finding) => (
    <li className="rounded border border-edge bg-canvas p-3 text-sm" key={finding.policyId}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs">{finding.policyId}</span><span className="eyebrow rounded border border-edge px-2 py-1">{finding.status}</span></div>
      <p className="mt-2 font-medium text-ink">{finding.title}</p><p className="mt-1 text-ink-dim">{finding.explanation}</p>
      {finding.affectedResources.length > 0 ? <p className="mt-2 text-xs text-ink-faint">Affected: {finding.affectedResources.join(", ")}</p> : null}
    </li>
  ))}</ul>;
}

function DecisionPanel({ state }: { state: WorkflowState<KubernetesSnapshot> }) {
  if (state.phase === "BLOCKED") return <p className="mt-3 rounded border border-block/50 bg-block/10 p-3 text-sm text-block">BLOCKED by deterministic findings. This proposal is unapprovable; public replay provides no override or decision control.</p>;
  if (state.phase === "APPROVAL_REQUIRED") return <p className="mt-3 text-sm text-ink-dim">The gate permits a human decision, but this public replay intentionally provides no approval or rejection control and records no decision.</p>;
  return <p className="mt-3 text-sm text-ink-dim">No decision has been made.</p>;
}

function ProposedDiff({ proposal }: { proposal: KubernetesChangeProposal }) {
  const existing = new Map(KUBERNETES_PUBLIC_REPLAY_SNAPSHOT.resources.map((resource) => [resource.resourceId, resource]));
  return <div className="mt-3 grid gap-3">{proposal.operations.map((operation) => {
    const before = existing.get(operation.value.resourceId);
    return <article className="rounded border border-edge bg-canvas p-3" key={operation.path}>
      <p className="font-mono text-xs text-ink-faint">{operation.op} · {operation.path}</p>
      <p className="mt-2 text-sm font-medium">{resourceName(operation.value)}</p>
      <p className="mt-1 text-sm text-ink-dim">{operation.reason}</p>
      <p className="mt-2 text-xs text-ink-faint">Evidence: {operation.evidenceIds.join(", ")}</p>
      <details className="mt-3"><summary className="cursor-pointer text-sm text-ink-dim">Inspect current / proposed manifest</summary><div className="grid gap-3 lg:grid-cols-2"><div><p className="mt-3 text-xs text-ink-faint">Current</p><JsonBlock value={before ?? "No current resource (add)"} /></div><div><p className="mt-3 text-xs text-ink-faint">Proposed</p><JsonBlock value={operation.value} /></div></div></details>
    </article>;
  })}</div>;
}

/**
 * Public, offline Kubernetes review surface. It evaluates only bundled typed
 * replay data. Although the domain has a simulation capability, public
 * replay intentionally never requests it because it cannot make a decision.
 */
export function KubernetesWorkbenchShell({
  coverageCatalog,
}: {
  readonly coverageCatalog: LoadedDomainCoverageCatalog;
}) {
  const controller = useReviewController<KubernetesSnapshot>({ ...initialSource(), transport: publicReplayTransport });
  const [selectedSourceId, setSelectedSourceId] = useState(INITIAL_EXAMPLE.sourceId);
  const fixture = useMemo(() => fixtureFor(selectedSourceId), [selectedSourceId]);
  const example = useMemo(() => exampleFor(selectedSourceId), [selectedSourceId]);
  const workflow = controller.state.workflow;
  const relations = useMemo(() => selectorRelationships(KUBERNETES_PUBLIC_REPLAY_SNAPSHOT), []);
  const boundedResources = useMemo(
    () => boundOfflineCollection(KUBERNETES_PUBLIC_REPLAY_SNAPSHOT.resources),
    [],
  );
  const boundedRelations = useMemo(
    () => boundOfflineCollection(relations),
    [relations],
  );
  const outcomeHeadingRef = useRef<HTMLHeadingElement>(null);
  const canRunReplay = workflow.phase === "READY" || workflow.phase === "ERROR";

  const selectExample = useCallback((sourceId: string) => {
    const nextFixture = fixtureFor(sourceId);
    const nextExample = exampleFor(sourceId);
    controller.rebind({ sourceId: nextFixture.sourceId, input: KUBERNETES_PUBLIC_REPLAY_SNAPSHOT, expectedInputId: nextFixture.inputId, session: nextExample.session });
    setSelectedSourceId(sourceId);
  }, [controller]);

  useEffect(() => {
    if (hasFindings(workflow) || workflow.phase === "ERROR") {
      outcomeHeadingRef.current?.focus();
    }
  }, [workflow]);

  return <div className="min-h-screen bg-canvas text-ink">
    <header className="border-b border-edge bg-surface"><nav aria-label="Product navigation" className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6"><a className="mr-auto text-base font-bold tracking-tight text-ink" href="#review">ChangeSafe <span className="ml-2 text-xs font-normal text-ink-dim">infrastructure change airlock</span></a><a className="inline-flex rounded-md px-3 py-2 text-sm text-ink-dim hover:text-ink" href="#sources">Sources</a></nav></header>
    <section className="border-b border-edge bg-overlay" aria-labelledby="runtime-title"><div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]"><div><p id="runtime-title" className="eyebrow text-ai">Public replay · Kubernetes offline sandbox</p><p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-dim">Inspect a schema-validated bundled Kubernetes snapshot and proposed manifest through the deterministic gate. No cluster is contacted, no manifest is applied, and this ephemeral surface cannot make or store a decision.</p></div><div role="group" aria-labelledby="runtime-variants-title" className="rounded-lg border border-edge bg-surface p-3"><p id="runtime-variants-title" className="eyebrow text-ink-faint">Runtime variant</p><p className="mt-2 rounded border border-active/50 bg-active/10 px-3 py-2 text-sm text-active">Examples / public replay · available</p><p className="mt-2 text-xs text-warn">Offline snapshot · no cluster contact · no durable review record</p></div></div></section>
    <div id="review" className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(220px,0.75fr)_minmax(0,2fr)_minmax(280px,0.95fr)]">
      <main aria-busy={workflow.phase === "ANALYZING"} aria-label="Kubernetes review canvas" className="min-w-0 rounded-xl border border-edge bg-surface p-4 sm:p-6 xl:col-start-2 xl:row-start-1">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-edge pb-5">
          <div>
            <Label>Offline replay evaluation</Label>
            <h2 className="mt-2 text-xl font-semibold" ref={outcomeHeadingRef} tabIndex={-1}>{workflow.phase}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim"><StateValue state={workflow} /></p>
            <p aria-atomic="true" aria-live="polite" className="sr-only" role="status"><ReplayStatus state={workflow} /></p>
          </div>
          <button className="rounded bg-active px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!canRunReplay} onClick={() => void controller.analyze()} type="button">{workflow.phase === "ANALYZING" ? "Running replay…" : "Run replay"}</button>
        </header>
        <div className="mt-5 grid gap-4">
          <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="findings-title"><Label>Deterministic findings</Label><h3 id="findings-title" className="mt-2 text-base font-semibold">Image, security, selector, and protected-resource evidence</h3><FindingsPanel state={workflow} /></section>
          <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="proposal-title"><Label>Evaluated proposal</Label><h3 id="proposal-title" className="mt-2 text-base font-semibold">Replay result only</h3><ProposalPanel state={workflow} /></section>
          <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="inventory-title">
            <Label>Namespace inventory</Label>
            <h3 id="inventory-title" className="mt-2 text-base font-semibold">{KUBERNETES_PUBLIC_REPLAY_SNAPSHOT.resources.length} captured offline resources</h3>
            {boundedResources.hiddenCount > 0 ? <p className="mt-2 text-xs text-ink-faint">Showing the first {boundedResources.items.length} of {boundedResources.totalCount} resources. Deterministic evaluation still covers the complete snapshot.</p> : null}
            <ul className="mt-3 grid gap-2 text-sm">{boundedResources.items.map((resource) => <li className="rounded border border-edge bg-canvas p-3" key={resource.resourceId}><p className="font-medium">{resourceName(resource)}</p><p className="mt-1 font-mono text-xs text-ink-faint">{resource.resourceId}</p>{resourceLabelEntries(resource).length ? <p className="mt-2 text-xs text-ink-dim">Labels: {resourceLabelEntries(resource).map(([key, value]) => `${key}=${value}`).join(", ")}</p> : null}</li>)}</ul>
          </section>
          <section className="overflow-hidden rounded-lg border border-edge bg-raised" aria-labelledby="selector-title">
            <div className="p-4"><Label>Service selector relationships</Label><h3 id="selector-title" className="mt-2 text-base font-semibold">Current snapshot relationships</h3></div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-xs">
                <caption className="sr-only">Kubernetes Service selector relationships</caption>
                <thead className="border-y border-edge bg-surface text-ink-faint"><tr><th className="px-4 py-3 font-medium" scope="col">Service</th><th className="px-4 py-3 font-medium" scope="col">Selector</th><th className="px-4 py-3 font-medium" scope="col">Matching workloads</th></tr></thead>
                <tbody>{boundedRelations.items.map(({ service, selector, matches }) => <tr className="border-b border-edge align-top" key={service.resourceId}><th className="px-4 py-3 font-mono font-normal" scope="row">{resourceName(service)}</th><td className="px-4 py-3">{Object.entries(selector).map(([key, value]) => `${key}=${value}`).join(", ") || "No selector"}</td><td className="px-4 py-3">{matches.length ? matches.map(resourceName).join(", ") : "No matching workload"}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
          <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="manifest-title"><Label>Current / proposed manifest diff</Label><h3 id="manifest-title" className="mt-2 text-base font-semibold">Bundled manifest proposal</h3><p className="mt-2 text-sm text-ink-dim">Image, workload security context, protected-resource labels, and Service selector effects are review evidence. Proposed manifests are data only and are never applied.</p><ProposedDiff proposal={fixture.proposal} /></section>
          <div>
            <DomainCoverageCatalog catalog={coverageCatalog} evaluatedPolicyIds={hasFindings(workflow) ? workflow.findings.map((finding) => finding.policyId) : []} simulationDisclosure="Kubernetes has an offline sandbox capability, but this public replay never requests simulation because it has no decision authority." source={{ sourceId: selectedSourceId, source: example.session.source, analysisMode: example.session.analysisMode, provenance: example.session.provenance }} />
          </div>
        </div>
      </main>
      <aside aria-label="Kubernetes review authority" className="min-w-0 rounded-xl border border-edge bg-surface p-4 xl:col-start-3 xl:row-start-1"><Label>Airlock status</Label><section className="mt-4 border-t border-edge pt-4" aria-labelledby="risk-title"><h2 id="risk-title" className="text-sm font-semibold">Risk</h2><p className="mt-2 text-sm text-ink-dim">{hasFindings(workflow) ? workflow.riskLevel : "Not evaluated"}</p></section><section className="mt-4 border-t border-edge pt-4" aria-labelledby="decision-title"><h2 id="decision-title" className="text-sm font-semibold">Decision</h2><DecisionPanel state={workflow} /></section><section className="mt-4 border-t border-edge pt-4" aria-labelledby="simulation-title"><h2 id="simulation-title" className="text-sm font-semibold">Simulation</h2><p className="mt-2 text-sm text-ink-dim">Unavailable and not run. Kubernetes has an offline sandbox capability, but public replay is decision-free and this route provides no validated simulation result.</p></section><section className="mt-4 border-t border-edge pt-4" aria-labelledby="receipt-title"><h2 id="receipt-title" className="text-sm font-semibold">Receipt</h2><p className="mt-2 text-sm text-ink-dim">Not created. This ephemeral public replay has no durable decision or signed receipt.</p></section><section className="mt-4 border-t border-edge pt-4" aria-labelledby="execution-title"><h2 id="execution-title" className="text-sm font-semibold">Cluster contact or apply</h2><p className="mt-2 text-sm text-ink-dim">Not performed or observed. ChangeSafe never contacts this cluster or applies infrastructure changes.</p></section></aside>
      <aside aria-label="Kubernetes review context" className="min-w-0 rounded-xl border border-edge bg-surface p-4 xl:col-start-1 xl:row-start-1"><Label>Kubernetes examples</Label><h1 className="mt-2 text-lg font-semibold">{fixture.label}</h1><ul className="mt-4 grid gap-2" role="list" aria-label="Bundled Kubernetes examples">{KUBERNETES_REVIEW_EXAMPLES.map((candidate) => <li key={candidate.sourceId}><button aria-pressed={candidate.sourceId === selectedSourceId} className="w-full rounded border border-edge px-3 py-2 text-left text-sm text-ink-dim hover:border-active focus:outline-none focus:ring-2 focus:ring-active disabled:cursor-wait" disabled={workflow.phase === "ANALYZING"} onClick={() => selectExample(candidate.sourceId)} type="button"><span className="block font-medium text-ink">{candidate.label}</span><span className="mt-1 block text-xs">{candidate.description}</span></button></li>)}</ul><section id="sources" className="mt-5 border-t border-edge pt-4" aria-labelledby="source-title"><h2 id="source-title" className="text-sm font-semibold">Offline source</h2><dl className="mt-3 grid gap-3 text-xs"><div><dt className="text-ink-faint">Snapshot ID</dt><dd className="mt-1 font-mono">{KUBERNETES_PUBLIC_REPLAY_SNAPSHOT.snapshotId}</dd></div><div><dt className="text-ink-faint">Namespace</dt><dd className="mt-1">{KUBERNETES_PUBLIC_REPLAY_SNAPSHOT.provenance.namespaces.join(", ")}</dd></div><div><dt className="text-ink-faint">Fixture provenance</dt><dd className="mt-1">{fixture.provenance}</dd></div><div><dt className="text-ink-faint">Policy version</dt><dd className="mt-1 font-mono">{example.session.policyVersion}</dd></div></dl></section></aside>
    </div>
  </div>;
}
