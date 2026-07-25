## What and why

<!-- What changes, and what problem it solves. Link an issue if one exists. -->

## Safety review

<!-- Required for anything touching lib/policies, lib/patch,
     lib/domain/state-machine.ts, lib/receipt, or lib/ai.
     Delete this section only for docs-only changes. -->

- Invariant(s) this change preserves:
- Test that proves it:
- Does this change any policy's verdict for existing scenarios? (yes/no —
  if yes, `POLICY_VERSION` is bumped and receipt tests updated)

## Checklist

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass
- [ ] `npm run test:e2e` passes (or unaffected — say which)
- [ ] No execution path to real infrastructure added
- [ ] No secrets, real data, or third-party branding added
- [ ] Tests added or updated for the behavior change
