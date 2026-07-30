# @changesafe/server

The authenticated decision path, for self-hosting.

```bash
changesafe keygen --out signing-key
changesafe serve \
  --db decisions.db \
  --oidc-issuer https://your-idp.example.com \
  --oidc-audience changesafe \
  --sign-key signing-key.pem
```

The public workbench is ephemeral and has no decision authority. A team needs
an approver whose identity was established by its own identity provider, a
decision the client cannot fake, and a durable record neither party can
quietly edit.

It still cannot execute a change. There is no endpoint for that and there
will not be one.

## The client stops being trusted

That is the whole reason to move a decision server-side, so the server
**recomputes the findings itself** from the submitted input and proposal. A
client that claims the gate passed something changes nothing, because its
claim is never read — the request schema does not even have a field for it.

Everything else is the same machinery the console and CLI use. In particular
approval goes through the same `transition`, so:

> **An authenticated, authorized, entirely legitimate operator has no more
> power to approve a BLOCK than an anonymous one.** It answers 409 and nothing
> reaches the ledger.

## Approver identity

Tokens are verified against the issuer's published keys — the standard shape
for a service behind a reverse proxy — rather than ChangeSafe implementing a
login flow and owning your session security.

| Check | Why |
| --- | --- |
| Asymmetric algorithms only (RS*/ES*) | `alg: none` forges anything, and accepting HS256 against a *published* public key is the classic algorithm-confusion attack |
| `iss` matches exactly | A near-match is a different issuer |
| `aud` contains the configured audience | A token minted for another service must not be reusable here |
| `exp` / `nbf` with a small skew allowance | Hosts drift; the window is narrow and configurable, not absent |
| `kid` lookup, refetching once on a miss | Providers rotate keys without warning |
| Keys filtered to signing keys for the token's algorithm | A JWKS also carries encryption keys and keys for algorithms this server does not accept |
| Key documents fetched over https, under a deadline and a size cap | These fetches decide whose signatures count; a provider that stops talking must not hang every request behind it |

The verified `subject`, `issuer`, and `email` are recorded on the receipt. A
receipt with `approver: null` means no authenticated approver was
established — the honest answer for a CLI gate run, not a claim that nobody
decided. A `gate_only` receipt may never name an approver at all; the schema
refuses it.

There is **no anonymous mode**. `serve` will not start without an issuer and
audience, because an unauthenticated endpoint that issues approvals would be
strictly worse than the console it replaces — the console at least never
pretends the decision was attributable.

## Who may approve

Authentication answers *which person is this*. It does not answer *should
this person be approving infrastructure changes* — at most organizations
every employee holds a valid token from the same issuer, so without a second
answer your approver list is whatever your user directory happens to be.

```bash
changesafe serve \
  --oidc-issuer https://your-idp.example.com \
  --oidc-audience changesafe \
  --approver-claim groups=sre \
  --approver-claim groups=platform \
  --approver user-alice
```

- `--approver <subject>` — allowed `sub` values. Repeatable.
- `--approver-claim <name>=<value>` — a claim the token must carry, e.g.
  `groups=sre`. Repeatable: values for the *same* claim are alternatives,
  different claims are all required. A claim holding an array matches when
  any element does.

Both are matched exactly — a list of people, not a pattern language. A token
that is genuine but not permitted gets **403**, not 401: the identity is
real, so retrying with a fresh token would not help.

With neither flag, every identity the issuer vouches for may approve, and
startup says so in yellow rather than letting the default pass for a
decision.

This narrows who reaches the gate. It grants nothing: an approver on every
list still cannot approve a BLOCK.

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness and entry count |
| `POST /decisions` | bearer | Decide; recomputes findings, signs, appends |
| `GET /decisions` | bearer | List recorded decisions |
| `GET /ledger/verify` | bearer | Recompute the hash chain (409 if broken) |
| `POST /reviews` | bearer | Queue a validated owner-scoped Network/Terraform intake |
| `GET /reviews` | bearer | List the authenticated owner's pending reviews |
| `GET /reviews/:id` | bearer | Read one owner-scoped pending review, plus findings/risk recomputed at response time |
| `POST /reviews/:id/decisions` | bearer | Recompute and resolve a pending review |
| `GET /reviews/:id/receipt-proof` | bearer | Report integrity, signature, OOB verification, and ledger claims independently |

The `/reviews` family exists only when `createDecisionServer` receives a
`DurableReviewStore`. It is absent otherwise. `changesafe serve` constructs
one when invoked with `--reviews-db <file>`, which is what makes it a turnkey
backend for the vNext review queue; without the flag, the durable store stays
unconstructed and `/reviews` behaves as if it never existed. Durable intake
currently supports Network and Terraform; Kubernetes is rejected rather than
silently downgraded.

The decision is appended to the ledger **before** the response is returned: a
decision the caller was told about but the ledger never saw is exactly the gap
the ledger exists to close. There is no endpoint that writes to the ledger
except by making a decision, so the audit trail cannot be edited through the
same door it is written through.

## What this does not do

- **No execution.** Unchanged from every other part of ChangeSafe.
- **No browser login or BFF.** The vNext browser client expects an
  operator-run HTTPS gateway with an HttpOnly session. That gateway supplies
  the bearer token to this server; `CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL`
  is browser-visible and must contain no credential.
- **No TLS.** Bind to localhost and terminate TLS at your proxy.
- **No session or login flow.** Bring a token.
- **No browser gateway/cookie handling from `changesafe serve` even with the
  durable queue wired.** `--reviews-db` gets the `/reviews` API running;
  integrators still own the gateway/BFF, cookie/origin/CSRF policy, and
  deployment lifecycle that turn a browser session into the bearer token this
  server expects.

## License

MIT — see the repository root.
