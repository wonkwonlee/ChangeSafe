import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      // Workspace packages are consumed as TypeScript source; the bundler
      // (vitest here, Turbopack in the app) transpiles them.
      "@changesafe/ai": path.resolve(root, "packages/ai/src/index.ts"),
      "@changesafe/core": path.resolve(root, "packages/core/src/index.ts"),
      "@changesafe/ledger": path.resolve(root, "packages/ledger/src/index.ts"),
      "@changesafe/server": path.resolve(root, "packages/server/src/index.ts"),
      "@changesafe/domain-network": path.resolve(
        root,
        "packages/domain-network/src/index.ts",
      ),
      "@changesafe/domain-terraform": path.resolve(
        root,
        "packages/domain-terraform/src/index.ts",
      ),
      "@changesafe/domain-kubernetes/manifest-proposal": path.resolve(
        root,
        "packages/domain-kubernetes/src/manifest-proposal.ts",
      ),
      "@changesafe/domain-kubernetes/offline": path.resolve(
        root,
        "packages/domain-kubernetes/src/offline.ts",
      ),
      "@changesafe/domain-kubernetes": path.resolve(
        root,
        "packages/domain-kubernetes/src/index.ts",
      ),
      "@changesafe/kubernetes-collector": path.resolve(
        root,
        "packages/kubernetes-collector/src/index.ts",
      ),
      "changesafe/version": path.resolve(root, "packages/cli/src/version.ts"),
      changesafe: path.resolve(root, "packages/cli/src/main.ts"),
      "@": root,
    },
  },
  test: {
    environment: "node",
    // Playwright owns tests/e2e; vitest must never pick those up.
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
    ],
  },
});
