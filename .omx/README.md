# OMX project context

`.omx` is primarily runtime state for oh-my-codex. Generated sessions, state,
logs, caches, metrics, runtime binaries, tmux metadata, and machine-specific
files remain ignored.

Only human-authored Markdown in these directories may be committed:

- `.omx/context/` — durable project context and decisions
- `.omx/plans/` — implementation or research plans that should travel with the repo
- `.omx/specs/` — durable requirements or specifications

Do not commit session transcripts, generated state, absolute local paths,
credentials, API keys, or other machine-specific data.
