# YC Blocking Demo Redesign

**Date:** 2026-07-28  
**Audience:** Y Combinator application reviewers  
**Deliverable:** A 60–75 second, silent, caption-led MP4

## Goal

Make one claim immediately legible:

> An AI confidently proposes a dangerous infrastructure change. ChangeSafe
> proves it unsafe and makes approval impossible.

The video is not a general product tour. It does not explain every policy,
show a safe-path comparison, or claim customer or production validation.

## Audience Outcome

Within the first 15 seconds, a viewer should understand that the system takes
an AI-proposed change as input. By the end, they should understand that the
gate independently derives blocking findings and that no AI output can approve
or execute a change.

## Format and Boundaries

- Runtime: 60–75 seconds, hard maximum 90 seconds.
- Audio: none; no narration, music, or audio track.
- Video: 1920×1080 H.264 MP4, under 100 MB.
- Text: large, burned-in English captions; one claim per shot.
- Source: local replay-only application with no model key configured.
- Scenario: `INC-4977 — Suspected route leak` only.
- Provenance: retain the visible authored-fixture label. Do not call it live
  model output.
- Safety: never imply execution, automatic approval, or complete protection.

## Narrative and Shot Plan

The camera begins in the scenario; it does not spend time on a title card.
Each transition either follows the user action or reveals the evidence that
changes the verdict.

| Time | Product evidence | Caption |
| --- | --- | --- |
| 0–4s | `INC-4977` route-leak incident is loaded. | `An AI proposes a fix.` |
| 4–10s | Cursor clicks **Run replay analysis**; stage 1 is centered. | `Analyze the incident.` |
| 10–20s | Typed proposal shows `REMOVE` and advisory `91%` confidence. | `Remove the management route.` / `91% confident.` |
| 20–30s | Camera moves from the proposal to the deterministic policy gate. | `ChangeSafe checks the proposed change.` |
| 30–42s | `MGMT_REACHABILITY` BLOCK is centered with its outcome. | `BLOCK: management access is lost.` |
| 42–52s | `PROTECTED_RESOURCE` BLOCK and `CRITICAL` risk are centered. | `BLOCK: a protected route is removed.` / `CRITICAL risk.` |
| 52–62s | Decision stage shows disabled approval and the impossible-approval state. | `The AI cannot approve itself.` |
| 62–70s | Blocked receipt and SHA-256 hash lead to the header tagline. | `The refusal is recorded.` / `AI proposes. Deterministic code validates. A human decides.` |

## Visual Direction

- Keep one caption visible at a time, in a fixed bottom-right overlay that
  never covers a policy result, approval control, or receipt hash.
- Use brief, deliberate cursor movement only for the Analyze click. Subsequent
  attention changes come from camera framing and scroll position, not cursor
  wandering.
- Center the proposal operation, each blocking finding, risk badge, and
  approval state in turn. Do not leave a long static screen with unrelated
  evidence.
- Scroll only to move between the proposal, the policy gate, and the decision
  record. The scroll itself should be quick; evidence holds should be long
  enough to read without pausing.
- Do not include the safe scenario. Contrast is supplied by the AI's apparent
  confidence versus the deterministic refusal, not by a second workflow.

## Recording Contract

1. Start the app in replay-only mode with all model keys unset.
2. Select `scenario-b-route-leak` and record a clean browser context.
3. Click **Run replay analysis** once and wait for the authored replay label,
   proposal, findings, and decision state to render.
4. Issue the blocked receipt only after the two BLOCK findings and impossible
   approval state have been shown.
5. Encode video-only output; remove all audio streams.

## Acceptance Criteria

- A viewer can identify the Analyze action, AI proposal, two BLOCK findings,
  CRITICAL risk, and impossible approval without narration.
- The video visibly shows `REMOVE`, `91%`, `MGMT_REACHABILITY`,
  `PROTECTED_RESOURCE`, `CRITICAL`, and the blocked receipt.
- Each caption matches the corresponding on-screen evidence and makes no
  stronger claim than the product supports.
- The final MP4 has exactly one H.264 video stream and no audio stream.
- The duration is between 60 and 75 seconds, resolution is 1920×1080, and
  size is under 100 MB.
- Representative first, proposal, BLOCK, decision, and final frames are
  visually inspected before handoff.
