const authorityClaims = [
  {
    label: "Input",
    value: "Bundled, validated fixture",
    detail: "Fictional network incident data; artifact text remains untrusted.",
  },
  {
    label: "Proposal",
    value: "Captured replay",
    detail: "Evidence-cited fixture output, not a live model response.",
  },
  {
    label: "Gate",
    value: "Deterministic preview",
    detail: "Policy findings and risk are presented as fixture data in this shell.",
  },
  {
    label: "Human",
    value: "Decision unavailable",
    detail: "Public replay does not create or persist human decisions.",
  },
  {
    label: "Effect proof",
    value: "Sandbox replay",
    detail: "Effect evidence describes an in-memory synthetic-state simulation.",
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
  "Bundled, validated fixture",
  "Deterministic policy result preview",
  "Synthetic sandbox effect proof",
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
              <a
                aria-current="page"
                className="inline-flex rounded-md bg-active/10 px-3 py-2 font-medium text-active"
                href="#review"
              >
                Examples
              </a>
            </li>
            <li>
              <span
                aria-disabled="true"
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-ink-faint"
              >
                Review queue
                <span className="eyebrow rounded-full border border-edge px-2 py-0.5">
                  self-hosted
                </span>
              </span>
            </li>
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
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-start justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p id="runtime-title" className="eyebrow text-ai">
              Public replay
            </p>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-dim">
              Inspect a bundled fictional review through the ChangeSafe trust boundary. This
              surface is a capability preview, not an authenticated decision system.
            </p>
          </div>
          <div className="rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-xs text-warn">
            Ephemeral session
          </div>
        </div>
      </section>

      <div
        id="review"
        className="mx-auto grid max-w-[1600px] gap-4 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(220px,0.75fr)_minmax(0,2fr)_minmax(280px,0.95fr)]"
      >
        <aside
          aria-label="Review context"
          className="min-w-0 rounded-xl border border-edge bg-surface p-4"
        >
          <div className="border-b border-edge pb-4">
            <Label>Review context</Label>
            <h1 className="mt-2 text-lg font-semibold">Network replay example</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              A fictional management-path change prepared for deterministic review.
            </p>
          </div>

          <dl className="grid gap-4 py-4 text-sm">
            <div>
              <dt className="text-xs text-ink-faint">Domain</dt>
              <dd className="mt-1 font-medium">Network</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Source</dt>
              <dd className="mt-1 font-medium">Bundled example</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Provenance</dt>
              <dd className="mt-1 font-medium text-ai">Captured replay fixture</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Runtime</dt>
              <dd className="mt-1 font-medium">Public replay</dd>
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
              Available here
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
              <h2 className="mt-2 text-xl font-semibold">Change is eligible for human review</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
                The static fixture shows no blocking finding. Human authority is described here,
                but decision actions require a self-hosted authenticated runtime.
              </p>
            </div>
            <div className="flex gap-2">
              <span className="eyebrow rounded border border-pass/50 bg-pass/10 px-2.5 py-1 text-pass">
                7 pass
              </span>
              <span className="eyebrow rounded border border-edge px-2.5 py-1 text-ink-dim">
                risk: low
              </span>
            </div>
          </header>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="summary-title">
              <Label>Summary</Label>
              <h3 id="summary-title" className="mt-2 text-base font-semibold">
                Preserve management reachability
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                The replayed proposal changes one fictional route while retaining a protected
                management path and a complete rollback operation.
              </p>
            </section>

            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="evidence-title">
              <Label>Evidence</Label>
              <h3 id="evidence-title" className="mt-2 text-base font-semibold">
                Two cited observations
              </h3>
              <ul className="mt-3 space-y-2 font-mono text-xs text-ink-dim">
                <li>evt-1042 · route degradation detected</li>
                <li>topo-core-01 · alternate management path present</li>
              </ul>
            </section>

            <section className="rounded-lg border border-ai/30 bg-ai/5 p-4" aria-labelledby="proposal-title">
              <Label>Proposal provenance</Label>
              <h3 id="proposal-title" className="mt-2 text-base font-semibold">
                Captured model replay
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                Declarative operations are displayed as untrusted proposal data until the
                deterministic gate validates them.
              </p>
            </section>

            <section className="rounded-lg border border-edge bg-raised p-4" aria-labelledby="effect-title">
              <Label>Effect proof</Label>
              <h3 id="effect-title" className="mt-2 text-base font-semibold">
                Synthetic state restored
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                Fixture evidence reports transactional simulation and canonical rollback equality.
                No real system was contacted.
              </p>
            </section>
          </div>

          <section id="policies" className="mt-4 rounded-lg border border-edge bg-overlay p-4" aria-labelledby="policy-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Label>Deterministic gate</Label>
                <h3 id="policy-title" className="mt-2 text-base font-semibold">
                  Frozen policy result preview
                </h3>
              </div>
              <span className="eyebrow rounded border border-pass/50 px-2.5 py-1 text-pass">
                no blocks
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-dim">
              Policy findings, risk, and legal workflow transitions come from deterministic code
              in the working product. This static shell does not recompute them.
            </p>
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
