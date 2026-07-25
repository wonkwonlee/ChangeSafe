"use client";

import { StageCard, StageHeader, type StageTone } from "./atoms";
import { DecisionBar } from "./DecisionBar";
import { Header } from "./Header";
import { IncidentPanel } from "./IncidentPanel";
import { PolicyGate } from "./PolicyGate";
import { ProposalPanel } from "./ProposalPanel";
import { ReceiptPanel } from "./ReceiptPanel";
import { SimulationPanel } from "./SimulationPanel";
import { useWorkflow } from "./useWorkflow";

function WaitingNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-edge px-4 py-3 text-[12px] text-ink-faint">
      {children}
    </p>
  );
}

export function ChangeSafeApp() {
  const controller = useWorkflow();
  const { state, liveAvailable, analysisMeta, replayOffer, analyze } = controller;

  const hasProposal =
    state.phase === "PROPOSED" ||
    state.phase === "VALIDATED" ||
    state.phase === "BLOCKED" ||
    state.phase === "APPROVAL_REQUIRED" ||
    state.phase === "APPROVED" ||
    state.phase === "REJECTED" ||
    state.phase === "SIMULATED" ||
    state.phase === "RECEIPT_ISSUED";

  const hasFindings = hasProposal && state.phase !== "PROPOSED";

  const proposalTone: StageTone =
    state.phase === "ANALYZING" ? "active" : hasProposal ? "ai" : "idle";

  const gateTone: StageTone = !hasFindings
    ? "idle"
    : state.findings.some((finding) => finding.status === "BLOCK")
      ? "block"
      : state.findings.some((finding) => finding.status === "WARN")
        ? "warn"
        : "pass";

  const decisionTone: StageTone =
    state.phase === "APPROVAL_REQUIRED"
      ? "active"
      : state.phase === "BLOCKED"
        ? "block"
        : state.phase === "APPROVED" || state.phase === "SIMULATED"
          ? "pass"
          : state.phase === "REJECTED"
            ? "warn"
            : state.phase === "RECEIPT_ISSUED"
              ? state.decision === "approved"
                ? "pass"
                : state.decision === "rejected"
                  ? "warn"
                  : "block"
              : "idle";

  const simulationRan =
    state.phase === "SIMULATED" ||
    (state.phase === "RECEIPT_ISSUED" && state.simulation !== null);

  const simulationTone: StageTone =
    state.phase === "APPROVED" ? "active" : simulationRan ? "pass" : "idle";

  const receiptTone: StageTone = state.phase === "RECEIPT_ISSUED" ? "pass" : "idle";

  return (
    <div className="flex min-h-screen flex-col">
      <Header controller={controller} />

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-w-0">
          <IncidentPanel bundle={state.input} />
        </div>

        <div aria-label="Change airlock workflow" className="min-w-0">
          {/* Stage 1 — AI proposal */}
          <StageHeader number={1} title="Analysis & proposal" authority="AI PROPOSAL" tone={proposalTone} />
          <StageCard>
            {state.phase === "READY" ? (
              <div className="rounded-lg border border-edge bg-surface p-4">
                <p className="text-[13px] leading-relaxed text-ink-dim">
                  Run the analysis to get an evidence-cited diagnosis and a typed, declarative
                  change proposal. The proposal is only an input to the deterministic gate below —
                  it can never approve or execute anything.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {liveAvailable ? (
                    <button
                      type="button"
                      onClick={() => void analyze("live")}
                      className="rounded border border-ai bg-ai/15 px-4 py-2 text-[13px] font-medium text-ai hover:bg-ai/25"
                    >
                      Analyze with GPT-5.6
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void analyze("replay")}
                    className={
                      liveAvailable
                        ? "rounded border border-edge-strong bg-raised px-4 py-2 text-[13px] text-ink-dim hover:text-ink"
                        : "rounded border border-ai bg-ai/15 px-4 py-2 text-[13px] font-medium text-ai hover:bg-ai/25"
                    }
                  >
                    Run replay analysis
                  </button>
                  {liveAvailable === false ? (
                    <span className="text-[11px] text-ink-faint">
                      Live mode is not configured (no server API key). Replay uses a bundled,
                      clearly labeled fixture and runs the full validation pipeline.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {state.phase === "ANALYZING" ? (
              <div className="rounded-lg border border-edge bg-surface p-4" role="status" aria-live="polite">
                <p className="text-[13px] text-ink-dim">
                  {state.mode === "live"
                    ? "GPT-5.6 is analyzing the incident…"
                    : "Loading replay fixture and validating…"}
                </p>
                <div className="mt-3 h-1 w-full overflow-hidden rounded bg-sunken" aria-hidden>
                  <div className="h-1 w-1/3 animate-pulse rounded bg-ai/60" />
                </div>
              </div>
            ) : null}

            {state.phase === "ERROR" ? (
              <div className="rounded-lg border border-block/50 bg-block/10 p-4" role="alert">
                <p className="text-[14px] font-semibold text-block">Analysis failed safely</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{state.userMessage}</p>
                <p className="mt-1 text-[12px] text-ink-faint">
                  No proposal was kept and no state was changed.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {replayOffer ? (
                    <button
                      type="button"
                      onClick={() => void analyze("replay")}
                      className="rounded border border-active bg-active/15 px-4 py-2 text-[13px] font-medium text-active hover:bg-active/25"
                    >
                      Switch to replay analysis
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void analyze("replay")}
                      className="rounded border border-active bg-active/15 px-4 py-2 text-[13px] font-medium text-active hover:bg-active/25"
                    >
                      Try replay analysis
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={controller.reset}
                    className="rounded border border-edge bg-raised px-4 py-2 text-[13px] text-ink-dim hover:text-ink"
                  >
                    Back to ready
                  </button>
                </div>
              </div>
            ) : null}

            {hasProposal ? (
              <ProposalPanel
                bundle={state.input}
                proposal={state.proposal}
                mode={state.mode}
                provenance={state.provenance}
                meta={analysisMeta}
              />
            ) : null}
          </StageCard>

          {/* Stage 2 — deterministic safety gate */}
          <StageHeader number={2} title="Policy validation" authority="DETERMINISTIC SAFETY GATE" tone={gateTone} />
          <StageCard>
            {hasFindings ? (
              <PolicyGate findings={state.findings} riskLevel={state.riskLevel} />
            ) : (
              <WaitingNote>
                Waiting for a proposal. Seven frozen policies will evaluate it with pure,
                model-free code.
              </WaitingNote>
            )}
          </StageCard>

          {/* Stage 3 — human decision */}
          <StageHeader number={3} title="Decision" authority="HUMAN DECISION" tone={decisionTone} />
          <StageCard>
            <DecisionBar controller={controller} />
          </StageCard>

          {/* Stage 4 — sandbox simulation */}
          <StageHeader number={4} title="Sandbox simulation" authority="DETERMINISTIC SANDBOX" tone={simulationTone} />
          <StageCard>
            {simulationRan && (state.phase === "SIMULATED" || state.phase === "RECEIPT_ISSUED") ? (
              state.phase === "SIMULATED" ? (
                <SimulationPanel simulation={state.simulation} />
              ) : state.simulation ? (
                <SimulationPanel simulation={state.simulation} />
              ) : null
            ) : state.phase === "APPROVED" ? (
              <WaitingNote>Applying the validated patch to an in-memory copy…</WaitingNote>
            ) : state.phase === "RECEIPT_ISSUED" || state.phase === "REJECTED" || state.phase === "BLOCKED" ? (
              <WaitingNote>
                Not run — simulation only executes for changes a human approved.
              </WaitingNote>
            ) : (
              <WaitingNote>
                Runs only after your approval, against a deep-cloned synthetic state. Real
                infrastructure is never contacted.
              </WaitingNote>
            )}
          </StageCard>

          {/* Stage 5 — receipt */}
          <StageHeader number={5} title="Change receipt" authority="AUDIT RECORD" tone={receiptTone} />
          <StageCard last>
            {state.phase === "RECEIPT_ISSUED" ? (
              <ReceiptPanel receipt={state.receipt} />
            ) : (
              <WaitingNote>
                Every outcome — approved, rejected, or blocked — ends in a SHA-256 hashed,
                downloadable receipt.
              </WaitingNote>
            )}
          </StageCard>
        </div>
      </main>

      <footer className="border-t border-edge bg-surface">
        <p className="mx-auto max-w-7xl px-4 py-3 text-[11px] leading-relaxed text-ink-faint sm:px-6">
          All incidents, devices, and addresses are synthetic (documentation ranges only).
          ChangeSafe has no connection to real infrastructure: no SSH, no device APIs, no
          command execution. AI proposes; deterministic policies validate; you decide.
        </p>
      </footer>
    </div>
  );
}
