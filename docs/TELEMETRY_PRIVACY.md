# Telemetry Privacy Boundary

ChangeSafe does not install or mount client analytics or real-user telemetry
collectors. The application therefore sends no infrastructure artifacts,
proposal or finding contents, receipts, review identifiers, approver
identities, model or provider metadata, or secrets to a telemetry service.

## Why Speed Insights is not mounted

Vercel Speed Insights is designed to collect anonymous Web Vitals, but its
documented data points still include the requested URL, normalized route, and
HTML element attribution. Those fields are useful for ordinary product
performance monitoring, but ChangeSafe's future self-hosted routes may contain
opaque review references and its rendered elements represent untrusted
infrastructure evidence.

The SDK supports a `beforeSend` filter, including returning `null` to cancel an
event. That is not the selected boundary here:

- filtering still requires loading a client collector on pages that render
  sensitive review data;
- a later route or component could accidentally weaken an allowlist;
- ChangeSafe does not need client telemetry to perform deterministic review;
- removal is easier to audit than proving every future event field is safely
  redacted.

Official references:

- [Speed Insights privacy and collected fields](https://vercel.com/docs/speed-insights/privacy-policy)
- [Speed Insights package configuration and `beforeSend`](https://vercel.com/docs/speed-insights/package)

## Enforcement

`tests/unit/telemetry-privacy.test.ts` verifies the dependency manifest and
walks browser-facing application source using the repository's TypeScript
static-import parser. It also checks project-root and `src/`
`instrumentation-client.*` entry points plus browser-delivered scripts under
`public/`. The guard rejects Vercel analytics imports, Speed Insights
injection, global collector calls, and hard-coded Vercel telemetry endpoints.

Performance work remains evidence-based through local and CI-controlled tests:
production builds, bundle budgets, Playwright interaction and reflow checks,
and large-fixture benchmarks. These checks do not transmit runtime artifacts
or user activity to an external collector.

## Public client bundle gate

`npm run build && npm run verify:client-bundles` reads the emitted static HTML
for `/workbench`, `/workbench/terraform`, and `/workbench/kubernetes`. It
discovers the initial `/_next/static/*.js` scripts from that HTML, resolves and
deduplicates the actual emitted files, and measures raw uncompressed bytes.
The verifier never depends on hashed filenames, build timing, or a private
Next.js manifest shape.

Each public route has a 1,310,720-byte (1.25 MiB) raw initial-JavaScript
ceiling. The G009 production baseline was 1,078,075 bytes for Network,
1,001,606 bytes for Terraform, and 1,005,300 bytes for Kubernetes. The ceiling
therefore leaves about 21.6% growth above the largest measured route while
still rejecting a material unreviewed increase. Raw bytes are intentionally
more conservative and stable than network-compressed transfer measurements.

The same command scans every emitted client JavaScript chunk for the hosted
provider canary values, server-only prompt and AI adapter markers, and provider
endpoints. It also rejects foreign domain policy markers in each public
route's initial chunks. This emitted-output check complements the static
route dependency graph, which rejects foreign domain package roots and
subpaths before build.

The telemetry test separately proves no client collector exists to send
application data elsewhere.
