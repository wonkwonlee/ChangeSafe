import type { CurrentState } from "@changesafe/domain-network";

function statusColor(status: "up" | "degraded" | "down"): string {
  return status === "up" ? "bg-pass" : status === "degraded" ? "bg-warn" : "bg-block";
}

/** Compact declarative state: the exact structure patch paths operate on. */
export function StateTree({ state }: { state: CurrentState }) {
  return (
    <section className="rounded-lg border border-edge bg-surface p-4">
      <h2 className="eyebrow text-ink-faint">Current state</h2>
      <p className="mt-1 text-[11px] text-ink-faint">
        Management origin{" "}
        <code className="font-mono text-ink-dim">{state.management.originNodeId}</code> must reach{" "}
        {state.management.protectedTargetNodeIds.map((target, index) => (
          <span key={target}>
            {index > 0 ? ", " : ""}
            <code className="font-mono text-ink-dim">{target}</code>
          </span>
        ))}
        .
      </p>
      <div className="mt-3 space-y-4">
        {Object.values(state.devices).map((device) => (
          <details key={device.id} open={Object.keys(device.routes).length > 0}>
            <summary className="cursor-pointer select-none font-mono text-xs text-ink">
              {device.id}
              {device.protected ? (
                <span className="eyebrow ml-2 rounded border border-warn/50 px-1.5 py-0.5 text-warn">
                  protected
                </span>
              ) : null}
            </summary>
            <div className="mt-2 space-y-2 border-l border-edge pl-3">
              <ul className="space-y-1">
                {Object.values(device.interfaces).map((iface) => (
                  <li key={iface.id} className="flex items-center gap-2 font-mono text-[11px] text-ink-dim">
                    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${statusColor(iface.status)}`} />
                    <span>{iface.id}</span>
                    <span className="text-ink-faint">{iface.enabled ? "enabled" : "disabled"}</span>
                    {iface.metrics?.errorRatePct !== undefined ? (
                      <span className="text-ink-faint">err {iface.metrics.errorRatePct}%</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {Object.keys(device.routes).length > 0 ? (
                <div className="overflow-x-auto">
                <table className="w-full min-w-64 text-left font-mono text-[11px]">
                  <thead>
                    <tr className="text-ink-faint">
                      <th className="py-1 pr-2 font-normal">route</th>
                      <th className="py-1 pr-2 font-normal">dest → next hop</th>
                      <th className="py-1 font-normal">metric</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(device.routes).map((route) => (
                      <tr key={route.id} className="align-top text-ink-dim">
                        <td className="py-1 pr-2">
                          {route.id}
                          {route.protected ? <span className="ml-1 text-warn">⛨</span> : null}
                        </td>
                        <td className="py-1 pr-2 break-all">
                          {route.destination} → {route.nextHop}
                        </td>
                        <td className="py-1">{route.metric}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              ) : (
                <p className="font-mono text-[11px] text-ink-faint">no modeled routes (passive)</p>
              )}
              {Object.keys(device.routing.preferences).length > 0 ? (
                <p className="font-mono text-[11px] text-ink-faint">
                  preferences:{" "}
                  {Object.entries(device.routing.preferences)
                    .map(([key, value]) => `${key}=${String(value)}`)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
