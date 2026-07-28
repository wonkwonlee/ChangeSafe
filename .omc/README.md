# OMC project handoffs

`.omc` is primarily runtime state for oh-my-claude. Generated sessions,
state, logs, caches, and machine-specific metadata remain ignored.

Only human-authored Markdown handoffs under `.omc/handoffs/` may be committed
when they contain durable project decisions or an active cross-environment
handoff. Do not put secrets, transcripts, local paths, credentials, or
session-specific runtime state here.
