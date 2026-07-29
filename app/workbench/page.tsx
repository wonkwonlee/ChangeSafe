import type { Metadata } from "next";

import { ReviewWorkbenchShell } from "@/components/ReviewWorkbenchShell";

export const metadata: Metadata = {
  title: "ChangeSafe Workbench — Public Replay",
  description:
    "Run schema-validated bundled Network replays in an ephemeral workbench. No decisions are recorded, and ChangeSafe never executes infrastructure changes.",
};

export default function WorkbenchPage() {
  return <ReviewWorkbenchShell />;
}
