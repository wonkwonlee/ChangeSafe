import type { Metadata } from "next";

import { TerraformWorkbenchShell } from "@/components/TerraformWorkbenchShell";

export const metadata: Metadata = {
  title: "ChangeSafe Terraform Workbench — Public Replay",
  description:
    "Inspect schema-validated bundled Terraform external diffs in an ephemeral public replay. Terraform is never run and ChangeSafe never executes infrastructure changes.",
};

export default function TerraformWorkbenchPage() {
  return <TerraformWorkbenchShell />;
}
