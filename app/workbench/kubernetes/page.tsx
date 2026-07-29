import type { Metadata } from "next";

import { KubernetesWorkbenchShell } from "@/components/KubernetesWorkbenchShell";

export const metadata: Metadata = {
  title: "ChangeSafe Kubernetes Workbench — Public Replay",
  description:
    "Inspect schema-validated offline Kubernetes snapshots and proposed manifests through an ephemeral public replay. No cluster is contacted and ChangeSafe never applies infrastructure changes.",
};

export default function KubernetesWorkbenchPage() {
  return <KubernetesWorkbenchShell />;
}
