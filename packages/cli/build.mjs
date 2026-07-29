import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * The CLI must run under plain Node with no bundler and no workspace
 * resolution, so it ships pre-bundled: core and the domain packages are
 * inlined from TypeScript source into one executable file.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, "dist", "changesafe.js");

await mkdir(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(here, "src", "main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // These acquisition-only modules stay runtime dependencies. Bundling the
  // Kubernetes client's node-fetch transport into an ESM binary triggers its
  // legacy dynamic-require shim and would make even offline gate commands
  // fail during module initialization.
  external: ["@kubernetes/client-node", "node-fetch", "isomorphic-ws"],
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as makeRuntimeRequire } from "node:module"; const require = makeRuntimeRequire(import.meta.url);',
  },
  // zod is bundled too: one file, no install-time resolution surprises.
  logLevel: "warning",
});

await chmod(outfile, 0o755);
console.log(`built ${path.relative(process.cwd(), outfile)}`);
