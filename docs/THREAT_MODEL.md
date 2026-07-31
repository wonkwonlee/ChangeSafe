# ChangeSafe Threat Model

## Scope

ChangeSafe receives untrusted infrastructure artifacts and AI-proposed
changes, evaluates them deterministically, and records decisions only in the
authenticated self-hosted boundary. It never executes infrastructure changes.

The public and self-hosted runtimes have different authority:

- The public workbench is keyless, replay-only, and ephemeral. It renders
  findings and risk but creates no decision, simulation result, durable
  review, or receipt.
- The self-hosted server verifies OIDC identity, recomputes findings, accepts
  explicit human approve/reject intent, signs receipts when configured, and
  appends decisions to a hash-chained ledger.
- The CLI gates offline artifacts and may write `gate_only` or `blocked`
  receipts. It never approves.

## Assets

- Deterministic gate integrity: BLOCK must never become approval or
  simulation.
- Provider credentials used by CLI/server-side model analysis.
- Self-hosted OIDC tokens, signing keys, durable review ownership, and ledger
  integrity.
- Honest source/provenance labels.
- Receipt integrity and independently stated authorship/ledger claims.
- Infrastructure artifacts that may contain sensitive configuration.

## Untrusted inputs

- All alerts, operator notes, names, descriptions, PR text, Terraform plan
  contents, offline snapshots, and manifests.
- All live or replayed model output.
- Every public or self-hosted API body.
- Browser state and presentation metadata.
- Collector configuration and Kubernetes API responses.

## Threats and mitigations

| Threat | Mitigation | Evidence |
| --- | --- | --- |
| Prompt injection steers the proposer | Prompts delimit untrusted data, but safety never depends on resistance; pure policies evaluate the resulting typed proposal | provider tests; red-team corpus |
| Invented evidence/resources | Strict schemas plus known-evidence and known-resource checks reject before evaluation | AI validation and review API tests |
| Malformed or oversized public replay body | 4 KiB bounded reader, strict versioned envelope, typed safe errors | `app/api/reviews/analyze/route.ts`; integration tests |
| Unsafe change approved through browser manipulation | Public replay exposes no decision method; core transition authority rejects BLOCK approval/simulation | controller/state-machine tests; E2E |
| Safe public replay presented as approval | UI and contracts state ephemeral evaluation only; no decision, simulation, or receipt is created | workbench route/shell/E2E tests |
| Cross-domain contract confusion | Exact domain id and contract version; lazy registry resolution fails closed; foreign proposal/input shapes are rejected | registry and API contract tests |
| Terraform presented as simulated | Terraform is a supplied external diff and exposes no sandbox action | Terraform contract/E2E tests |
| Kubernetes contacts or mutates a cluster from the gate | Workbench and domain consume offline data; the optional collector is isolated and read-only; no apply endpoint exists | Kubernetes boundary tests |
| Provider secret reaches browser | Browser dependency walk rejects `@changesafe/ai`; production verifier scans every canonical emitted JS chunk for canaries, prompt delimiters, and provider endpoints | telemetry/privacy tests; `verify:client-bundles`; CI |
| Browser exfiltrates review data as telemetry | No client analytics package, instrumentation client, or telemetry script is mounted | `tests/unit/telemetry-privacy.test.ts` |
| Self-hosted client forges findings/risk/receipt | Request schemas omit those fields; the server recomputes from validated input/proposal | server decision/review tests |
| Unauthenticated or wrong-scope decision | OIDC JWKS verification, asymmetric algorithms only, exact issuer/audience/time checks, and operator approver policy | OIDC/authorization tests |
| One owner reads or decides another owner's review | Durable records are scoped by verified issuer and subject at storage/API boundaries | durable store and review endpoint tests |
| Authenticated operator approves BLOCK | Authentication grants no new gate power; core transition fails and no successful decision reaches the ledger | server decision tests |
| Decision returned but not recorded | Ledger append completes before response; signing/append failure returns no successful decision | decision issuance tests |
| Ledger row altered, removed, or reordered | SQLite append-only triggers plus a hash chain; verification fails closed | ledger tamper tests |
| Hash claimed as authorship | UI/API distinguish content integrity, signature presence, out-of-band key verification, and ledger inclusion | receipt-proof contract/tests |
| Self-hosted gateway leaks bearer token to browser | Browser transport uses `credentials: include` to an HTTPS BFF URL with no embedded credentials; operator BFF owns the OIDC exchange | self-hosted transport validation/tests |
| Infrastructure execution | No SSH/NETCONF/RESTCONF/gNMI-SET/vendor mutation/`terraform apply` endpoint; simulations mutate deep clones only | repository invariants and source guards |

## Self-hosted deployment boundary

`@changesafe/server` expects bearer tokens. The vNext browser route does not
store or attach those tokens. Operators must provide an HTTPS gateway/BFF
that authenticates the browser through an HttpOnly session and supplies the
OIDC bearer token upstream. `CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL` is
browser-visible and must contain no credential, query, or fragment. Cleartext
HTTP is accepted only for explicit loopback development.

The repository does not currently provide a turnkey BFF. `changesafe serve`
instantiates `DurableReviewStore` when `--reviews-db` is passed; without that
flag the durable queue endpoints remain disabled. Operators still own TLS,
cookie security, CSRF/origin policy, and BFF-to-server token handling.

## Known limitations

- The Network reachability model is intentionally synthetic and is sound only
  with respect to its declarative input, not arbitrary production routing.
- `UNTRUSTED_INSTRUCTION` is a lexical signal, not a complete injection
  detector. Safety depends on evaluating effects, not detecting every phrase.
- Receipt hashes prove integrity only. Signatures require an expected public
  key obtained out of band; the system is not an external timestamping or
  non-repudiation service.
- A snapshot or plan can be stale even when its hash is valid. Receipt
  integrity does not establish freshness or completeness.
- The public workbench is intentionally not a decision system. Anyone needing
  accountable decisions must deploy the authenticated boundary.

## Kubernetes-specific threats

- **Compromised kubeconfig or over-broad RBAC:** collection requires explicit
  namespaces, rejects `exec` and `auth-provider` credential plugins, and the
  documented Role grants only `get/list` on supported kinds.
- **Malicious metadata or stale snapshots:** strict schemas reject unsupported
  data; normalized snapshot/proposal hashes bind evaluated content but do not
  prove freshness.
- **Response exhaustion or partial writes:** collection enforces a resource
  cap, reads sequentially, and writes atomically through a sibling temporary
  file with fsync and rename.
- **Context confusion:** snapshots retain a SHA-256 context fingerprint and
  reviewed namespaces, not raw server details or credentials.
