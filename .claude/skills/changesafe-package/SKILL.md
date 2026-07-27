---
name: changesafe-package
description: Add a new workspace package under packages/ in ChangeSafe, or fix one that resolves in tests but not in the app or the published build. Covers the internal-vs-published split, path aliases, and dependency direction.
---

# Adding a workspace package

Three packages were added this way (`ai`, `ledger`, `server`) and the same
steps were missed each time. The wiring lives in four places; miss one and the
failure appears somewhere unrelated.

## First decide: internal or published?

The repository has two kinds of package, and they are scaffolded differently.

| | Internal | Published |
| --- | --- | --- |
| Examples | `ai`, `ledger`, `server` | `core`, `domain-network`, `domain-terraform`, `changesafe` |
| `private` | `true` | absent |
| Consumed as | TypeScript source, via alias | built `dist/` |
| Needs | `package.json`, source | + `tsconfig.build.json`, `build` script, `publishConfig`, `files`, `exports`, `engines`, `repository.directory` |

Default to **internal**. Publishing is a promise about a public API; make it
only when someone outside the repo needs to install it. Going internal →
published later is a small change. The reverse is a breaking one.

## Wiring (all four, or it breaks somewhere confusing)

1. **`packages/<name>/package.json`** — copy the shape of a sibling of the same
   kind. Workspace deps use the current version range (`^0.2.0`), not `*`.
2. **`tsconfig.json`** → `compilerOptions.paths` — `"@changesafe/<name>":
   ["./packages/<name>/src/index.ts"]`. Without it, typecheck fails.
3. **`vitest.config.ts`** → `resolve.alias` — the same mapping. **Without it
   typecheck passes and tests fail**, which is the confusing one.
4. **`npm install`** — creates the workspace symlink. Skipping it makes the app
   build fail while tests still pass.

Then `npx tsc --noEmit && npx vitest run` before writing any real code, so a
wiring mistake surfaces on an empty package rather than under a feature.

## Dependency direction (violations are review failures)

```
core  ←  domain-*  ←  ai / server / cli
core  ←  ledger    ←  server
```

- `core` depends on **zod alone**. Never on a domain, the app, or the AI layer.
- Policy and patch engines depend on domain types only — **never** on UI or AI
  modules. The gate cannot consult a model by construction.
- `ai`, `ledger`, and `server` sit outside the trust chain. Deleting any of
  them removes a capability and changes no verdict. If a new package would
  need to be imported *by* core or a policy to work, the design is wrong.

State the package's place in this order in its README, the way the existing
ones do. It is the part a reviewer checks first.

## For a published package

- **`tsconfig.build.json`** with `"paths": {}`. This is deliberate and easy to
  get wrong: the build must resolve siblings through `node_modules` to their
  *published declarations*, the way an installer does. Building against a
  sibling's source drags that source into this package's output and never
  exercises the `.d.ts` that actually ships.
- Because of that, **build order matters** — `core` first. See
  `build:packages` in the root `package.json` and extend it.
- The repository `tsconfig.json` is `noEmit` and points at source; that is what
  keeps the test loop build-free. Do not "fix" it to emit.

## Node built-ins

Using a newer built-in (`node:sqlite`, `node:test`) means `@types/node` must be
new enough — Node 20 types do not know `node:sqlite`, and the failure reads as
`Cannot find module 'node:sqlite'` rather than a version problem. Check the
floor in `engines` and the CI matrix before assuming availability, and verify
on the *lowest* supported Node, not the one you happen to run:

```bash
~/.nvm/versions/node/v22.*/bin/node -e "require('node:sqlite')"
```

## Before calling it done

```bash
npx tsc --noEmit
npx vitest run
npm run build:cli     # the CLI bundles workspace source; a bad export breaks here
npm run build         # the app resolves through Turbopack, a third resolver
```

Four resolvers see these packages — tsc, vitest, esbuild (CLI), Turbopack (app).
Passing one proves nothing about the others, which is why all four run.
