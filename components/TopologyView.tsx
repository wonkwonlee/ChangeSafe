import type { CurrentState, Topology } from "@changesafe/domain-network";

const ROLE_GLYPH: Record<string, string> = {
  "edge-router": "ER",
  "core-router": "CR",
  "distribution-switch": "SW",
  firewall: "FW",
  server: "SV",
  "mgmt-station": "MG",
};

function nodeFlags(nodeId: string, state: CurrentState): string {
  const flags = [
    state.management.originNodeId === nodeId ? "management origin" : null,
    state.devices[nodeId]?.protected ? "protected" : null,
  ].filter((flag): flag is string => flag !== null);
  return flags.join(", ") || "standard";
}

/**
 * Visual topology sketch plus a visible, keyboard-discoverable data
 * equivalent. The SVG is decorative because the tables contain every node,
 * endpoint, link status, management-origin, and protection claim.
 */
export function TopologyView({
  topology,
  state,
}: {
  topology: Topology;
  state: CurrentState;
}) {
  const width = 460;
  const height = 132;
  const step = width / (topology.nodes.length + 1);
  const positions = new Map(
    topology.nodes.map((node, index) => [
      node.id,
      { x: step * (index + 1), y: 56 },
    ]),
  );

  return (
    <div className="grid min-w-0 gap-3">
      <svg
        aria-hidden="true"
        className="w-full"
        focusable="false"
        viewBox={`0 0 ${width} ${height}`}
      >
        {topology.links.map((link) => {
          const a = positions.get(link.a.nodeId);
          const b = positions.get(link.b.nodeId);
          if (!a || !b) return null;
          const stroke =
            link.status === "up"
              ? "var(--pass)"
              : link.status === "degraded"
                ? "var(--warn)"
                : "var(--block)";
          return (
            <g key={link.id}>
              <line
                stroke={stroke}
                strokeDasharray={link.status === "degraded" ? "6 4" : undefined}
                strokeWidth={2}
                x1={a.x}
                x2={b.x}
                y1={a.y}
                y2={b.y}
              />
            </g>
          );
        })}
        {topology.nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          const isProtected = state.devices[node.id]?.protected ?? false;
          const isOrigin = state.management.originNodeId === node.id;
          return (
            <g key={node.id}>
              <rect
                fill="var(--raised)"
                height={40}
                rx={6}
                stroke={
                  isOrigin
                    ? "var(--active)"
                    : isProtected
                      ? "var(--edge-strong)"
                      : "var(--edge)"
                }
                strokeWidth={isOrigin ? 2 : 1.5}
                width={52}
                x={position.x - 26}
                y={position.y - 20}
              />
              <text
                fill="var(--ink)"
                fontFamily="var(--font-geist-mono)"
                fontSize="13"
                fontWeight="700"
                textAnchor="middle"
                x={position.x}
                y={position.y + 5}
              >
                {ROLE_GLYPH[node.role] ?? "ND"}
              </text>
              <text
                fill="var(--ink-dim)"
                fontFamily="var(--font-geist-mono)"
                fontSize="10"
                textAnchor="middle"
                x={position.x}
                y={position.y + 38}
              >
                {node.id}
              </text>
              {isProtected ? (
                <text
                  fill="var(--warn)"
                  fontSize="10"
                  textAnchor="end"
                  x={position.x + 24}
                  y={position.y - 24}
                >
                  ⛨
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <p className="text-xs leading-relaxed text-ink-dim">
        The diagram is decorative. The tables below expose the same node,
        endpoint, link-status, management-origin, and protection evidence.
      </p>
      <details className="min-w-0 rounded border border-edge bg-canvas" open>
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">
          Accessible topology tables
        </summary>
        <div className="grid gap-4 border-t border-edge p-3">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-xs">
              <caption>Network nodes</caption>
              <thead className="border-y border-edge bg-surface text-ink-faint">
                <tr>
                  <th className="px-3 py-2 font-medium" scope="col">Node ID</th>
                  <th className="px-3 py-2 font-medium" scope="col">Name</th>
                  <th className="px-3 py-2 font-medium" scope="col">Role</th>
                  <th className="px-3 py-2 font-medium" scope="col">Management IP</th>
                  <th className="px-3 py-2 font-medium" scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {topology.nodes.map((node) => (
                  <tr className="border-b border-edge last:border-b-0" key={node.id}>
                    <th className="px-3 py-2 font-mono font-medium" scope="row">
                      {node.id}
                    </th>
                    <td className="px-3 py-2">{node.name}</td>
                    <td className="px-3 py-2">{node.role}</td>
                    <td className="px-3 py-2 font-mono">
                      {node.mgmtIp ?? "Not declared"}
                    </td>
                    <td className="px-3 py-2">{nodeFlags(node.id, state)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-xs">
              <caption>Network links</caption>
              <thead className="border-y border-edge bg-surface text-ink-faint">
                <tr>
                  <th className="px-3 py-2 font-medium" scope="col">Link ID</th>
                  <th className="px-3 py-2 font-medium" scope="col">Endpoint A</th>
                  <th className="px-3 py-2 font-medium" scope="col">Endpoint B</th>
                  <th className="px-3 py-2 font-medium" scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {topology.links.map((link) => (
                  <tr className="border-b border-edge last:border-b-0" key={link.id}>
                    <th className="px-3 py-2 font-mono font-medium" scope="row">
                      {link.id}
                    </th>
                    <td className="px-3 py-2 font-mono">
                      {link.a.nodeId} · {link.a.interfaceId}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {link.b.nodeId} · {link.b.interfaceId}
                    </td>
                    <td className="px-3 py-2">{link.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
