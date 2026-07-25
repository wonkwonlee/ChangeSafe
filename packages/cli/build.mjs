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
  banner: { js: "#!/usr/bin/env node" },
  // zod is bundled too: one file, no install-time resolution surprises.
  logLevel: "warning",
});

await chmod(outfile, 0o755);
console.log(`built ${path.relative(process.cwd(), outfile)}`);
