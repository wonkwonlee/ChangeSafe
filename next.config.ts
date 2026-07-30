import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep visual baselines deterministic without suppressing build or runtime
  // errors, which Next.js continues to surface when this indicator is disabled.
  devIndicators: false,
  // Pin the workspace root to this repository. Without it, a stray lockfile
  // anywhere above the checkout makes Turbopack infer a different root and
  // warn on every `npm run dev`.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  // Workspace packages ship TypeScript source, so the app transpiles them.
  transpilePackages: ["@changesafe/core", "@changesafe/domain-network"],
};

export default nextConfig;
