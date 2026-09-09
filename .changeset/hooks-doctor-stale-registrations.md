---
"@hasna/hooks": patch
---

`hooks doctor` detects and repairs stale hook registrations — a settings entry
wiring `hooks run <name>` whose name resolves nowhere.

A stale registration is not a dormant leftover: the agent spawns
`hooks run <name>` on every event it is wired to, the lookup fails, and the
agent surfaces a non-blocking error on every tool call. `hooks install` and
`hooks remove` never re-check a name already written, `hooks doctor` reported
only a generic hook-health issue without naming the settings file, and its
`--json` path exited 0 even when it carried error findings.

- `hooks doctor` scans every JSON settings file the installer writes to
  (`~/.claude/settings.json`, `~/.gemini/settings.json` for the selected scope)
  for `hooks run <name>`, `hooks run <name> --profile <id>` and the legacy
  `hook-<name>` commands whose name does not resolve via `resolveHook()` —
  exactly the lookup `hooks run` performs — and reports the settings file, the
  event key and the command. Direct-path wiring the installer did not write is
  never treated as a registration.
- `hooks doctor --fix` removes exactly those entries: sibling hooks in the same
  entry, unrelated event keys, matchers and every non-hook settings key are
  preserved, the file stays valid JSON, a `.bak` sibling is written before the
  edit, and a second run is a no-op. A registration whose hook resolves is
  never touched. The `--json` output gains `stale`, `fixed` and `backups`.
- `hooks doctor` exits non-zero on a stale registration in both the plain and
  `--json` paths, so a CI or health check can gate on it.
- Test isolation: `src/mcp/fail-closed.test.ts` installed `fast-preview-hook`
  with `scope: "global"` and no settings-path override, so `getSettingsPath`
  resolved the operator's live `~/.claude/settings.json` — a test run itself
  created the ghost registration that then failed every tool call. The file now
  pins `HASNA_HOOKS_CLAUDE_SETTINGS_PATH` / `HASNA_HOOKS_GEMINI_SETTINGS_PATH` /
  `HASNA_HOOKS_CODEWITH_CONFIG_PATH` under its own `TEST_HOME`, with a
  regression assertion that every global settings path it can write resolves
  inside that home.
