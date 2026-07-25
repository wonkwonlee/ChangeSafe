import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this repository. Without it, a stray lockfile
  // anywhere above the checkout makes Turbopack infer a different root and
  // warn on every `npm run dev`.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
