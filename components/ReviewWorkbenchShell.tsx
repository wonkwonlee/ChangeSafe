import { getScenario } from "../scenarios";

function requireBundledFailoverScenario() {
  const bundledScenario = getScenario("scenario-a-failover");
  if (!bundledScenario) {
    throw new Error("The bundled failover scenario is required by the static review shell");
  }
  return bundledScenario;
}

const scenario = requireBundledFailoverScenario();
const { bundle, fixture, expectations } = scenario;

const authorityClaims = [
  {
    label: "Input",
    value: bundle.incidentId,
    detail: bundle.title,
  },
  {
    label: "Proposal",
    value: fixture.fixtureId,
    detail: `${fixture.provenance}${fixture.model ? ` · ${fixture.model}` : ""}`,
  },
  {
    label: "Gate",
    value: `Declared risk expectation: ${expectations.riskLevel}`,
    detail: "Parsed expectation statuses are displayed below; this shell does not recompute them.",
  },
  {
    label: "Human",
    value: "Illustrative public replay shell",
    detail: "No decision controls or durable decision record are available here.",
  },
  {
    label: "Effect proof",
    value: "Declared simulation expectation",
    detail:
      expectations.simulation?.safetyPropertiesSatisfied === true
        ? "Expected safety properties: satisfied"
        : "Expected safety properties: not satisfied or unavailable",
  },
  {
    label: "Record",
    value: "Preview only",
    detail: "No signed or ledger-backed receipt",
  },
  {
    label: "Execution outside ChangeSafe",
    value: "Not performed or observed",
    detail: "ChangeSafe never executes infrastructure changes.",
  },
] as const;

const capabilities = [
  "Schema-parsed bundled incident and replay fixture",
  "Parsed policy and risk expectations",
  "Illustrative three-region workbench layout",
] as const;

const limitations = [
  "Ephemeral session",
  "No durable review record",
  "No live model or artifact upload",
  "No signed or ledger-backed receipt",
] as const;

