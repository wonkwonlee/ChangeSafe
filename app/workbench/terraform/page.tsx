import type { Metadata } from "next";
import { Suspense } from "react";

import { TerraformWorkbenchShell } from "@/components/TerraformWorkbenchShell";
import { loadDomainCoverageCatalog } from "@/features/domains/registry";

export const metadata: Metadata = {
  title: "ChangeSafe Terraform Workbench — Public Replay",
  description:
    "Inspect schema-validated bundled Terraform external diffs in an ephemeral public replay. Terraform is never run and ChangeSafe never executes infrastructure changes.",
};

export default async function TerraformWorkbenchPage() {
  const coverageCatalog = await loadDomainCoverageCatalog("terraform");
  return (
    <Suspense fallback={null}>
      <TerraformWorkbenchShell coverageCatalog={coverageCatalog} />
    </Suspense>
  );
}
