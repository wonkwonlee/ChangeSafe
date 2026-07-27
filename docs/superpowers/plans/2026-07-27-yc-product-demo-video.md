# YC Fall 2026 Product Demo Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an upload-ready, synthetic-English-narrated ChangeSafe product demo MP4 under YC's 3-minute and 100 MB limits.

**Architecture:** Run the local replay-only application on an isolated port, drive the unsafe and safe scenarios with Playwright while recording a deterministic browser video, synthesize the approved narration locally with macOS `say`, then use a temporary npm-provided FFmpeg binary to mux and encode the final MP4. Keep temporary tools and intermediate media outside Git; retain only the final deliverable under `artifacts/yc-f26/`.

**Tech Stack:** Node.js 22, Playwright, macOS `say`, `ffmpeg-static`, H.264, AAC

## Global Constraints

- Runtime must be below 180 seconds.
- Final file must be below 100 MB.
- Output must contain H.264 video and AAC audio in an MP4 container.
- Use replay mode only; configure no model API keys.
- Show both the blocked route-leak workflow and the safe approved/simulated workflow.
- Never claim that the replay fixture is live model output.
- Never claim deterministic evaluation guarantees complete infrastructure safety.
- Expose no secrets, employer data, personal data, or unrelated desktop content.
- Do not modify or stage the user's existing `package-lock.json` change.

---

### Task 1: Build Narration and Recording Inputs

**Files:**
- Read: `docs/DEMO_SCRIPT.md`
- Create: `/tmp/changesafe-yc-demo/narration.txt`
- Create: `/tmp/changesafe-yc-demo/narration.aiff`

**Interfaces:**
- Consumes: the approved five-shot English narration in `docs/DEMO_SCRIPT.md`
- Produces: a single normalized narration script and AIFF audio file for the final mux

- [ ] **Step 1: Create an isolated workspace**

Run:

```bash
mkdir -p /tmp/changesafe-yc-demo
mkdir -p artifacts/yc-f26
```

Expected: both directories exist; neither operation changes tracked source.

- [ ] **Step 2: Write the exact approved narration**

Use `apply_patch` to create `/tmp/changesafe-yc-demo/narration.txt` from the five quoted sections in `docs/DEMO_SCRIPT.md`, preserving the explicit replay and sandbox qualifications.

- [ ] **Step 3: Synthesize US English narration**

Run:

```bash
say -v Samantha -r 170 \
  -f /tmp/changesafe-yc-demo/narration.txt \
  -o /tmp/changesafe-yc-demo/narration.aiff
```

Expected: `narration.aiff` exists and is non-empty.

- [ ] **Step 4: Verify the narration duration**

Run:

```bash
afinfo /tmp/changesafe-yc-demo/narration.aiff
```

Expected: duration is between 95 and 150 seconds, leaving room for visual pauses while remaining below the 180-second limit.

### Task 2: Record the Deterministic Product Walkthrough

**Files:**
- Create: `/tmp/changesafe-yc-demo/record.mjs`
- Create: `/tmp/changesafe-yc-demo/raw-video/*.webm`
- Create: `/tmp/changesafe-yc-demo/app.log`

**Interfaces:**
- Consumes: the local application at `http://127.0.0.1:3100`
- Produces: a 1920×1080 WebM recording with deterministic scenario interactions

- [ ] **Step 1: Start the replay-only application**

Run:

```bash
env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY \
  PORT=3100 npm run dev > /tmp/changesafe-yc-demo/app.log 2>&1
```

Expected: the application reports ready on port 3100 and `/api/status` advertises replay-only mode.

- [ ] **Step 2: Write the Playwright recording program**

Use `apply_patch` to create `/tmp/changesafe-yc-demo/record.mjs`. It must:

- launch Chromium at 1920×1080 with `recordVideo`;
- open the local application;
- select `INC-4977 — Suspected route leak`;
- inject unobtrusive fixed section captions into the recording page;
- run replay analysis, scroll to the two BLOCK findings, show the disabled approval state, and issue the blocked receipt;
- select `INC-4821 — Degraded primary uplink`;
- run replay analysis, approve, simulate, and show the final receipt;
- pause long enough at each evidence point for narration;
- close the context cleanly so Playwright finalizes the WebM file.

