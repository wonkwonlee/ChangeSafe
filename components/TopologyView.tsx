import type { CurrentState, Topology } from "@changesafe/domain-network";

const ROLE_GLYPH: Record<string, string> = {
  "edge-router": "ER",
  "core-router": "CR",
  "distribution-switch": "SW",
  firewall: "FW",
  server: "SV",
  "mgmt-station": "MG",
};

/**
 * Deliberately plain topology sketch: nodes in a row, links as status-colored
 * lines. It is evidence, not decoration — statuses come straight from the
 * bundle.
 */
export function TopologyView({ topology, state }: { topology: Topology; state: CurrentState }) {
  const width = 460;
  const height = 132;
  const step = width / (topology.nodes.length + 1);
  const positions = new Map(
    topology.nodes.map((node, index) => [node.id, { x: step * (index + 1), y: 56 }]),
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Topology with ${topology.nodes.length} nodes and ${topology.links.length} links`}
      className="w-full"
    >
      {topology.links.map((link) => {
        const a = positions.get(link.a.nodeId);
        const b = positions.get(link.b.nodeId);
        if (!a || !b) return null;
        const stroke =
          link.status === "up" ? "var(--pass)" : link.status === "degraded" ? "var(--warn)" : "var(--block)";
        return (
          <g key={link.id}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={2} strokeDasharray={link.status === "degraded" ? "6 4" : undefined} />
            <title>{`${link.id}: ${link.status}`}</title>
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
              x={position.x - 26}
              y={position.y - 20}
              width={52}
              height={40}
              rx={6}
              fill="var(--raised)"
              stroke={isOrigin ? "var(--active)" : isProtected ? "var(--edge-strong)" : "var(--edge)"}
              strokeWidth={isOrigin ? 2 : 1.5}
            />
            <text
              x={position.x}
              y={position.y + 5}
              textAnchor="middle"
              fontFamily="var(--font-geist-mono)"
              fontSize="13"
              fontWeight="700"
              fill="var(--ink)"
            >
              {ROLE_GLYPH[node.role] ?? "ND"}
            </text>
            <text
              x={position.x}
              y={position.y + 38}
              textAnchor="middle"
              fontFamily="var(--font-geist-mono)"
              fontSize="10"
              fill="var(--ink-dim)"
            >
              {node.id}
            </text>
            {isProtected ? (
              <text x={position.x + 24} y={position.y - 24} textAnchor="end" fontSize="10" fill="var(--warn)">
                ⛨
              </text>
            ) : null}
            <title>
              {`${node.name} (${node.role})${node.mgmtIp ? ` mgmt ${node.mgmtIp}` : ""}${isOrigin ? " — management origin" : ""}${isProtected ? " — protected" : ""}`}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
