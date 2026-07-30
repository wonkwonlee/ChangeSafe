import { z } from "zod";

import {
  REVIEW_CONTRACT_VERSION,
  DomainIdSchema,
  DomainShapeSchema,
  ReviewCapabilitiesSchema,
} from "./review-contract";

const PresentationStaticCapabilitiesSchema = ReviewCapabilitiesSchema.omit({
  durableDecision: true,
});

export const DomainPresentationDefinitionSchema = z
  .strictObject({
    domainId: DomainIdSchema,
    contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
    domainShape: DomainShapeSchema,
    capabilities: PresentationStaticCapabilitiesSchema,
    label: z.string().min(1).max(160),
    description: z.string().min(1).max(1000),
  })
  .superRefine((definition, context) => {
    if (
      definition.capabilities.sandboxSimulation !==
      (definition.domainShape === "simulated-state")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "presentation shape must exactly match advertised sandbox simulation capability",
        path: ["capabilities", "sandboxSimulation"],
      });
    }
  });

type ParsedDomainPresentationDefinition = z.infer<
  typeof DomainPresentationDefinitionSchema
>;

export type DomainPresentationDefinition = Readonly<
  Omit<ParsedDomainPresentationDefinition, "capabilities"> & {
    capabilities: Readonly<
      ParsedDomainPresentationDefinition["capabilities"]
    >;
  }
>;

export function defineDomainPresentation(
  rawDefinition: unknown,
): DomainPresentationDefinition {
  const definition = DomainPresentationDefinitionSchema.parse(rawDefinition);
  return Object.freeze({
    ...definition,
    capabilities: Object.freeze({ ...definition.capabilities }),
  });
}