- [ ] **Step 3: Run the recording**

Run:

```bash
node /tmp/changesafe-yc-demo/record.mjs
```

Expected: exactly one non-empty `.webm` file appears under `/tmp/changesafe-yc-demo/raw-video/`.

- [ ] **Step 4: Verify recording evidence**

Run a Playwright-assisted snapshot check against the same workflow and assert that the visible states include:

```text
Authored red-team fixture — not model output
2 BLOCK
risk: CRITICAL
Approval is not possible
7 PASS
risk: LOW
Sandbox verification passed
```

Expected: all required proof strings are observed.

### Task 3: Encode the Upload-Ready MP4

**Files:**
- Create: `/tmp/changesafe-yc-demo/ffmpeg-runtime/`
- Create: `artifacts/yc-f26/changesafe-yc-f26-product-demo.mp4`

**Interfaces:**
- Consumes: the raw WebM recording and AIFF narration
- Produces: the final H.264/AAC MP4

- [ ] **Step 1: Install a temporary FFmpeg binary**

Run from `/tmp/changesafe-yc-demo/ffmpeg-runtime`:

```bash
npm init -y
npm install --no-save ffmpeg-static
```

Expected: `node -p "require('ffmpeg-static')"` prints an executable path under the temporary directory. No project dependency files change.

- [ ] **Step 2: Inspect source durations**

Run the temporary FFmpeg binary with `-i` against the WebM and AIFF files.

Expected: both streams are readable and each duration is below 180 seconds.

- [ ] **Step 3: Mux and encode**

Run:

```bash
"$FFMPEG_BIN" \
  -i "$RAW_WEBM" \
  -i /tmp/changesafe-yc-demo/narration.aiff \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p \
  -c:a aac -b:a 160k \
  -shortest -movflags +faststart \
  artifacts/yc-f26/changesafe-yc-f26-product-demo.mp4
```

Expected: an MP4 file is created with one video stream and one audio stream.

- [ ] **Step 4: Verify hard upload limits**

Run:

```bash
ls -lh artifacts/yc-f26/changesafe-yc-f26-product-demo.mp4
"$FFMPEG_BIN" -i artifacts/yc-f26/changesafe-yc-f26-product-demo.mp4
```

Expected: duration below 180 seconds, size below 100 MB, H.264 video, AAC audio.

### Task 4: Visual and Playback QA

**Files:**
- Read: `artifacts/yc-f26/changesafe-yc-f26-product-demo.mp4`
- Create: `/tmp/changesafe-yc-demo/qa-first.png`
- Create: `/tmp/changesafe-yc-demo/qa-middle.png`
- Create: `/tmp/changesafe-yc-demo/qa-final.png`

**Interfaces:**
- Consumes: the final MP4
- Produces: visual and playback evidence sufficient to claim the deliverable is complete

- [ ] **Step 1: Extract representative frames**

Use the temporary FFmpeg binary to extract frames near 3 seconds, the blocked verdict, and the final receipt.

Expected: all three PNG files are non-empty.

- [ ] **Step 2: Inspect all representative frames**

Use `view_image` on each PNG.

Expected: UI and captions are legible; no secrets, unrelated desktop content, clipped controls, or misleading claims appear.

- [ ] **Step 3: Play the final file locally**

Open the MP4 with QuickTime Player and verify beginning-to-end playback and audible narration.

Expected: playback completes without decode errors, frozen frames, or missing audio.

- [ ] **Step 4: Verify repository hygiene**

Run:

```bash
git status --short
```

Expected: the pre-existing `package-lock.json` modification remains untouched; the plan is tracked; the final MP4 is untracked under `artifacts/yc-f26/`; no temporary npm or media files appear in Git.

- [ ] **Step 5: Commit the implementation plan**

Run:

```bash
git add docs/superpowers/plans/2026-07-27-yc-product-demo-video.md
git commit -m "docs: plan YC product demo production"
```

Expected: only the implementation plan is committed.

