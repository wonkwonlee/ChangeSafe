import type { CurrentState, Topology } from "./schemas";

/**
 * Deterministic management-plane reachability over the synthetic model.
 *
 * A link is traversable when its topology status is not "down" and both
 * endpoint interfaces are enabled (endpoints without modeled device state or
 * interface entries are treated as enabled — they are passive).
 *
 * L3 rule: a device that models at least one route participates in forwarding
 * only if some route's destination covers the target's management IP. Devices
 * with zero routes are passive (hosts/switches) and forward freely. The target
 * itself must hold a route back to the origin's management IP under the same
 * rule. Targets without a management IP are evaluated at layer 2 only.
 */

export interface ReachabilityInput {
  topology: Topology;
  state: CurrentState;
  originNodeId: string;
  targetNodeId: string;
}

export type ReachabilityResult =
  | { reachable: true }
  | { reachable: false; reason: string };

export function checkReachability(input: ReachabilityInput): ReachabilityResult {
  const { topology, state, originNodeId, targetNodeId } = input;

  if (originNodeId === targetNodeId) return { reachable: true };

  const targetIp = topology.nodes.find((node) => node.id === targetNodeId)?.mgmtIp;
  const originIp = topology.nodes.find((node) => node.id === originNodeId)?.mgmtIp;

  const forwardsToward = (nodeId: string, ip: string | undefined): boolean => {
    if (ip === undefined) return true; // layer-2 only evaluation
    const device = state.devices[nodeId];
    if (!device) return true; // unmodeled node is passive
    const routes = Object.values(device.routes);
    if (routes.length === 0) return true; // passive host
    return routes.some((route) => cidrContains(route.destination, ip));
  };

  const interfaceEnabled = (nodeId: string, interfaceId: string): boolean => {
    const iface = state.devices[nodeId]?.interfaces[interfaceId];
    return iface ? iface.enabled : true;
  };

  const neighbors = new Map<string, string[]>();
  for (const link of topology.links) {
    if (link.status === "down") continue;
    if (!interfaceEnabled(link.a.nodeId, link.a.interfaceId)) continue;
    if (!interfaceEnabled(link.b.nodeId, link.b.interfaceId)) continue;
    neighbors.set(link.a.nodeId, [...(neighbors.get(link.a.nodeId) ?? []), link.b.nodeId]);
    neighbors.set(link.b.nodeId, [...(neighbors.get(link.b.nodeId) ?? []), link.a.nodeId]);
  }

  const visited = new Set<string>([originNodeId]);
  const queue: string[] = [originNodeId];

  if (!forwardsToward(originNodeId, targetIp)) {
    return {
      reachable: false,
      reason: `origin "${originNodeId}" has no route covering the management address of "${targetNodeId}"`,
    };
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    for (const next of neighbors.get(current) ?? []) {
      if (visited.has(next)) continue;

      if (next === targetNodeId) {
        // Return path: the target must be able to route back to the origin.
        if (!forwardsToward(targetNodeId, originIp)) {
          return {
            reachable: false,
            reason: `target "${targetNodeId}" has no route back to the management origin`,
          };
        }
        return { reachable: true };
      }

      // Transit nodes must forward toward the target's management address.
      if (!forwardsToward(next, targetIp)) {
        visited.add(next);
        continue;
      }

      visited.add(next);
      queue.push(next);
    }
  }

  return {
    reachable: false,
    reason: `no usable path from "${originNodeId}" to "${targetNodeId}" in the patched state`,
  };
}

export function cidrContains(cidr: string, ip: string): boolean {
  const [network, prefixRaw] = cidr.split("/");
  if (network === undefined || prefixRaw === undefined) return false;
  const prefix = Number(prefixRaw);
  const networkBits = ipv4ToUint32(network);
  const ipBits = ipv4ToUint32(ip);
  if (networkBits === null || ipBits === null || !Number.isInteger(prefix)) return false;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (networkBits & mask) === (ipBits & mask);
}

function ipv4ToUint32(ip: string): number | null {
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    const parsed = Number(octet);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) return null;
    value = ((value << 8) >>> 0) + parsed;
  }
  return value >>> 0;
}
