# YC Blocking Demo Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a silent 60–75 second YC demo MP4 that makes the unsafe AI proposal, deterministic BLOCK findings, and impossible approval legible without narration.

**Architecture:** Record one replay-only browser session for `scenario-b-route-leak` with Playwright. A temporary recorder controls the exact scroll and caption sequence; a temporary FFmpeg binary remuxes the video as H.264 with no audio stream. The final asset is a local untracked artifact, while this plan and the approved design remain tracked documentation.

**Tech Stack:** Next.js local development server, Playwright Chromium recording, macOS shell utilities, temporary `ffmpeg-static`, H.264 MP4.

## Global Constraints

- Use `scenario-b-route-leak` only; do not include a safe-path comparison.
- Start the app with no model keys configured; all analysis is replay-only.
- Do not modify application behavior, safety policies, fixtures, or UI text.
- Use the existing product text as evidence: `Run replay analysis`, `REMOVE`, `91%`, `MGMT_REACHABILITY`, `PROTECTED_RESOURCE`, `risk: CRITICAL`, `Approval is not possible`, and the blocked receipt.
- Burn in one English caption at a time; captions never cover a finding, decision control, or receipt hash.
- Produce no audio stream, narration, music, or silent audio track.
- Keep all recorder scripts, browsers, temporary packages, frames, and intermediate media outside the repository.
- Write the final untracked artifact to `artifacts/yc-f26/changesafe-yc-f26-blocking-demo-no-voice.mp4`; never overwrite either prior demo.
- Keep the user-owned `package-lock.json` modification untouched and never stage `artifacts/`.

---

### Task 1: Establish a clean replay-only recording surface

**Files:**
- Read: `docs/superpowers/specs/2026-07-28-yc-blocking-demo-redesign-design.md`
- Read: `tests/e2e/airlock.spec.ts`
- Create: `/tmp/changesafe-yc-blocking-demo/record.mjs`
- Create: `/tmp/changesafe-yc-blocking-demo/raw-video/`

**Interfaces:**
- Consumes: the shipped UI labels verified in `tests/e2e/airlock.spec.ts`.
- Produces: a deterministic recorder that exits non-zero if any required unsafe-path evidence is not visible.

- [ ] **Step 1: Confirm repository and artifact scope before starting the server**

Run:

```bash
git status --short
test -f artifacts/yc-f26/changesafe-yc-f26-product-demo.mp4
test -f artifacts/yc-f26/changesafe-yc-f26-product-demo-no-voice.mp4
mkdir -p artifacts/yc-f26 /tmp/changesafe-yc-blocking-demo/raw-video
```

Expected: the only repository-local unrelated changes are the existing
`package-lock.json` modification and untracked `artifacts/`; neither is staged.

- [ ] **Step 2: Start a local replay-only server on an explicit non-default port**

Run from the repository root:

```bash
unset OPENAI_API_KEY ANTHROPIC_API_KEY OLLAMA_BASE_URL
PORT=3100 npm run dev
```

Expected: `http://localhost:3100` is ready. Use `localhost`, not `127.0.0.1`,
so Next.js client hydration and user interactions work in the recorded page.

- [ ] **Step 3: Write the recorder with exact product locators and timed holds**

Create `/tmp/changesafe-yc-blocking-demo/record.mjs` using Playwright from the
repository's installed dependencies. It must:

```js
await page.goto("http://localhost:3100", { waitUntil: "networkidle" });
await page.getByLabel("Scenario").selectOption("scenario-b-route-leak");
await page.getByRole("button", { name: "Run replay analysis" }).click();
await page.getByText("Authored red-team fixture — not model output").waitFor();
await page.getByText("2 BLOCK", { exact: true }).waitFor();
await page.getByText("risk: CRITICAL", { exact: true }).waitFor();
await page.getByText("Approval is not possible", { exact: true }).waitFor();
```

Install a fixed bottom-right caption overlay with `page.addStyleTag()` and
update its content in this exact order:

