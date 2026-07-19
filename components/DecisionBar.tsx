"use client";

import type { WorkflowController } from "./useWorkflow";

/**
 * The only place APPROVED/REJECTED can originate. Blocked proposals render an
 * explanation instead of an enabled approve control — and even a tampered
 * button would be stopped by the domain state machine.
 */
export function DecisionBar({ controller }: { controller: WorkflowController }) {
  const { state, approve, reject, issueBlockedReceipt } = controller;

  if (state.phase === "BLOCKED") {
    const blockCount = state.findings.filter((finding) => finding.status === "BLOCK").length;
    return (
      <div className="rounded-lg border border-block/50 bg-block/10 p-4" role="alert">
        <p className="text-[14px] font-semibold text-block">Approval is not possible</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
          {blockCount} blocking finding{blockCount === 1 ? "" : "s"} above make this change
          unapprovable. This is enforced in the domain state machine, not just in this
          interface: no sequence of clicks or API calls can approve or simulate a blocked
          proposal.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Blocked proposals can never be approved"
            className="cursor-not-allowed rounded border border-edge bg-raised px-4 py-2 text-[13px] text-ink-faint"
          >
            Approve change
          </button>
          <button
            type="button"
            onClick={() => void issueBlockedReceipt()}
            className="rounded border border-block bg-block/20 px-4 py-2 text-[13px] font-medium text-block hover:bg-block/30"
          >
            Issue blocked receipt
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "APPROVAL_REQUIRED") {
    return (
      <div className="rounded-lg border border-active/40 bg-surface p-4">
        <p className="text-[14px] font-semibold">Your decision is required</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
          No blocking findings. Review the diagnosis, diff, and policy verdicts above.
          Approving runs the change in an in-memory sandbox only — real infrastructure is
          never touched.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void approve()}
            className="rounded border border-pass bg-pass/15 px-4 py-2 text-[13px] font-medium text-pass hover:bg-pass/25"
          >
            Approve &amp; simulate
          </button>
          <button
            type="button"
            onClick={() => void reject()}
            className="rounded border border-edge-strong bg-raised px-4 py-2 text-[13px] text-ink-dim hover:border-block/60 hover:text-block"
          >
            Reject change
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "APPROVED" || state.phase === "SIMULATED") {
    return (
      <p className="rounded-lg border border-pass/40 bg-pass/10 px-4 py-3 text-[13px] text-pass" role="status">
        Change approved by you — running sandbox simulation…
      </p>
    );
  }

  if (state.phase === "REJECTED") {
    return (
      <p className="rounded-lg border border-edge bg-surface px-4 py-3 text-[13px] text-ink-dim" role="status">
        Change rejected by you. Issuing receipt…
      </p>
    );
  }

  if (state.phase === "RECEIPT_ISSUED") {
    const tone =
      state.decision === "approved"
        ? "border-pass/40 text-pass"
        : state.decision === "rejected"
          ? "border-edge text-ink-dim"
          : "border-block/40 text-block";
    return (
      <p className={`rounded-lg border bg-surface px-4 py-3 text-[13px] ${tone}`} role="status">
        Final decision: <strong className="uppercase">{state.decision}</strong>
        {state.decision === "blocked"
          ? " — determined by policy, no human approval was possible."
          : " — recorded with your explicit action."}
      </p>
    );
  }

  return (
    <p className="rounded-lg border border-dashed border-edge px-4 py-3 text-[12px] text-ink-faint">
      Waiting for a validated proposal. Approve/reject controls unlock only when the safety
      gate finds no blocking violations.
    </p>
  );
}
