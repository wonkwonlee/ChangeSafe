# @changesafe/ai

Provider-agnostic model adapters that produce `ChangeProposal`s.

**Nothing in this package can change a verdict.** A provider's only power is
to suggest a proposal; deterministic policies in `@changesafe/core` then judge
it, and they never receive the model's confidence or even know which provider
answered. Deleting this package would remove live analysis and leave every
gate result identical.

## Providers

| id | Credential | Structured output |
| --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | Responses API, strict `json_schema` |
| `anthropic` | `ANTHROPIC_API_KEY` | Messages API, forced strict tool call |
| `ollama` | none (local) | `format` JSON Schema |

All three are plain `fetch` against an injected transport. No vendor SDKs:
that keeps the bundled CLI free of third-party dependencies, and lets every
test drive a real adapter with a stub `fetch` rather than a mock of one.

```ts
import { analyzeWithPrompt, networkAnalysisPrompt, resolveProvider } from "@changesafe/ai";

const { proposal, model } = await analyzeWithPrompt(networkAnalysisPrompt, bundle, {
  provider: resolveProvider("anthropic"),
});
```

## One schema, three providers

`toPortableJsonSchema` derives the wire schema from the same Zod schema the
gate validates against, reduced to the keyword subset every provider honors
in strict mode. Length, range, and pattern keywords are removed — providers
disagree about them — and restated in `description` so the model still sees
the requirement.

Dropping a constraint from the wire schema does not drop it from the gate.
The returned object is parsed by the **full** Zod schema afterwards, so a
model that violates a stripped constraint is rejected locally. The wire
schema shapes the output; Zod decides whether it is acceptable.

## Validation is identical for every provider

```
provider structured output  →  Zod strict parse  →  domain cross-check
   (varies by provider)         (identical)          (identical)
```

Only the first step differs, and it is treated as a quality measure rather
than a control. There is no provider-specific leniency and no "trusted
provider" fast path: output from a frontier model and output from a local 8B
model face exactly the same checks. A weaker proposer yields more rejections
and more blocks, never a weaker verdict.

`probeProposal` returns that outcome as data instead of throwing —
`accepted`, `no_output`, `schema_invalid`, `ungrounded`, or `call_failed`.
The categories are kept apart because they mean different things about a
model: `call_failed` is an infrastructure problem and no evidence about the
model at all, while `ungrounded` — a well-formed, confident proposal about
things that do not exist — is the failure a schema cannot catch.

## Capture provenance

`captureFixture` is the only way to produce a fixture labeled `captured`, and
it always attaches the answering model and the capture time. The schema
rejects a `captured` claim missing either, and rejects an authored fixture
that names a model at all — so authored content cannot be passed off as model
output, and a real capture cannot lose its attribution.

## Adding a domain

A domain becomes analyzable by supplying an `AnalysisPrompt`: trusted system
instructions, a builder that wraps untrusted input in data delimiters, the
proposal schema, and a `crossCheck` that rejects references to things the
input does not contain. Terraform deliberately has none — a plan already *is*
the proposal, so asking a model to restate it would add an unvalidatable step
to a pipeline whose value is that the change is machine-derived.

## License

MIT — see the repository root.
