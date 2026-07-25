import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      // Workspace packages are consumed as TypeScript source; the bundler
      // (vitest here, Turbopack in the app) transpiles them.
      "@changesafe/core": path.resolve(root, "packages/core/src/index.ts"),
      "@changesafe/domain-network": path.resolve(
        root,
        "packages/domain-network/src/index.ts",
      ),
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
