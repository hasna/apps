---
"@hasna/snapshots": minor
---

Power-outage recovery verdict (2026-08-24): tmux panes now carry resume identity, opencode2 is restartable-detected, and restore has a freshness gate.

- Capture: each tmux pane's `resume_identity` attribute resolves the newest opencode2 `session_v2` row whose `directory` matches the pane cwd (read-only, from `~/.local/share/opencode/opencode.db`) and the newest Claude Code JSONL under `~/.claude/projects/<slug>/` whose recorded `cwd` matches (content match, never the lossy slug). Configurable via `HASNA_SNAPSHOTS_OPENCODE_DB` / `HASNA_SNAPSHOTS_CLAUDE_PROJECTS_DIR`; missing sources become info diagnostics.
- Restartable detector: `opencode2 --continue/-c/--session/-s` (OpenCode v2 resume forms) is now detected alongside the classic `--resume` agents.
- Restore: new `--max-age <duration>` gate (env `HASNA_SNAPSHOTS_MAX_AGE`) refuses snapshots older than the configured limit with a logged, audit-trailed `restore.max-age-refused` error; the limit is recorded on the plan and re-checked at apply time.
