import type { DomainAdapter } from "@changesafe/core";
import {
  IncidentBundleSchema,
  NetworkChangeProposalSchema,
  NetworkReplayFixtureSchema,
  networkDomain,
} from "@changesafe/domain-network";
import {
  deriveProposal,
  normalizePlan,
  terraformDomain,
} from "@changesafe/domain-terraform";
import {
  KubernetesManifestSetSchema,
  KubernetesReplayFixtureSchema,
  deriveManifestProposal,
  normalizeSnapshot,
  parseManifestDocuments,
  kubernetesDomain,
  type KubernetesSnapshot,
} from "@changesafe/domain-kubernetes";
import { z } from "zod";

import { UsageError, parseOrThrow, readTextFile } from "./io";

/**
 * Domains the CLI can gate. Adding one here is the only wiring a new domain
 * needs — the gate command itself knows nothing domain-specific.
 */
export interface CliDomain {
  readonly id: string;
  readonly adapter: DomainAdapter<never, never>;
  /** Parse and validate the analyzed input (a bundle, a plan, a snapshot). */
  parseInput(raw: unknown, context?: { kind: string; text: string }[]): {
    input: unknown;
    inputId: string;
  };

  /**
   * External-diff domains derive the proposal from the input itself — the
   * plan already says what will change — so `--proposal` is not required.
   */
  readonly derivesProposalFromInput?: boolean;
  deriveProposal?(input: unknown): unknown;
  /** Parse a proposal file, accepting either a bare proposal or a fixture. */
  parseProposal(raw: unknown, input?: unknown): {
    proposal: unknown;
    provenance: string | null;
    fixtureId: string | null;
  };
  readProposalFile?(filePath: string): unknown;
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

const terraform: CliDomain = {
  id: "terraform",
  adapter: terraformDomain as unknown as DomainAdapter<never, never>,
  inputDescription: "terraform show -json output",
  derivesProposalFromInput: true,

  parseInput(raw, context) {
    const input = normalizePlan(raw, { context });
    return { input, inputId: input.planId };
  },

  deriveProposal(input) {
    return deriveProposal(input as Parameters<typeof deriveProposal>[0]);
  },

  parseProposal(raw) {
    // Accepted for completeness, but a plan-derived proposal is the norm.
    throw new UsageError(
      "the terraform domain derives its proposal from the plan; pass only --input",
    );
    void raw;
  },
};

const kubernetes: CliDomain = {
  id: "kubernetes",
  adapter: kubernetesDomain as unknown as DomainAdapter<never, never>,
  inputDescription: "a changesafe-kubernetes-snapshot/v1 JSON file",

  parseInput(raw) {
    const snapshot = normalizeSnapshot(raw);
    return { input: snapshot, inputId: snapshot.snapshotId };
  },

  readProposalFile(filePath) {
    const text = readTextFile(filePath, "Kubernetes proposal");
    // A replay fixture (bundled scenarios, `gate --scenario`) is JSON
    // wrapping an already-derived proposal; real manifests are YAML or JSON
    // documents with no such wrapper. Try the fixture shape first since it is
    // unambiguous, and fall back to manifest parsing otherwise.
    try {
      const parsed: unknown = JSON.parse(text);
      if (hasProposalKey(parsed)) return parsed;
    } catch {
      // Not JSON at all — definitely manifest documents.
    }
    return parseManifestDocuments(text);
  },

  parseProposal(raw, input) {
    if (hasProposalKey(raw)) {
      const fixture = parseOrThrow(KubernetesReplayFixtureSchema, raw, "replay fixture");
      return {
        proposal: fixture.proposal,
        provenance: fixture.provenance,
        fixtureId: fixture.fixtureId,
      };
    }
    const manifestSet = KubernetesManifestSetSchema.parse(raw);
    if (!input) throw new UsageError("Kubernetes proposal parsing requires a snapshot input");
    const derived = deriveManifestProposal(
      input as KubernetesSnapshot,
      manifestSet,
    );
    return { proposal: derived.proposal, provenance: null, fixtureId: null };
  },
};

const DOMAINS: Record<string, CliDomain> = { network, terraform, kubernetes };

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