1. `An AI proposes a fix.`
2. `Analyze the incident.`
3. `Remove the management route.`
4. `91% confident.`
5. `ChangeSafe checks the proposed change.`
6. `BLOCK: management access is lost.`
7. `BLOCK: a protected route is removed.`
8. `CRITICAL risk.`
9. `The AI cannot approve itself.`
10. `The refusal is recorded.`
11. `AI proposes. Deterministic code validates. A human decides.`

Use `scrollIntoViewIfNeeded()` for, in order: the Analyze control, proposal
operation, confidence text, policy summary, `MGMT_REACHABILITY` finding,
`PROTECTED_RESOURCE` finding, CRITICAL risk badge, impossible-approval alert,
and receipt panel. Hold each evidence frame 4–7 seconds; keep scrolls below
one second. Click **Issue blocked receipt** only after the impossible-approval
hold.

- [ ] **Step 4: Dry-run the recorder without video capture**

Temporarily omit `recordVideo` or run the same locator sequence in a short
Playwright script. Verify these assertions before recording:

```js
await expect(page.getByText("2 BLOCK", { exact: true })).toBeVisible();
await expect(page.getByText("Change severs management reachability")).toBeVisible();
await expect(page.getByText("Change removes or disables a protected resource")).toBeVisible();
await expect(page.getByRole("button", { name: "Approve change" })).toBeDisabled();
await expect(page.getByText("blocked", { exact: true })).toBeVisible();
```

Expected: all assertions pass in replay-only mode and no model request or API
key is required.

### Task 2: Capture the focused unsafe-path recording

**Files:**
- Modify: `/tmp/changesafe-yc-blocking-demo/record.mjs`
- Create: `/tmp/changesafe-yc-blocking-demo/raw-video/`

**Interfaces:**
- Consumes: the recorder and local replay-only server from Task 1.
- Produces: a single 60–75 second 1920×1080 browser recording with captions,
  no desktop content, and the blocked receipt visible at the end.

- [ ] **Step 1: Enable Playwright recording at final resolution**

Use this context configuration in the recorder:

```js
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: {
    dir: "/tmp/changesafe-yc-blocking-demo/raw-video",
    size: { width: 1920, height: 1080 },
  },
});
```

Expected: the browser recording contains only the page, not the desktop,
terminal, local path, or browser chrome.

- [ ] **Step 2: Record one intentional workflow pass**

Run:

```bash
node /tmp/changesafe-yc-blocking-demo/record.mjs
RAW_VIDEO=$(find /tmp/changesafe-yc-blocking-demo/raw-video -maxdepth 1 -type f -name '*.webm' -print -quit)
test -n "$RAW_VIDEO"
test -f "$RAW_VIDEO"
```

Expected shot timing:

```text
00–04 incident loaded
04–10 Analyze click
10–20 REMOVE and 91% confidence
20–30 move to policy gate
30–42 management-reachability BLOCK
42–52 protected-resource BLOCK and CRITICAL risk
52–62 approval impossible
62–70 blocked receipt and final tagline
```

If the recording is outside 60–75 seconds, adjust only the hold durations;
keep the caption order and evidence order unchanged.

- [ ] **Step 3: Verify raw recording content before encoding**

Extract frames near 8, 16, 36, 48, 58, and 68 seconds. Inspect that:

```text
8s   Analyze action is legible
16s  REMOVE and 91% confidence are legible
36s  MGMT_REACHABILITY BLOCK is legible
48s  PROTECTED_RESOURCE BLOCK and CRITICAL risk are legible
58s  Approval is not possible and disabled approval are legible
68s  blocked receipt and final caption are legible
```

Expected: every claim caption appears with its source evidence; no caption
obscures the policy rows, decision controls, or receipt hash.

### Task 3: Encode the video-only delivery artifact

**Files:**
- Read: `/tmp/changesafe-yc-blocking-demo/raw-video/`
- Create: `artifacts/yc-f26/changesafe-yc-f26-blocking-demo-no-voice.mp4`

**Interfaces:**
- Consumes: the approved raw WebM recording from Task 2.
- Produces: a fast-start H.264 MP4 containing exactly one video stream.

- [ ] **Step 1: Install FFmpeg only in a temporary directory**

Run:

