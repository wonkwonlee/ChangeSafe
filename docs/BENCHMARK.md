# Benchmarking model proposals

ChangeSafe can measure how good a model is at *proposing* infrastructure
changes. It cannot measure how safe a model is, and this document is as much
about that distinction as about the numbers.

```bash
changesafe eval --provider anthropic --runs 3 --report reports/claude-opus-4-8.json
```

## What is actually being measured

Each scenario in the corpus is handed to the model as an incident bundle. The
returned proposal goes through the identical pipeline the console and CLI use
— provider structured output, strict Zod parse, evidence and resource
cross-checks — and then through the deterministic gate.

Every attempt lands in exactly one bucket:

| Outcome | Meaning |
| --- | --- |
| `accepted` | Well-formed and grounded; the gate then judged it |
| `ungrounded` | Well-formed, but cites evidence or resources that do not exist |
| `schema_invalid` | The model could not produce the required shape |
| `no_output` | The provider returned nothing usable (truncation, refusal) |
| `call_failed` | Transport or HTTP failure |

`call_failed` is excluded from every rate. A network problem says nothing
about a model, and letting it depress a score would make the report a
measurement of your connection.

## The three headline numbers

- **schema-valid %** — of answered attempts, how many parsed against the
  proposal schema. Low numbers here mean the model cannot hold a shape.
- **evidence-grounded %** — of answered attempts, how many *also* referred
  only to things the incident actually contains. The gap between this and
  schema-valid is the interesting part: a confident, perfectly-formed
  proposal about a device that does not exist is the failure a schema cannot
  catch.
- **red-team blocked %** — of accepted proposals on scenarios that expect a
  BLOCK, how many the gate blocked.

## How to read the red-team number

This is the number most likely to be misquoted, so read it carefully.

A **high** red-team block rate means the model was steered by the adversarial
scenario — it proposed the unsafe change — and the gate caught it. A **low**
rate means the model resisted and proposed something safe instead.

Neither number is a safety score, because **neither changes what the gate
blocks**. Safety here is a property of the deterministic policies, not of the
model. A weaker model produces more rejections and more blocks; it never
produces a weaker verdict. That is the whole architectural claim, and the
benchmark exists to demonstrate it rather than to rank models by trust.

## Reproducing a report

Reports record the corpus they ran against, not just the score, because a
number is only comparable to another number from the same scenarios:

```json
{
  "reportVersion": 1,
  "target": { "provider": "Anthropic", "model": "claude-opus-4-8" },
  "corpus": { "scenarios": 9, "adversarial": 6, "runsPerScenario": 3 },
  "summary": { "schemaValidPct": 100, "evidenceGroundedPct": 96.3, "redTeamBlockedPct": 83.3 }
}
```

`reportVersion` bumps whenever a field's meaning changes, so an old report
stays interpretable instead of being silently re-read under new definitions.

To compare two models fairly: same corpus directory, same `--runs`, same
report version. Sampling is deterministic where the provider allows it
(temperature 0 on Ollama), but hosted providers do not guarantee
determinism — use several runs and report the spread rather than a single
number.

## Honest limits

- **The corpus is small and synthetic.** Nine scenarios in one domain. It is
  a coverage instrument, not a statistical sample, and any percentage from it
  carries wide error bars.
- **It measures one prompt.** A different prompt changes the numbers. The
  prompt used is in `packages/ai/src/prompts/network.ts` and is part of the
  methodology, not a neutral constant.
- **Adversarial scenarios are hand-authored.** They demonstrate failure modes
  we thought of. A model can score perfectly and still fail on a mode the
  corpus does not contain — which is why the failure-mode taxonomy in
  [SCENARIOS.md](SCENARIOS.md) lists gaps explicitly.
- **Running this costs money.** `eval` requires an explicit `--provider` for
  that reason, and nothing in CI runs it.

## Contributing a scenario

The corpus is the moat, and it is the easiest way to contribute. A scenario
that exercises a failure mode with no coverage is worth more than another
example of one already covered — see [SCENARIO_AUTHORING.md](SCENARIO_AUTHORING.md)
and the coverage table in [SCENARIOS.md](SCENARIOS.md).
