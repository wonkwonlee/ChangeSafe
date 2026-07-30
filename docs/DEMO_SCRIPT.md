# ChangeSafe vNext Demo Script

Target runtime: **2 minutes 30 seconds**. Record from a local checkout of the
vNext branch at desktop width. The hosted Vercel deployment may still show the
previous release and must not be used as cutover evidence until deployment is
verified.

Preparation:

```bash
npm install
npm run dev
```

Open <http://localhost:3000/>. No provider key is needed.

## Shot list

### 1. Establish the authority boundary (0:00–0:25)

Show the three-column Network workbench: **Review context**, **Review canvas**,
and **Review authority**.

> "ChangeSafe treats an AI proposal as untrusted data. This public workbench
> is deliberately ephemeral: it can validate bundled evidence and run the
> deterministic gate, but it cannot approve, simulate, issue a receipt, or
> execute anything."

Point to the Authority panel. Before replay it already states that decision,
simulation, and receipt authority are unavailable.

### 2. Run the red-team replay (0:25–1:10)

Select `INC-4977 — Suspected route leak`. Point to **Fixture provenance** and
the injected operator note, then choose **Run replay**.

> "This is an authored red-team fixture, not a live model call. It contains a
> plausible proposal that echoes an injected instruction and reports high
> confidence. Confidence is visible evidence, never a policy input."

Wait for the outcome to focus on **BLOCKED**. Show **Policy results**, the
CRITICAL risk, and the affected evidence.

> "Pure policies recompute the effect. The change would sever management
> reachability and touch a protected resource. Any BLOCK makes approval
> impossible in the core state machine, not just in the interface."

### 3. Show the honest public limit (1:10–1:30)

Return to the Authority panel and read the three claims:

- decision: BLOCKED or human decision required, but no public decision method;
- simulation: not run because public replay cannot approve;
- receipt: not created because the replay is ephemeral.

> "A blocked finding is not converted into a downloadable receipt here. This
> page proves what the gate evaluated, not that an accountable human decided
> or that a durable record exists."

### 4. Compare domain shapes (1:30–2:05)

Open `/workbench/terraform`.

> "Terraform is a supplied external diff. ChangeSafe reads
> `terraform show -json`; it never runs Terraform and does not claim a
> ChangeSafe-side simulation."

Then open `/workbench/kubernetes`.

> "Kubernetes consumes an offline snapshot and proposed manifests. The gate
> contacts no cluster and applies no manifest. The optional collector is a
> separate, namespace-scoped read-only tool."

Point to each route's policy coverage/source disclosure.

### 5. Close on deployment modes (2:05–2:30)

Open `/workbench/self-hosted`.

> "Accountable decisions belong to the separate self-hosted boundary. The
> server verifies OIDC identity, recomputes findings, signs when configured,
> and appends to a hash-chained ledger before responding. The browser client
> needs an operator-run HTTPS gateway with an HttpOnly session; this repository
> does not pretend that deployment is turnkey. Nothing in either mode executes
> infrastructure."

End on:

> "AI proposes. Deterministic code validates. A human decides. ChangeSafe
> never executes."

## Recording checks

- Use exact `/`; exact `/workbench` is retired.
- Say **Run replay**, not “Run replay analysis.”
- Never show or describe a public Approve, Simulate, Issue receipt, or Download
  receipt control.
- Do not claim that the hosted URL is on vNext until deployment checks prove
  `/` and the three subroutes are current and exact `/workbench` plus
  `POST /api/analyze` return 404.
- Keep authored/captured provenance visible and distinct.
