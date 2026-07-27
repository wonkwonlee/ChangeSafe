#!/usr/bin/env node
/**
 * Give the emitted package Node-resolvable import specifiers.
 *
 * The source deliberately writes `from "./errors"`. Every tool the repository
 * develops with resolves that — vitest, tsc, esbuild, Turbopack — and the app
 * imports the workspace packages as TypeScript source, so changing the source
 * to `./errors.js` breaks the app's bundler for no benefit to anyone reading
 * the code.
 *
 * A published package cannot be so relaxed. `tsc` rewrites no specifiers, so
 * emitted ESM keeps `from "./errors"`, which Node refuses outright and which
 * TypeScript rejects for consumers using NodeNext resolution — the default for
 * a plain Node project. So the extensions are added here, to the build output
 * only, where the tradeoff belongs.
 *
 * Anything that cannot be resolved to a file in the output is a hard failure:
 * silently leaving a broken specifier would ship a package that only fails
 * once someone installs it.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const [, , target] = process.argv;
if (!target) {
  console.error("usage: finish-package-build.mjs <dist-directory>");
  process.exit(2);
}

const root = path.resolve(target);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (entry.endsWith(".js") || entry.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

/** `from "..."`, `import("...")`, and `export ... from "..."` alike. */
const SPECIFIER = /((?:from|import)\s*\(?\s*")(\.[^"]*)(")/g;

let rewritten = 0;
for (const file of walk(root)) {
  const original = readFileSync(file, "utf8");
  const updated = original.replace(SPECIFIER, (match, before, specifier, after) => {
    if (specifier.endsWith(".js") || specifier.endsWith(".json")) return match;

    const resolvedBase = path.resolve(path.dirname(file), specifier);
    let suffix;
    if (existsFile(`${resolvedBase}.js`)) {
      suffix = ".js";
    } else if (existsFile(path.join(resolvedBase, "index.js"))) {
      suffix = "/index.js";
    } else {
      console.error(
        `finish-package-build: "${specifier}" in ${path.relative(root, file)} resolves to nothing in the build output`,
      );
      process.exit(1);
    }
    return `${before}${specifier.replace(/\/$/, "")}${suffix}${after}`;
  });

  if (updated !== original) {
    writeFileSync(file, updated);
    rewritten += 1;
  }
}

function existsFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

console.log(`finished ${path.relative(process.cwd(), root)} (${rewritten} file(s) rewritten)`);
