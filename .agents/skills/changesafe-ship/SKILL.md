---
name: changesafe-ship
description: Default close-out workflow once work on a ChangeSafe branch is verified complete — commit, push, open a PR. Use when a task, story, or project phase is finished and the user asks to wrap up, ship, or says "commit/push/PR" without more detail.
---

# Shipping finished work on ChangeSafe

When work on a branch is verified done, the default workflow is
**commit → push → PR**, not just a commit left sitting locally. Don't wait to
be asked for each step individually once the user has signaled a phase is
complete.

## Before touching git

1. Confirm the full gate is actually green first (see repo `AGENTS.md` for the
   exact command list — lint, typecheck, builds, `npm test`, `npm run build`,
   `test:e2e`, scenario check/gallery). Never commit or push on the strength
   of partial verification.
2. `git status --short` — review what's staged/unstaged before adding
   anything broad. Never `git add -A` blindly in this repo; add the files you
   know are part of the change.

## Commit

- One intentional commit (or a few, if the work is naturally separable) with
  a message describing *why*, not a changelog of *what*. Never amend, never
  force anything at this stage.
- Never commit `.env` files or anything that looks like a credential, even if
  the filename looks innocuous — check contents, not just names.

## Before pushing: check for branch drift, every time

This is the step that's easy to skip and expensive when skipped. Branches in
this repo are frequently long-lived alongside fast-moving parallel work (codex
worktrees, other sessions). Before pushing:

```bash
git fetch origin main --quiet
git log origin/main..HEAD --oneline      # what does this branch add?
git merge-base --is-ancestor <commit> origin/main && echo yes || echo no
```

If commits that look unique to this branch are actually **already on
`origin/main` under different SHAs** (same feature landed via a different PR
in the meantime — this has happened with the vNext console work), a raw PR
against `main` will show a misleadingly huge diff full of duplicated content
that can't be meaningfully reviewed. Signs of this: the diff touches far more
files than the actual task did, or `git rebase origin/main` reports
`warning: skipped previously applied commit <sha>` (git detected an identical
patch already upstream via patch-id — this is the reliable signal, not a
guess).

If drift is found: `git rebase origin/main` on the feature branch. Duplicate
commits get skipped automatically; only genuinely new commits replay, and
usually only genuinely-overlapping *docs* (roadmap/changelog paragraphs edited
on both sides) conflict — resolve those by taking whichever side is actually
true of the *post-rebase* code (check the real file/behavior, don't just pick
a side because it's "ours"). Re-run the full gate after any rebase before
pushing — a clean patch-level rebase doesn't guarantee the recombined result
still builds and passes.

## Push and PR

```bash
git push origin <branch>              # add --force-with-lease only if you just rebased a branch already on origin
gh pr list --head <branch> --state all --json number,state,url   # avoid opening a duplicate
gh pr create --title "..." --body "$(cat <<'EOF'
## Summary
...
## Test plan
...
EOF
)"
```

- Only force-push (`--force-with-lease`, never bare `--force`) when you just
  rebased a branch that was already pushed — and only that branch, never
  `main`.
- Check for an existing open (or even merged/closed) PR for the same head
  branch before creating a new one.
- Report the PR URL back; don't merge it yourself unless explicitly asked.
