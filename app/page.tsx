import type { Metadata } from "next";

import { ReviewWorkbenchShell } from "@/components/ReviewWorkbenchShell";
import { loadDomainCoverageCatalog } from "@/features/domains/registry";

export const metadata: Metadata = {
  title: "ChangeSafe Workbench — Public Replay",
  description:
    "Run schema-validated bundled Network replays in an ephemeral workbench. No decisions are recorded, and ChangeSafe never executes infrastructure changes.",
};

export default async function Page() {
  const coverageCatalog = await loadDomainCoverageCatalog("network");
  return <ReviewWorkbenchShell coverageCatalog={coverageCatalog} />;
}
