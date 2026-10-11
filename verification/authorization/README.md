# Authorization protocol model

This is the bounded M3 model of the M2 issuance/recovery/admission protocol.
It checks safety, not liveness, cryptography, TypeScript refinement, SQLite
internals or Kubernetes persistence/reconciliation. See
[the interpretation and implementation mapping](../../docs/M3_GUARANTEES.md).

## Reproduce

Requires Java 17+ and the repository's Node 22/npm 10.9.8 runtime. Download
the checker explicitly; the default `npm test` remains offline.

```bash
curl -fsSL https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar -o /tmp/changesafe-tla2tools.jar
TLA2TOOLS_JAR=/tmp/changesafe-tla2tools.jar npm run verify:authorization
```

The runner checks the jar's SHA-256 before invoking TLC:
`7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d`.
It fixes one worker and seed 1, gives each run its own temporary state
directory, and enforces a two-minute per-case timeout. It accepts exit 0
only for the two normal cases. Each negative case must exit 12, name its
expected violated invariant, and include a counterexample trace. A parse
error, semantic error, timeout or unrelated failure fails the runner.

Fresh logs and a model-hash-bound `results.json` go to
`artifacts/authorization/` (ignored). `CHANGESAFE_MODEL_RESULTS` overrides
that destination. CI uploads these logs. The `results/` directory is a
checked-in run snapshot; rerun after changing the model before updating it.
CI passes `--check-snapshot` to reject drift in the model/checker/config hashes,
expected verdicts or deterministic state counts.

| Configuration | Required result |
| --- | --- |
| `protected.cfg` | All listed bounded safety invariants hold |
| `default.cfg` | Same grant-path invariants; no global authorization claim |
| `broken-restart.cfg` | `AtMostOnce` counterexample |
| `broken-retry.cfg` | `OneIdentityPerReview` counterexample |
| `broken-object.cfg` | `ExactAuthorization` counterexample |
| `broken-storage.cfg` | `ConsumptionBeforeAllow` counterexample |
| `broken-dry-run.cfg` | `NoDryRunConsumption` counterexample |
| `default-overclaim.cfg` | `NoAdmissionWithoutGrant` counterexample in the real default-tier design |

`Authorization.tla` models one immutable UPDATE review, two authorized-actor
choices, two possible grant ids, nine exact/substituted request shapes,
two policy versions and three time values. The expected safe protocol uses
only one grant id. Environment actions interleave issuer/verifier outages,
storage outages, time advance, policy change, dry-run and actual admission.
Denials and identical/conflicting rejected retries are stuttering steps.
No fairness assumptions or eventual-delivery claim are made.
