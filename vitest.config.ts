import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "node",
    // Playwright owns tests/e2e; vitest must never pick those up.
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
});
