import type { LoadedDomainCoverageCatalog } from "@/features/domains/registry";
import type {
  ReviewAnalysisMode,
  ReviewProvenance,
  ReviewSource,
} from "@/features/domains/review-contract";

export interface DomainCoverageSource {
  readonly sourceId: string;
  readonly source: ReviewSource;
  readonly analysisMode: ReviewAnalysisMode;
  readonly provenance: ReviewProvenance;
}

interface DomainCoverageCatalogProps {
  readonly catalog: LoadedDomainCoverageCatalog;
  readonly source: DomainCoverageSource;
  readonly evaluatedPolicyIds: readonly string[];
  readonly simulationDisclosure: string;
}

function Definition({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-ink-faint">{term}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

/**
 * Generic coverage fallback for every registered domain.
 *
 * The component receives data only: it cannot evaluate policy, import an
 * adapter, or imply that a loaded policy ran before a finding exists.
 */
export function DomainCoverageCatalog({
  catalog,
  source,
  evaluatedPolicyIds,
  simulationDisclosure,
}: DomainCoverageCatalogProps) {
  const evaluated = new Set(evaluatedPolicyIds);
  const { registration, runtime } = catalog;
  const coverage = runtime.policyCoverage;
  const pack = coverage.baselinePack.parameters;

  return (
    <section
      aria-labelledby={`${registration.domainId}-coverage-title`}
      className="rounded-lg border border-edge bg-raised p-4"
      data-domain-coverage={registration.domainId}
    >
      <p className="eyebrow text-ink-faint">Policy coverage</p>
      <h3
        className="mt-2 text-base font-semibold"
        id={`${registration.domainId}-coverage-title`}
      >
        Registered, loaded, and evaluated evidence
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-dim">
        Registry metadata identifies the domain without loading its adapter.
        Loaded coverage comes from the deterministic runtime. A policy is
        marked evaluated only when the current review returned its finding.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-edge bg-canvas p-3">
          <p className="eyebrow text-active">Registered metadata</p>
          <dl className="mt-3 grid gap-3 text-xs">
            <Definition term="Domain">
              {registration.label} ·{" "}
              <span className="font-mono">{registration.domainId}</span>
            </Definition>
            <Definition term="Contract">
              <span className="font-mono">{registration.contractVersion}</span>
            </Definition>
            <Definition term="Shape">{registration.domainShape}</Definition>
            <Definition term="Declared capabilities">
              graph {registration.capabilities.resourceGraph ? "yes" : "no"} ·
              structured diff{" "}
              {registration.capabilities.structuredDiff ? "yes" : "no"} ·
              untrusted context{" "}
              {registration.capabilities.untrustedContext ? "yes" : "no"}
            </Definition>
          </dl>
        </div>

        <div className="rounded border border-edge bg-canvas p-3">
          <p className="eyebrow text-ai">Loaded deterministic coverage</p>
          <dl className="mt-3 grid gap-3 text-xs">
            <Definition term="Policy version">
              <span className="font-mono">{runtime.policyVersion}</span>
            </Definition>
            <Definition term="Baseline pack">
              {coverage.baselinePack.name} · {coverage.baselinePack.source}
            </Definition>
            <Definition term="Blast radius">
              warn at {pack.blastRadius.warnAt} · block above{" "}
              {pack.blastRadius.blockAbove}
            </Definition>
            <Definition term="Verification">
              precondition{" "}
              {pack.verification.requirePrecondition ? "required" : "optional"}{" "}
              · postcheck{" "}
              {pack.verification.requirePostcheck ? "required" : "optional"}
            </Definition>
          </dl>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded border border-edge">
        <table className="min-w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            Ordered deterministic policy coverage for {registration.label}
          </caption>
          <thead className="border-b border-edge bg-surface text-ink-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Policy</th>
              <th className="px-3 py-2 font-medium">Current review</th>
            </tr>
          </thead>
          <tbody>
            {coverage.orderedPolicyIds.map((policyId, index) => (
              <tr className="border-b border-edge last:border-b-0" key={policyId}>
                <td className="px-3 py-2">{index + 1}</td>
                <td className="px-3 py-2 font-mono">{policyId}</td>
                <td className="px-3 py-2">
                  {evaluated.has(policyId)
                    ? "evaluated · finding returned"
                    : "loaded · not yet evaluated"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {coverage.skippedPolicies.length > 0 ? (
        <div className="mt-4 rounded border border-warn/50 bg-warn/10 p-3">
          <p className="eyebrow text-warn">Explicit policy skips</p>
          <ul className="mt-2 grid gap-2 text-xs">
            {coverage.skippedPolicies.map((skip) => (
              <li key={skip.policyId}>
                <span className="font-mono">{skip.policyId}</span> —{" "}
                {skip.because} Replacement: {skip.replacedBy}.
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-xs text-ink-dim">
          Explicit policy skips: none.
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-edge bg-canvas p-3">
          <p className="eyebrow text-ink-faint">Source provenance</p>
          <dl className="mt-3 grid gap-3 text-xs">
            <Definition term="Source ID">
              <span className="font-mono">{source.sourceId}</span>
            </Definition>
            <Definition term="Source">{source.source}</Definition>
            <Definition term="Analysis mode">{source.analysisMode}</Definition>
            <Definition term="Provenance">{source.provenance}</Definition>
          </dl>
        </div>
        <div className="rounded border border-edge bg-canvas p-3">
          <p className="eyebrow text-ink-faint">Simulation and limitations</p>
          <p className="mt-2 text-xs text-ink-dim">
            Sandbox simulation capability:{" "}
            {runtime.capabilities.sandboxSimulation ? "available" : "unavailable"}.
          </p>
          <p className="mt-2 text-xs text-ink-dim">{simulationDisclosure}</p>
          <ul className="mt-2 grid gap-2 text-xs text-ink-dim">
            {coverage.limitations.map((limitation) => (
              <li key={limitation}>• {limitation}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
