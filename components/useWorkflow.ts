"use client";

export {
  providerLabel,
  useNetworkWorkflow as useWorkflow,
  type AnalysisMeta,
  type LiveProviderInfo,
} from "@/features/domains/network/useNetworkWorkflow";

import { useNetworkWorkflow } from "@/features/domains/network/useNetworkWorkflow";

export type WorkflowController = ReturnType<typeof useNetworkWorkflow>;
