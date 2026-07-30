# Telemetry, Privacy, and Public Client Boundary

ChangeSafe mounts no client analytics or real-user telemetry collector. The
browser therefore does not intentionally send infrastructure artifacts,
proposal/finding contents, receipt data, review identifiers, approver
identities, provider metadata, or secrets to a telemetry service.

## Why no client collector is mounted

Even performance products described as anonymous can include requested URLs,
normalized routes, and element attribution. Those fields are useful for
ordinary product analytics but are unnecessary for deterministic review and
could expose opaque self-hosted review references or evidence structure.

Filtering events after loading a collector is a weaker boundary than not
loading one:

- future routes could weaken an allowlist;
- a collector still runs on pages rendering sensitive evidence;
- filtering behavior becomes another security-critical client dependency;
- local/CI performance evidence is sufficient for this project.

`tests/unit/telemetry-privacy.test.ts` checks dependency manifests, browser
source, instrumentation-client entry points, and public scripts. It rejects
known analytics imports, collector globals, and telemetry endpoints.

## Public route budgets

After a production build, `npm run verify:client-bundles` measures raw initial
JavaScript for:

| Public route | G010 cutover baseline | Ceiling |
| --- | ---: | ---: |
| `/` (Network) | 1,075,614 bytes | 1,310,720 bytes |
| `/workbench/terraform` | 999,358 bytes | 1,310,720 bytes |
| `/workbench/kubernetes` | 1,003,425 bytes | 1,310,720 bytes |

Exact `/workbench` is retired and is not a budgeted route.

The verifier reads emitted route HTML, resolves every referenced JavaScript
file to a canonical path inside `.next`, and rejects path/symlink escapes. Raw
bytes are deliberately conservative and less sensitive to compression/tooling
changes than transfer-size estimates.

## Secret and server-code scan

The production verifier scans **every canonical emitted JavaScript chunk**,
not only the initial-route union. The G010 cutover build contained 26 such
chunks. It rejects:

- hosted provider canary values;
- the exact untrusted-data prompt delimiter;
- configured OpenAI, Anthropic, and Ollama endpoint prefixes;
- route-inappropriate foreign-domain policy identifiers.

A source dependency guard complements emitted-output scanning. Browser-
reachable modules may not statically or dynamically import `@changesafe/ai`
or a self-hosted server-only package. Type-only references are allowed only
when they cannot affect the emitted client.

These checks prove that reviewed canaries and known server-only strings are
absent from the build. They do not prove that arbitrary infrastructure
artifacts are non-sensitive; operators must still treat inputs and self-hosted
review data according to their own handling policy.

## Performance evidence without telemetry

Performance and accessibility are measured through deterministic local/CI
checks:

- production build and raw bundle budgets;
- Playwright keyboard, focus, reduced-motion, 200% reflow, and responsive
  behavior;
- graph/table equivalence;
- bounded large-fixture rendering.

None of these checks transmits runtime user activity to an external collector.
