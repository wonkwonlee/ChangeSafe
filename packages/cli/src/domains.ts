import type { DomainAdapter } from "@changesafe/core";
import {
  IncidentBundleSchema,
  NetworkChangeProposalSchema,
  NetworkReplayFixtureSchema,
  networkDomain,
} from "@changesafe/domain-network";
import { z } from "zod";

import { UsageError, parseOrThrow } from "./io";

/**
 * Domains the CLI can gate. Adding one here is the only wiring a new domain
 * needs — the gate command itself knows nothing domain-specific.
 */
export interface CliDomain {
  readonly id: string;
  readonly adapter: DomainAdapter<never, never>;
  /** Parse and validate the analyzed input (a bundle, a plan, a snapshot). */
  parseInput(raw: unknown): { input: unknown; inputId: string };
  /** Parse a proposal file, accepting either a bare proposal or a fixture. */
  parseProposal(raw: unknown): {
    proposal: unknown;
    provenance: string | null;
    fixtureId: string | null;
  };
  /** What `--input` should point at, for help text. */
  readonly inputDescription: string;
}

function hasProposalKey(raw: unknown): raw is { proposal: unknown } {
  return typeof raw === "object" && raw !== null && "proposal" in raw;
}

const network: CliDomain = {
  id: "network",
  adapter: networkDomain as unknown as DomainAdapter<never, never>,
  inputDescription: "an incident bundle (scenarios/*/incident.json)",

  parseInput(raw) {
    const bundle = parseOrThrow(IncidentBundleSchema, raw, "incident bundle");
    return { input: bundle, inputId: bundle.incidentId };
  },

  parseProposal(raw) {
    // A replay fixture wraps a proposal and declares provenance; a bare
    // proposal file declares nothing, and the receipt will say so.
    if (hasProposalKey(raw)) {
      const fixture = parseOrThrow(NetworkReplayFixtureSchema, raw, "replay fixture");
      return {
        proposal: fixture.proposal,
        provenance: fixture.provenance,
        fixtureId: fixture.fixtureId,
      };
    }
    const proposal = parseOrThrow(NetworkChangeProposalSchema, raw, "change proposal");
    return { proposal, provenance: null, fixtureId: null };
  },
};

const DOMAINS: Record<string, CliDomain> = { network };

export const DOMAIN_IDS = Object.keys(DOMAINS);

export function resolveDomain(id: string): CliDomain {
  const domain = DOMAINS[id];
  if (!domain) {
    throw new UsageError(
      `unknown domain "${id}". Available: ${DOMAIN_IDS.join(", ")}`,
    );
  }
  return domain;
}

/** Loose schema used only to detect the shape of a scenario expectations file. */
export const ExpectationsFileSchema = z.looseObject({ scenarioId: z.string() });
