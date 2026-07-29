import type { Metadata } from "next";

import { ReviewWorkbenchShell } from "@/components/ReviewWorkbenchShell";

export const metadata: Metadata = {
  title: "ChangeSafe Workbench — Public Replay",
  description:
    "Explore a schema-validated bundled replay in a static, ephemeral workbench. No decisions are recorded, and ChangeSafe never executes infrastructure changes.",
};

export default function WorkbenchPage() {
  return <ReviewWorkbenchShell />;
}