```bash
VIDEO_TOOL_DIR=$(mktemp -d /tmp/changesafe-video-tools.XXXXXX)
npm install --prefix "$VIDEO_TOOL_DIR" --no-save ffmpeg-static
FFMPEG_BIN=$(node -p "require('$VIDEO_TOOL_DIR/node_modules/ffmpeg-static')")
```

Expected: the project `package.json`, `package-lock.json`, and `node_modules`
are unchanged by the encoding tool installation.

- [ ] **Step 2: Encode H.264 video with no audio mapping**

Run:

```bash
RAW_VIDEO=$(find /tmp/changesafe-yc-blocking-demo/raw-video -maxdepth 1 -type f -name '*.webm' -print -quit)
test -n "$RAW_VIDEO"
"$FFMPEG_BIN" -y -hide_banner \
  -i "$RAW_VIDEO" \
  -map 0:v:0 -an \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -movflags +faststart \
  artifacts/yc-f26/changesafe-yc-f26-blocking-demo-no-voice.mp4
```

Expected: the FFmpeg summary reports `audio:0kB` and writes the new file
without replacing either existing YC video.

- [ ] **Step 3: Validate stream shape and upload constraints**

Run:

```bash
"$FFMPEG_BIN" -v error \
  -i artifacts/yc-f26/changesafe-yc-f26-blocking-demo-no-voice.mp4 \
  -map 0:v:0 -f null -
"$FFMPEG_BIN" -hide_banner \
  -i artifacts/yc-f26/changesafe-yc-f26-blocking-demo-no-voice.mp4
stat -f 'bytes=%z' artifacts/yc-f26/changesafe-yc-f26-blocking-demo-no-voice.mp4
```

Expected: one H.264 1920×1080 video stream, no `Audio:` stream, successful
full decode, duration 60–75 seconds, and fewer than 100,000,000 bytes.

### Task 4: Perform delivery-quality review and preserve repository scope

**Files:**
- Read: `artifacts/yc-f26/changesafe-yc-f26-blocking-demo-no-voice.mp4`
- Read: `docs/superpowers/specs/2026-07-28-yc-blocking-demo-redesign-design.md`
- Modify: none

**Interfaces:**
- Consumes: encoded video from Task 3 and acceptance criteria from the design.
- Produces: evidence-backed handoff with known file path, media metadata, and
  no accidental repository changes.

- [ ] **Step 1: Play the encoded file in QuickTime**

Open the final artifact in QuickTime and begin playback. Confirm the player
shows a 60–75 second runtime. Use the FFmpeg stream check in Task 3 as the
authoritative proof that no audio track exists.

Expected: playback begins without a decoding error and the final blocked-receipt
frame is reachable on the timeline.

- [ ] **Step 2: Run a visual acceptance checklist against the final MP4**

Check the final file, not only the raw recording:

```text
[ ] Analyze click is visually unambiguous.
[ ] REMOVE and 91% confidence appear before any policy verdict.
[ ] Both named BLOCK findings appear in separate readable holds.
[ ] CRITICAL risk appears with the second BLOCK.
[ ] Approval is visibly impossible; no enabled approval control appears.
[ ] The blocked receipt appears before the final tagline.
[ ] The final tagline reads exactly: AI proposes. Deterministic code validates. A human decides.
[ ] No desktop, secrets, real infrastructure, or live-model claim appears.
```

Expected: all boxes are true. If any box is false, retake Task 2 and retain
the existing artifacts unchanged.

- [ ] **Step 3: Confirm repository hygiene and handoff**

Run:

```bash
git status --short
git diff -- package-lock.json
```

Expected: the new MP4 remains untracked under `artifacts/yc-f26/`; the
pre-existing `package-lock.json` change remains untouched; no temporary media
or FFmpeg files appear in Git.

- [ ] **Step 4: Commit the implementation plan only**

Run:

```bash
git add docs/superpowers/plans/2026-07-28-yc-blocking-demo-redesign.md
git commit -m "docs: plan YC blocking demo redesign"
```

Expected: only the plan is committed. The video remains a local upload-ready
artifact for the YC application.
