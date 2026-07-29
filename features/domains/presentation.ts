import { z } from "zod";

import {
  REVIEW_CONTRACT_VERSION,
  DomainIdSchema,
  DomainShapeSchema,
  ReviewCapabilitiesSchema,
} from "./review-contract";

export const DomainPresentationDefinitionSchema = z.strictObject({
  domainId: DomainIdSchema,
  contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
  domainShape: DomainShapeSchema,
  capabilities: ReviewCapabilitiesSchema,
  label: z.string().min(1).max(160),
  description: z.string().min(1).max(1000),
});

export type DomainPresentationDefinition = z.infer<
  typeof DomainPresentationDefinitionSchema
>;

export function defineDomainPresentation(
  rawDefinition: unknown,
): DomainPresentationDefinition {
  return Object.freeze(DomainPresentationDefinitionSchema.parse(rawDefinition));
}
