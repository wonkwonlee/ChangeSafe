import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { IncidentBundleSchema, type IncidentBundle } from "@changesafe/domain-network";
import type { ChangeProposal } from "@changesafe/core";

/**
 * These tests run against the repository's real bundled scenario rather than
 * a hand-built stub. A provider adapter's job is to carry a genuine proposal
 * intact, and a simplified fixture would not exercise the nesting, unions,
 * and identifier constraints that actually stress schema translation.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const scenarioDir = path.resolve(here, "../../../scenarios/scenario-a-failover");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(scenarioDir, file), "utf8")) as unknown;
}

export function loadBundle(): IncidentBundle {
  return IncidentBundleSchema.parse(readJson("incident.json"));
}

export function loadProposal(): ChangeProposal {
  const fixture = readJson("replay-fixture.json") as { proposal: ChangeProposal };
  return fixture.proposal;
}

/** A fetch that records what it was asked and replies with a canned body. */
export function recordingFetch(reply: (url: string) => Response): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; headers: Record<string, string>; body: unknown }[];
} {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return reply(url);
  }) as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}
