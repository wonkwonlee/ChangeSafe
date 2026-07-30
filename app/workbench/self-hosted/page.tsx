import type { Metadata } from "next";

import { SelfHostedReviewWorkbench } from "@/components/SelfHostedReviewWorkbench";

export const metadata: Metadata = {
  title: "ChangeSafe Workbench — Authenticated Self-Hosted",
  description:
    "Manage owner-scoped durable reviews and independently verified receipt claims. ChangeSafe never executes infrastructure changes.",
};

export default function SelfHostedWorkbenchPage() {
  return (
    <SelfHostedReviewWorkbench
      publicGatewayUrl={
        process.env.CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL?.trim() || null
      }
    />
  );
}
