"use client";

import type { WorkflowController } from "./useWorkflow";

export function Header({ controller }: { controller: WorkflowController }) {
  const { state, scenarios, liveAvailable, selectScenario, reset } = controller;
  const busy = state.phase === "ANALYZING";

  return (
    <header className="border-b border-edge bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <div className="mr-auto">
          <p className="text-base font-bold tracking-tight">
            ChangeSafe
            <span className="ml-2 align-middle text-[13px] font-normal text-ink-dim">
              AI infrastructure change airlock
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            GPT-5.6 proposes · deterministic policies validate · a human decides · sandbox only
          </p>
        </div>

        <span
          className={`eyebrow rounded border px-2.5 py-1 ${
            liveAvailable === null
              ? "border-edge text-ink-faint"
              : liveAvailable
                ? "border-pass/50 text-pass"
                : "border-edge-strong text-ink-dim"
          }`}
          role="status"
          aria-label={
            liveAvailable === null
              ? "Checking live mode availability"
              : liveAvailable
                ? "Live GPT-5.6 mode available"
                : "Replay mode only — no API key configured"
          }
        >
          {liveAvailable === null ? "checking…" : liveAvailable ? "live available" : "replay only"}
        </span>

        <label className="flex items-center gap-2 text-xs text-ink-dim">
          <span className="eyebrow">Scenario</span>
          <select
            value={state.sourceId}
            disabled={busy}
            onChange={(event) => selectScenario(event.target.value)}
            className="rounded border border-edge bg-raised px-2 py-1.5 text-[13px] text-ink focus-visible:border-active disabled:opacity-50"
          >
            {scenarios.map((scenario) => (
              <option key={scenario.scenarioId} value={scenario.scenarioId}>
                {scenario.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="rounded border border-edge bg-raised px-3 py-1.5 text-[13px] text-ink-dim hover:border-edge-strong hover:text-ink disabled:opacity-50"
        >
          Reset scenario
        </button>
      </div>
    </header>
  );
}
