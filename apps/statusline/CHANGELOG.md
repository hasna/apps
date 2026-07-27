# Changelog

All notable changes to `@hasna/statusline` are documented here.

## 0.0.3 - 2026-07-27

- Add `auth-profile` and `auth-email` segments that report the account **this
  session** runs as, resolved from the process's own `CLAUDE_CONFIG_DIR` rather
  than any global active-profile pointer, so concurrent sessions under different
  accounts each render their own.
- Add `model-with-reasoning`, `five-hour-limit`, `seven-day-limit`, and
  `thread-title` segments, and parse `effort.level`, `thinking.enabled`,
  `rate_limits.*`, and `session_name` from the Claude Code payload.
- Fix `statusline install claude` writing to `~/.claude/settings.json` even when
  the session is bound to an isolated `CLAUDE_CONFIG_DIR` — the installed
  statusline never ran. New `claudeSettingsPath()` export resolves the real target.
- Add optional per-segment colours (`statusline colors on|off`, config `colors`,
  `NO_COLOR` respected); the rate-limit segments turn red past 80%.

### Fixed after review

- Read the agent's login record where the agent actually writes it. With
  `CLAUDE_CONFIG_DIR` unset that is `~/.claude.json`, not `~/.claude/.claude.json`
  — the old path is an unmanaged leftover, so a bare session showed no account, or
  worse, a stale one. `.config.json` precedence and non-production OAuth variants
  are handled too. New `sessionStateFile()` export.
- Never adopt another tool's registry entry when several claim one config dir.
- `installClaude()` creates only `~/.claude` on demand: a missing isolated config
  dir, or any path handed to it, is refused rather than fabricated (driven from a
  registry listing that would otherwise conjure other machines' profile trees). The
  decision follows the target path and the `env` now threaded through
  `installClaude(settingsPath, env)`, not the installing shell's own
  `CLAUDE_CONFIG_DIR` — the same call no longer does opposite things depending on
  which profile the operator happens to be in. It also no longer throws an unhelpful
  parse error on malformed settings, and preserves other keys on an existing
  `statusLine` such as `padding`.
- Ask `@hasna/accounts` where its state lives when it is installed, instead of only
  assuming its default paths. Lazy, optional, and not a dependency.

## 0.0.2 - 2026-07-24

- Compact `statusline list` output by default: enabled rows first, row caps,
  totals, and hints to detail paths (#1).
- Add gradual-disclosure paths: `show`/`inspect`, `search`, and the `--verbose`,
  `--json`, `--limit`, `--all`, `--enabled`, `--disabled`, `--search` flags (#1).
- Make the git-branch segment test independent of a hard-coded local path/branch (#1).
- Extend test coverage toward 100% (#4).

## 0.0.1

- Initial release: composable statusline CLI with pre-built toggleable segments,
  provider model, SDK exports, and MCP server.
