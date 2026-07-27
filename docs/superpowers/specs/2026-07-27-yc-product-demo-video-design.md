# YC Fall 2026 Product Demo Video Design

**Date:** 2026-07-27  
**Audience:** Y Combinator application reviewers  
**Deliverable:** Upload-ready MP4, under 3 minutes and under 100 MB

## Goal

Produce a concise English product demo that proves three things:

1. ChangeSafe treats AI output and incident text as untrusted data.
2. Deterministic code blocks an unsafe proposal independently of model
   confidence.
3. A safe proposal still requires a human decision, runs only in a synthetic
   sandbox, and ends in a tamper-evident receipt.

The video demonstrates a working product. It does not claim customers,
production validation, real infrastructure access, or live-model provenance
for authored replay fixtures.

## Format

- Runtime target: 2:20–2:40; hard maximum 2:59.
- Container: MP4 with H.264 video and AAC audio.
- Resolution: 1920×1080 or 1600×900, selected by the recording surface.
- File size: target below 50 MB; hard maximum 100 MB.
- Narration: synthetic US English voice, calm and technical, approximately
  165–175 words per minute.
- Captions: burned-in English section captions and concise claim text.
- Music: none.
- Source: the local replay-mode application, with no model keys configured.

## Storyboard

The recording follows `docs/DEMO_SCRIPT.md`:

1. **Unsafe context.** Open `INC-4977 — Suspected route leak` and identify the
   injected operator instruction.
2. **Plausible proposal.** Run replay analysis and show the authored red-team
   provenance label, evidence citations, rollback, and advisory 91% confidence.
3. **Deterministic refusal.** Show `MGMT_REACHABILITY` and
   `PROTECTED_RESOURCE` BLOCK findings, CRITICAL risk, and the unavailable
   approval path. Issue the blocked receipt.
4. **Safe human decision.** Switch to `INC-4821 — Degraded primary uplink`,
   run replay analysis, show the all-PASS gate, approve, and simulate on the
   cloned synthetic state.
5. **Evidence and close.** Show the downloadable hashed receipt and end on:
   “AI proposes. Deterministic code validates. A human decides.”

## Recording and Assembly

1. Start the application on a non-conflicting local port in replay-only mode.
2. Use a clean browser profile and an automated, deterministic interaction
   sequence to record the two scenarios.
3. Generate the narration locally from the approved English script.
4. Add short section captions without covering policy verdicts, decision
   controls, or receipt hashes.
5. Encode the final video with fast-start metadata for reliable upload and
   playback.

Temporary rendering tools and intermediate media stay outside the repository.
The final MP4 is written under `artifacts/yc-f26/` and is not committed.

## Safety and Provenance

- No API keys, employer data, personal data, or real infrastructure appear.
- Replay is visibly labeled; the narration never calls it a live model run.
- A BLOCK is presented as a successful safety outcome.
- Determinism is described as repeatable policy evaluation, not a guarantee
  that encoded policies are complete.
- Receipts are described as tamper-evident. Authorship is not claimed unless a
  configured signature is actually shown and verified.
- The video never implies that ChangeSafe executes or prevents bypass by an
  external delivery system.

## Verification

The deliverable is complete only when:

- duration is below 180 seconds;
- file size is below 100 MB;
- video and audio streams are present and synchronized;
- the unsafe and safe workflows both complete visibly;
- replay provenance, BLOCK findings, human decision, sandbox-only simulation,
  and receipt claims are legible;
- no secrets or unrelated desktop content appear;
- the first, middle, and final frames pass visual inspection; and
- the MP4 plays locally from beginning to end.