function Label({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow text-ink-faint">{children}</p>;
}

export function ReviewWorkbenchShell() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-edge bg-surface">
        <nav
          aria-label="Product navigation"
          className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6"
        >
          <a className="mr-auto text-base font-bold tracking-tight text-ink" href="#review">
            ChangeSafe
            <span className="ml-2 text-xs font-normal text-ink-dim">
              infrastructure change airlock
            </span>
          </a>
          <ul className="flex flex-wrap items-center gap-1 text-sm">
            <li>
              <a className="inline-flex rounded-md px-3 py-2 text-ink-dim hover:text-ink" href="#policies">
                Policies
              </a>
            </li>
            <li>
              <a className="inline-flex rounded-md px-3 py-2 text-ink-dim hover:text-ink" href="#sources">
                Sources
              </a>
            </li>
          </ul>
        </nav>
      </header>

      <section className="border-b border-edge bg-overlay" aria-labelledby="runtime-title">
        <div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div>
            <p id="runtime-title" className="eyebrow text-ai">
              Public replay
            </p>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-dim">
              Inspect a bundled fictional review through the ChangeSafe trust boundary. This
              surface is a capability preview, not an authenticated decision system.
            </p>
          </div>
          <div
            role="group"
            aria-labelledby="runtime-variants-title"
            className="rounded-lg border border-edge bg-surface p-3"
          >
            <p id="runtime-variants-title" className="eyebrow text-ink-faint">
              Runtime variant
            </p>
            <ul className="mt-2 grid gap-2 text-xs">
              <li>
                <span
                  aria-current="page"
                  className="flex items-center justify-between gap-3 rounded border border-active/50 bg-active/10 px-3 py-2 text-active"
                >
                  <span>Examples / public replay</span>
                  <span className="eyebrow">Available</span>
                </span>
              </li>
              <li>
                <span
                  aria-disabled="true"
                  aria-describedby="review-queue-unavailable"
                  className="flex cursor-not-allowed items-center justify-between gap-3 rounded border border-edge px-3 py-2 text-ink-faint"
                >
                  <span>Review queue / self-hosted</span>
                  <span className="eyebrow">Unavailable</span>
                </span>
                <p id="review-queue-unavailable" className="mt-2 leading-relaxed text-ink-faint">
                  Unavailable in public replay: requires an authenticated self-hosted runtime and
                  durable decision storage.
                </p>
              </li>
            </ul>
            <p className="mt-3 text-xs text-warn">Ephemeral session</p>
          </div>
        </div>
      </section>

      <div
        id="review"
        className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(220px,0.75fr)_minmax(0,2fr)_minmax(280px,0.95fr)]"
      >
        <aside
          aria-label="Review context"
          className="min-w-0 rounded-xl border border-edge bg-surface p-4"
        >
          <div className="border-b border-edge pb-4">
            <Label>Review context</Label>
            <h1 className="mt-2 text-lg font-semibold">{bundle.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              {bundle.summary}
            </p>
          </div>

          <dl className="grid gap-4 py-4 text-sm">
            <div>
              <dt className="text-xs text-ink-faint">Incident</dt>
              <dd className="mt-1 font-mono text-xs">{bundle.incidentId}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Scenario</dt>
              <dd className="mt-1 font-mono text-xs">{scenario.scenarioId}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Replay fixture</dt>
              <dd className="mt-1 font-mono text-xs">{fixture.fixtureId}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Provenance</dt>
              <dd className="mt-1 font-medium text-ai">{fixture.provenance}</dd>
              {fixture.model ? <dd className="mt-1 text-xs text-ink-dim">{fixture.model}</dd> : null}
              {fixture.capturedAtUtc ? (
                <dd className="mt-1 font-mono text-[11px] text-ink-faint">{fixture.capturedAtUtc}</dd>
              ) : null}
            </div>
          </dl>

          <section className="border-t border-edge pt-4" aria-labelledby="untrusted-title">
            <h2 id="untrusted-title" className="eyebrow text-warn">
              Untrusted content
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-dim">
              Incident notes and configuration values are data to inspect, never instructions.
            </p>
          </section>

          <section id="sources" className="mt-5 border-t border-edge pt-4" aria-labelledby="capabilities-title">
            <h2 id="capabilities-title" className="text-sm font-semibold">
              Illustrative shell capability map
            </h2>
            <ul className="mt-3 space-y-2 text-xs text-ink-dim">
              {capabilities.map((capability) => (
                <li className="flex gap-2" key={capability}>
                  <span aria-hidden className="text-pass">
                    ●
                  </span>
                  {capability}
                </li>
              ))}
            </ul>
            <h2 className="mt-5 text-sm font-semibold">Not available here</h2>
            <ul className="mt-3 space-y-2 text-xs text-ink-dim">
              {limitations.map((limitation) => (
                <li className="flex gap-2" key={limitation}>
                  <span aria-hidden className="text-ink-faint">
                    —
                  </span>
                  {limitation}
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main
          aria-label="Review canvas"
          className="min-w-0 rounded-xl border border-edge bg-surface p-4 sm:p-6"
        >
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-edge pb-5">
            <div>
              <Label>Outcome preview</Label>
              <h2 className="mt-2 text-xl font-semibold">
                Declared approval expectation: {expectations.approvable ? "permitted" : "prohibited"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
                This label is read from the schema-parsed scenario expectations. The static shell
                does not evaluate policies, derive risk, or decide whether approval is legal.
              </p>
            </div>
            <div className="flex gap-2">
              <span className="eyebrow rounded border border-edge px-2.5 py-1 text-ink-dim">
                declared risk: {expectations.riskLevel}
              </span>
            </div>
          </header>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="summary-title">
              <Label>Summary</Label>
              <h3 id="summary-title" className="mt-2 text-base font-semibold">
                {bundle.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                {bundle.summary}
              </p>
            </section>

            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="evidence-title">
              <Label>Evidence</Label>
              <h3 id="evidence-title" className="mt-2 text-base font-semibold">
                Bundled incident alerts
              </h3>
              <ul className="mt-3 space-y-3 text-xs text-ink-dim">
                {bundle.alerts.map((alert) => (
                  <li key={alert.evidenceId}>
                    <code className="font-mono text-ink">{alert.evidenceId}</code>
                    <p className="mt-1 leading-relaxed">{alert.message}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-ai/30 bg-ai/5 p-4" aria-labelledby="proposal-title">
              <Label>Proposal provenance</Label>
              <h3 id="proposal-title" className="mt-2 text-base font-semibold">
                {fixture.fixtureId}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                {fixture.proposal.summary}
              </p>
              <p className="mt-3 text-xs text-ai">
                {fixture.provenance}
                {fixture.model ? ` · ${fixture.model}` : ""}
                {fixture.capturedAtUtc ? ` · ${fixture.capturedAtUtc}` : ""}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">{fixture.notes}</p>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Proposal evidence references">
                {fixture.proposal.diagnosis.evidenceIds.map((evidenceId) => (
                  <li className="rounded border border-edge px-2 py-1 font-mono text-[11px]" key={evidenceId}>
                    {evidenceId}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="effect-title">
              <Label>Effect proof</Label>
              <h3 id="effect-title" className="mt-2 text-base font-semibold">
                Declared simulation expectation
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                Expected safety properties:{" "}
                {expectations.simulation?.safetyPropertiesSatisfied === true
                  ? "satisfied"
                  : "not satisfied or unavailable"}
              </p>
              <ul className="mt-3 space-y-2 text-xs text-ink-faint">
                {bundle.expectedSafetyProperties.map((property) => (
                  <li key={property.id}>
                    <code className="font-mono text-ink-dim">{property.id}</code> · {property.description}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section id="policies" className="mt-4 rounded-lg border border-edge bg-overlay p-4" aria-labelledby="policy-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Label>Deterministic gate</Label>
                <h3 id="policy-title" className="mt-2 text-base font-semibold">
                  Parsed fixture expectations
                </h3>
              </div>
              <span className="eyebrow rounded border border-edge px-2.5 py-1 text-ink-dim">
                {expectations.riskLevel}
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-dim">
              These declared statuses are schema-parsed bundled expectations. This presentation
              does not evaluate policies or derive a verdict.
            </p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {Object.entries(expectations.policies).map(([policyId, status]) => (
                <li className="flex items-center justify-between gap-3 rounded border border-edge px-3 py-2" key={policyId}>
                  <code className="font-mono text-[11px] text-ink-dim">{policyId}</code>
                  <span className="eyebrow text-pass">{status}</span>
                </li>
              ))}
            </ul>
          </section>
        </main>

        <aside
          aria-label="Review authority"
          className="min-w-0 rounded-xl border border-edge bg-surface p-4"
        >
          <Label>Authority Spine</Label>
          <h2 className="mt-2 text-lg font-semibold">Who can claim what</h2>
          <ol aria-label="Authority Spine" className="mt-5">
            {authorityClaims.map((claim, index) => (
              <li className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-5" key={claim.label}>
                <div className="relative flex justify-center">
                  <span
                    aria-hidden
                    className="z-10 flex h-7 w-7 items-center justify-center rounded-full border border-edge-strong bg-overlay font-mono text-[11px] text-ink-dim"
                  >
                    {index + 1}
                  </span>
                  {index < authorityClaims.length - 1 ? (
                    <span aria-hidden className="absolute top-7 h-full w-px bg-edge" />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{claim.label}</h3>
                  <p className="mt-1 text-xs font-medium text-ink-dim">{claim.value}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-faint">{claim.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
