import { DomainError, type ChangeProposal, type DomainAdapter } from "@changesafe/core";
import {
  IncidentBundleSchema,
  NetworkChangeProposalSchema,
  networkDomain,
  runSimulation,
  type IncidentBundle,
} from "@changesafe/domain-network";
import {
  deriveProposal,
  normalizePlan,
  terraformDomain,
} from "@changesafe/domain-terraform";
import type { SimulationResult } from "@changesafe/core";

/**
 * Domains the decision server can decide in.
 *
 * Kept separate from the CLI's registry because the two need different
 * things: the CLI parses files and prints help, the server parses request
 * bodies and may simulate. Sharing one registry would mean each carrying the
 * other's concerns.
 */
export interface ServerDomain {
  readonly id: string;
  readonly adapter: DomainAdapter<never, never>;
  parseInput(raw: unknown): { input: unknown; inputId: string };
  /** Parse a supplied proposal, or derive one when the domain does that. */
  resolveProposal(input: unknown, raw: unknown): ChangeProposal;
  /** Only simulated-state domains can simulate; external-diff ones cannot. */
  simulate?(input: unknown, proposal: ChangeProposal): SimulationResult;
}

const network: ServerDomain = {
  id: "network",
  adapter: networkDomain as unknown as DomainAdapter<never, never>,
  parseInput(raw) {
    const bundle = IncidentBundleSchema.parse(raw);
    return { input: bundle, inputId: bundle.incidentId };
  },
  resolveProposal(_input, raw) {
    return NetworkChangeProposalSchema.parse(raw);
  },
  simulate(input, proposal) {
    return runSimulation(input as IncidentBundle, proposal as never);
  },
};

const terraform: ServerDomain = {
  id: "terraform",
  adapter: terraformDomain as unknown as DomainAdapter<never, never>,
  parseInput(raw) {
    const input = normalizePlan(raw);
    return { input, inputId: input.planId };
  },
  resolveProposal(input) {
    // The plan already states what will change, so a client-supplied proposal
    // would be an unverifiable restatement of it.
    return deriveProposal(input as Parameters<typeof deriveProposal>[0]) as ChangeProposal;
  },
};

const DOMAINS: Record<string, ServerDomain> = { network, terraform };

export const SERVER_DOMAIN_IDS = Object.keys(DOMAINS);

export function resolveServerDomain(id: string): ServerDomain {
  const domain = DOMAINS[id];
  if (!domain) {
    throw new DomainError(
      "REQUEST_INVALID",
      `Unknown domain "${id}". Available: ${SERVER_DOMAIN_IDS.join(", ")}.`,
    );
  }
  return domain;
}
