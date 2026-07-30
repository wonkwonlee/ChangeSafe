import { DomainError } from "@changesafe/core";
import { parseAllDocuments } from "yaml";

import { KubernetesManifestSetSchema, type KubernetesManifestSet } from "./schemas";

export { deriveManifestProposal } from "./manifest-proposal";

/**
 * Parse YAML or JSON manifest text at the package's explicit parser boundary.
 * Consumers with already-decoded typed documents should import the pure
 * manifest-proposal entry point instead.
 */
export function parseManifestDocuments(text: string): KubernetesManifestSet {
  let documents;
  try {
    documents = parseAllDocuments(text);
  } catch (error) {
    throw new DomainError("SCHEMA_VALIDATION", "The Kubernetes manifest text is invalid YAML.", {
      cause: error,
    });
  }

  const parseError = documents.find((document) => document.errors.length > 0);
  if (parseError) {
    throw new DomainError("SCHEMA_VALIDATION", "The Kubernetes manifest text is invalid YAML.", {
      cause: parseError.errors[0],
    });
  }

  return KubernetesManifestSetSchema.parse({
    documents: documents
      .map((document) => document.toJSON())
      .filter((document) => document !== null),
  });
}
