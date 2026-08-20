"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  KubernetesChangeProposal,
  KubernetesSnapshot,
} from "@changesafe/domain-kubernetes/offline";
import type { WorkflowState } from "@changesafe/core";

import {
  BoundedJsonBlock,
  EvidencePager,
} from "@/components/BoundedEvidence";
import { DiffBlock } from "@/components/DiffBlock";
import { DomainCoverageCatalog } from "@/components/DomainCoverageCatalog";
import { readScenarioLookup, useScenarioDeepLink } from "@/components/hooks/useScenarioDeepLink";
import { FindingsList, PhasePill, RiskValue } from "@/components/StatusTone";
import { UnknownScenarioNotice } from "@/components/UnknownScenarioNotice";
import { WorkbenchNav } from "@/components/WorkbenchNav";
import {
  MAX_VISIBLE_NESTED_ITEMS,
  searchAndPageOfflineCollection,
} from "@/features/domains/presentation-limit";
import { KUBERNETES_REVIEW_EXAMPLES } from "@/features/domains/kubernetes/examples";
import type { LoadedDomainCoverageCatalog } from "@/features/domains/registry";
import {
  KUBERNETES_PUBLIC_REPLAY_FIXTURES,
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
    input: fixture.snapshot,
    expectedInputId: fixture.inputId,
    session: INITIAL_EXAMPLE.session,
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow text-ink-faint">{children}</p>;
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

type KubernetesService = Extract<
  KubernetesResource,
  { identity: { kind: "Service" } }
>;

export interface SelectorRelationshipCandidate {
  readonly service: KubernetesService;
  readonly selector: Readonly<Record<string, string>>;
}

export interface SelectorRelationship extends SelectorRelationshipCandidate {
  readonly matches: readonly KubernetesResource[];
}

export function selectorRelationshipCandidates(
  snapshot: KubernetesSnapshot,
): readonly SelectorRelationshipCandidate[] {
  return snapshot.resources
    .filter(
    (resource): resource is Extract<KubernetesResource, { identity: { kind: "Service" } }> =>
      resource.identity.kind === "Service",
    )
    .map((service) => ({
      service,
      selector: service.spec.selector ?? {},
    }));
}

export function createSelectorRelationshipResolver(
  snapshot: KubernetesSnapshot,
): (candidate: SelectorRelationshipCandidate) => SelectorRelationship {
  const workloadsByNamespace = new Map<string, KubernetesResource[]>();
  const workloadsByNamespaceAndLabel = new Map<
    string,
    Map<string, Map<string, Set<KubernetesResource>>>
  >();

  for (const resource of snapshot.resources) {
    if (
      resource.identity.kind !== "Deployment" &&
      resource.identity.kind !== "StatefulSet" &&
      resource.identity.kind !== "DaemonSet"
    ) {
      continue;
    }

    const namespace = resource.identity.namespace;
    const namespaceWorkloads = workloadsByNamespace.get(namespace) ?? [];
    namespaceWorkloads.push(resource);
    workloadsByNamespace.set(namespace, namespaceWorkloads);

    const namespaceLabels = workloadsByNamespaceAndLabel.get(namespace) ?? new Map();
    workloadsByNamespaceAndLabel.set(namespace, namespaceLabels);
    for (const [key, value] of Object.entries(workloadPodLabels(resource))) {
      const values = namespaceLabels.get(key) ?? new Map();
      namespaceLabels.set(key, values);
      const matchingWorkloads = values.get(value) ?? new Set();
      matchingWorkloads.add(resource);
      values.set(value, matchingWorkloads);
    }
  }

  return (candidate) => {
    const selectorEntries = Object.entries(candidate.selector);
    const namespace = candidate.service.identity.namespace;
    if (selectorEntries.length === 0) {
      return {
        ...candidate,
        matches: workloadsByNamespace.get(namespace) ?? [],
      };
    }

    const namespaceLabels = workloadsByNamespaceAndLabel.get(namespace);
    const matchingSets = selectorEntries.map(([key, value]) =>
      namespaceLabels?.get(key)?.get(value),
    );
    if (matchingSets.some((matches) => matches === undefined)) {
      return { ...candidate, matches: [] };
    }

    const orderedSets = matchingSets
      .filter((matches): matches is Set<KubernetesResource> => matches !== undefined)
      .sort((left, right) => left.size - right.size);
    const seed = orderedSets[0] ?? new Set<KubernetesResource>();
    return {
      ...candidate,
      matches: [...seed].filter((workload) =>
        orderedSets.every((matches) => matches.has(workload)),
      ),
    };
  };
}

export function selectorRelationships(
  snapshot: KubernetesSnapshot,
  candidates: readonly SelectorRelationshipCandidate[],
): readonly SelectorRelationship[] {
  const resolve = createSelectorRelationshipResolver(snapshot);
  return candidates.map(resolve);
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
  return <BoundedJsonBlock label="Kubernetes proposal JSON" value={state.proposal} />;
}

function FindingsPanel({ state }: { state: WorkflowState<KubernetesSnapshot> }) {
  if (!hasFindings(state)) return <p className="mt-3 text-sm text-ink-dim">Policy evidence appears only after replay evaluation.</p>;
  return <FindingsList ariaLabel="Evaluated Kubernetes policy findings" findings={state.findings} />;
}

function DecisionPanel({ state }: { state: WorkflowState<KubernetesSnapshot> }) {
  if (state.phase === "BLOCKED") return <p className="mt-3 rounded border border-block/50 bg-block/10 p-3 text-sm text-block">BLOCKED by deterministic findings. This proposal is unapprovable; public replay provides no override or decision control.</p>;
  if (state.phase === "APPROVAL_REQUIRED") return <p className="mt-3 text-sm text-ink-dim">The gate permits a human decision, but this public replay intentionally provides no approval or rejection control and records no decision.</p>;
  return <p className="mt-3 text-sm text-ink-dim">No decision has been made.</p>;
}

function WorkloadMatches({
  matches,
  service,
}: {
  readonly matches: readonly KubernetesResource[];
  readonly service: KubernetesResource;
}) {
  const [query, setQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const page = useMemo(
    () =>
      searchAndPageOfflineCollection(
        matches,
        query,
        resourceName,
        pageIndex,
        MAX_VISIBLE_NESTED_ITEMS,
      ),
    [matches, pageIndex, query],
  );
  const serviceLabel = resourceName(service);

  if (matches.length === 0) return <>No matching workload</>;
  return (
    <div className="min-w-72">
      <EvidencePager
        id={`workload-match-search-${service.resourceId}`}
        label={`Search matching workloads for ${serviceLabel}`}
        noun="workloads"
        onPageChange={setPageIndex}
        onQueryChange={(nextQuery) => {
          setQuery(nextQuery);
          setPageIndex(0);
        }}
        page={page}
        query={query}
      />
      <ul className="mt-2 grid gap-1">
        {page.items.map((workload) => (
          <li className="font-mono" key={workload.resourceId}>
            {resourceName(workload)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProposedDiff({
  proposal,
  snapshot,
}: {
  readonly proposal: KubernetesChangeProposal;
  readonly snapshot: KubernetesSnapshot;
}) {
  const existing = new Map(snapshot.resources.map((resource) => [resource.resourceId, resource]));
  const [query, setQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const page = useMemo(
    () =>
      searchAndPageOfflineCollection(
        proposal.operations,
        query,
        (operation) => JSON.stringify(operation),
        pageIndex,
      ),
    [pageIndex, proposal.operations, query],
  );

  return <div className="mt-3 grid min-w-0 gap-3">
    <p className="text-xs text-ink-faint">The complete {proposal.operations.length}-operation proposal remains available through search and paging; only the rendered operation cards are bounded.</p>
    <EvidencePager
      id="kubernetes-operation-search"
      label="Search all Kubernetes proposal operations"
      noun="operations"
      onPageChange={setPageIndex}
      onQueryChange={(nextQuery) => {
        setQuery(nextQuery);
        setPageIndex(0);
      }}
      page={page}
      query={query}
    />
    {page.items.map((operation) => {
    const before = existing.get(operation.value.resourceId);
    return <article className="min-w-0 rounded border border-edge bg-canvas p-3" key={operation.path}>
      <p className="font-mono text-xs text-ink-faint">{operation.op} · {operation.path}</p>
      <p className="mt-2 text-sm font-medium">{resourceName(operation.value)}</p>
      <p className="mt-1 text-sm text-ink-dim">{operation.reason}</p>
      <p className="mt-2 text-xs text-ink-faint">Evidence: {operation.evidenceIds.join(", ")}</p>
      <details className="mt-3" open={operation.op === "remove" || operation.op === "replace"}><summary className="cursor-pointer text-sm text-ink-dim">Inspect current / proposed manifest for {operation.path}</summary><DiffBlock after={operation.value} before={before ?? null} label={operation.path} /></details>
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
  const relationCandidates = useMemo(
    () => selectorRelationshipCandidates(fixture.snapshot),
    [fixture.snapshot],
  );
  const resolveRelationship = useMemo(
    () => createSelectorRelationshipResolver(fixture.snapshot),
    [fixture.snapshot],
  );
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourcePageIndex, setResourcePageIndex] = useState(0);
  const resourcePage = useMemo(
    () =>
      searchAndPageOfflineCollection(
        fixture.snapshot.resources,
        resourceQuery,
        (resource) => JSON.stringify(resource),
        resourcePageIndex,
      ),
    [fixture.snapshot.resources, resourcePageIndex, resourceQuery],
  );
  const [relationQuery, setRelationQuery] = useState("");
  const [relationPageIndex, setRelationPageIndex] = useState(0);
  const relationPage = useMemo(
    () =>
      searchAndPageOfflineCollection(
        relationCandidates,
        relationQuery,
        ({ service, selector }) =>
          `${resourceName(service)} ${JSON.stringify(selector)}`,
        relationPageIndex,
      ),
    [relationCandidates, relationPageIndex, relationQuery],
  );
  const visibleRelations = useMemo(
    () => relationPage.items.map(resolveRelationship),
    [relationPage.items, resolveRelationship],
  );
  const outcomeHeadingRef = useRef<HTMLSpanElement>(null);
  const canRunReplay = workflow.phase === "READY" || workflow.phase === "ERROR";
  const { setScenarioInUrl } = useScenarioDeepLink();
  const [unknownScenarioId, setUnknownScenarioId] = useState<string | null>(null);

  const selectExample = useCallback((sourceId: string) => {
    const nextFixture = fixtureFor(sourceId);
    const nextExample = exampleFor(sourceId);
    controller.rebind({ sourceId: nextFixture.sourceId, input: nextFixture.snapshot, expectedInputId: nextFixture.inputId, session: nextExample.session });
    setSelectedSourceId(sourceId);
    // Each scenario replays against its own snapshot, so evidence paging and
    // search from the previous selection no longer address anything.
    setResourceQuery("");
    setResourcePageIndex(0);
    setRelationQuery("");
    setRelationPageIndex(0);
    setScenarioInUrl(sourceId);
    setUnknownScenarioId(null);
  }, [controller, setScenarioInUrl]);

  useEffect(() => {
    const { requestedId, resolvedId } = readScenarioLookup(
      KUBERNETES_REVIEW_EXAMPLES.map((example) => example.sourceId),
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

  return <div className="min-h-screen bg-canvas text-ink">
    <header className="border-b border-edge bg-surface"><WorkbenchNav active="kubernetes" showSources /></header>
    <section className="border-b border-edge bg-overlay" aria-labelledby="runtime-title"><div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]"><div><p id="runtime-title" className="eyebrow text-ai">Public replay · Kubernetes offline sandbox</p><p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-dim">Inspect a schema-validated bundled Kubernetes snapshot and proposed manifest through the deterministic gate. No cluster is contacted, no manifest is applied, and this ephemeral surface cannot make or store a decision.</p></div><div role="group" aria-labelledby="runtime-variants-title" className="rounded-lg border border-edge bg-surface p-3"><p id="runtime-variants-title" className="eyebrow text-ink-faint">Runtime variant</p><p className="mt-2 rounded border border-active/50 bg-active/10 px-3 py-2 text-sm text-active">Examples / public replay · available</p><p className="mt-2 text-xs text-warn">Offline snapshot · no cluster contact · no durable review record</p></div></div></section>
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
      <main aria-busy={workflow.phase === "ANALYZING"} aria-label="Kubernetes review canvas" className="min-w-0 rounded-xl border border-edge bg-surface p-4 sm:p-6 lg:col-start-2 lg:row-start-1">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-edge pb-5">
          <div>
            <Label>Offline replay evaluation</Label>
            <h1 className="mt-2 text-xl font-semibold">{example.label}</h1>
            <PhasePill phase={workflow.phase} ref={outcomeHeadingRef} />
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim"><StateValue state={workflow} /></p>
            <p aria-atomic="true" aria-live="polite" className="sr-only" role="status"><ReplayStatus state={workflow} /></p>
          </div>
          <button className="rounded bg-active px-4 py-2 text-sm font-semibold text-action-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={!canRunReplay} onClick={() => void controller.analyze()} type="button">{workflow.phase === "ANALYZING" ? "Running replay…" : canRunReplay ? "Run replay" : "Replay evaluated"}</button>
        </header>
        <div className="mt-5 grid min-w-0 grid-cols-1 gap-4">
          <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="findings-title"><Label>Deterministic findings</Label><h2 id="findings-title" className="mt-2 text-base font-semibold">Image, security, selector, and protected-resource evidence</h2><FindingsPanel state={workflow} /></section>
          <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="proposal-title"><Label>Evaluated proposal</Label><h2 id="proposal-title" className="mt-2 text-base font-semibold">Replay result only</h2><ProposalPanel state={workflow} /></section>
          <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="inventory-title">
            <Label>Namespace inventory</Label>
            <h2 id="inventory-title" className="mt-2 text-base font-semibold">{fixture.snapshot.resources.length} captured offline resources</h2>
            <p className="mt-2 text-xs text-ink-faint">Deterministic evaluation always covers the complete snapshot; search and paging bound only the rendered inventory.</p>
            <EvidencePager
              id="kubernetes-resource-search"
              label="Search all Kubernetes resources"
              noun="resources"
              onPageChange={setResourcePageIndex}
              onQueryChange={(query) => {
                setResourceQuery(query);
                setResourcePageIndex(0);
              }}
              page={resourcePage}
              query={resourceQuery}
            />
            <ul className="mt-3 grid gap-2 text-sm">{resourcePage.items.map((resource) => <li className="rounded border border-edge bg-canvas p-3" key={resource.resourceId}><p className="font-medium">{resourceName(resource)}</p><p className="mt-1 font-mono text-xs text-ink-faint">{resource.resourceId}</p>{resourceLabelEntries(resource).length ? <p className="mt-2 text-xs text-ink-dim">Labels: {resourceLabelEntries(resource).map(([key, value]) => `${key}=${value}`).join(", ")}</p> : null}</li>)}</ul>
          </section>
          <section className="overflow-hidden rounded-lg border border-edge bg-raised" aria-labelledby="selector-title">
            <div className="p-4">
              <Label>Service selector relationships</Label>
              <h2 id="selector-title" className="mt-2 text-base font-semibold">Current snapshot relationships</h2>
              <p className="mt-2 text-xs text-ink-faint">Every Service relationship remains searchable. Workload matches are indexed and materialized only for visible rows, where each complete match set has its own search and deterministic pages.</p>
              <EvidencePager
                id="kubernetes-relation-search"
                label="Search all Kubernetes Service relationships"
                noun="relationships"
                onPageChange={setRelationPageIndex}
                onQueryChange={(query) => {
                  setRelationQuery(query);
                  setRelationPageIndex(0);
                }}
                page={relationPage}
                query={relationQuery}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-xs">
                <caption className="sr-only">Kubernetes Service selector relationships</caption>
                <thead className="border-y border-edge bg-surface text-ink-faint"><tr><th className="px-4 py-3 font-medium" scope="col">Service</th><th className="px-4 py-3 font-medium" scope="col">Selector</th><th className="px-4 py-3 font-medium" scope="col">Matching workloads</th></tr></thead>
                <tbody>{visibleRelations.map(({ service, selector, matches }) => <tr className="border-b border-edge align-top" key={service.resourceId}><th className="px-4 py-3 font-mono font-normal" scope="row">{resourceName(service)}</th><td className="px-4 py-3">{Object.entries(selector).map(([key, value]) => `${key}=${value}`).join(", ") || "No selector"}</td><td className="px-4 py-3"><WorkloadMatches matches={matches} service={service} /></td></tr>)}</tbody>
              </table>
            </div>
          </section>
          <section className="min-w-0 rounded-lg border border-edge bg-raised p-4" aria-labelledby="manifest-title"><Label>Current / proposed manifest diff</Label><h2 id="manifest-title" className="mt-2 text-base font-semibold">Bundled manifest proposal</h2><p className="mt-2 text-sm text-ink-dim">Image, workload security context, protected-resource labels, and Service selector effects are review evidence. Proposed manifests are data only and are never applied.</p><ProposedDiff proposal={fixture.proposal} snapshot={fixture.snapshot} /></section>
          <div>
            <DomainCoverageCatalog catalog={coverageCatalog} evaluatedPolicyIds={hasFindings(workflow) ? workflow.findings.map((finding) => finding.policyId) : []} simulationDisclosure="Kubernetes has an offline sandbox capability, but this public replay never requests simulation because it has no decision authority." source={{ sourceId: selectedSourceId, source: example.session.source, analysisMode: example.session.analysisMode, provenance: example.session.provenance }} />
          </div>
        </div>
      </main>
      <aside aria-label="Kubernetes review authority" className="min-w-0 self-start rounded-xl border border-edge bg-surface p-4 lg:sticky lg:top-4 lg:col-start-3 lg:row-start-1 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"><Label>Airlock status</Label><section className="mt-4 border-t border-edge pt-4" aria-labelledby="risk-title"><h2 id="risk-title" className="text-sm font-semibold">Risk</h2><RiskValue riskLevel={hasFindings(workflow) ? workflow.riskLevel : null} /></section><section className="mt-4 border-t border-edge pt-4" aria-labelledby="decision-title"><h2 id="decision-title" className="text-sm font-semibold">Decision</h2><DecisionPanel state={workflow} /></section><section className="mt-4 border-t border-edge pt-4" aria-labelledby="simulation-title"><h2 id="simulation-title" className="text-sm font-semibold">Simulation</h2><p className="mt-2 text-sm text-ink-dim">Unavailable and not run. Kubernetes has an offline sandbox capability, but public replay is decision-free and this route provides no validated simulation result.</p></section><section className="mt-4 border-t border-edge pt-4" aria-labelledby="receipt-title"><h2 id="receipt-title" className="text-sm font-semibold">Receipt</h2><p className="mt-2 text-sm text-ink-dim">Not created. This ephemeral public replay has no durable decision or signed receipt.</p></section><section className="mt-4 border-t border-edge pt-4" aria-labelledby="execution-title"><h2 id="execution-title" className="text-sm font-semibold">Cluster contact or apply</h2><p className="mt-2 text-sm text-ink-dim">Not performed or observed. ChangeSafe never contacts this cluster or applies infrastructure changes.</p></section></aside>
      <aside aria-label="Kubernetes review context" className="min-w-0 rounded-xl border border-edge bg-surface p-4 lg:col-start-1 lg:row-start-1"><Label>Kubernetes examples</Label><h2 className="mt-2 text-lg font-semibold">{fixture.label}</h2><ul className="mt-4 grid gap-2" role="list" aria-label="Bundled Kubernetes examples">{KUBERNETES_REVIEW_EXAMPLES.map((candidate) => <li key={candidate.sourceId}><button aria-pressed={candidate.sourceId === selectedSourceId} className={`w-full rounded border px-3 py-2 text-left text-sm hover:border-active focus:outline-none focus:ring-2 focus:ring-active disabled:cursor-wait ${candidate.sourceId === selectedSourceId ? "border-active bg-active/10 text-ink" : "border-edge text-ink-dim"}`} disabled={workflow.phase === "ANALYZING"} onClick={() => selectExample(candidate.sourceId)} type="button"><span className="block font-medium text-ink">{candidate.label}</span><span className="mt-1 block text-xs">{candidate.description}</span></button></li>)}</ul><section id="sources" className="mt-5 border-t border-edge pt-4" aria-labelledby="source-title"><h2 id="source-title" className="text-sm font-semibold">Offline source</h2><dl className="mt-3 grid gap-3 text-xs"><div><dt className="text-ink-faint">Snapshot ID</dt><dd className="mt-1 font-mono">{fixture.snapshot.snapshotId}</dd></div><div><dt className="text-ink-faint">Namespace</dt><dd className="mt-1">{fixture.snapshot.provenance.namespaces.join(", ")}</dd></div><div><dt className="text-ink-faint">Fixture provenance</dt><dd className="mt-1">{fixture.provenance}</dd></div><div><dt className="text-ink-faint">Policy version</dt><dd className="mt-1 font-mono">{example.session.policyVersion}</dd></div></dl></section></aside>
    </div>
  </div>;
}
