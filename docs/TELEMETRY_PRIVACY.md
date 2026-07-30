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

The existing client-bundle secret canary remains a separate CI gate. It proves
provider credential values and server-only AI adapter markers never enter
browser chunks; the telemetry test proves no client collector exists to send
application data elsewhere.
