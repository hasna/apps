# Changelog

All notable changes to `@hasna/statusline` are documented here.

## 0.0.5 - 2026-07-30

- Show the account actually occupying a config dir after an in-place
  `accounts switch-account`. The switch swaps the live auth files inside the
  config dir and records the new occupant in
  `.accounts-auth/switched-account.json` without moving the dir, so the
  registry entry and the dir's path name both keep describing the dir's
  owner; the `auth-profile` segment kept rendering the old account until a
  fresh login landed. The occupant marker now wins over both the registry and
  the layout name, for the profile segment and the registry-email fallback
  alike; the session's own live state file still wins for the email, and a
  cleared marker (owner restored / fresh login) falls back to the owner as
  before.

## 0.0.4 - 2026-07-28

- Lowercase model labels everywhere: `model-with-reasoning` now lowercases the
  host's display label and the effort level, so "Fable 5" + "High" render as
  `fable 5 (high)` and match the id-derived form.
- Add `fast-mode` segment: renders `fast` when the session config dir's
  `settings.json` has `fastMode: true`, resolved per-process via
  `CLAUDE_CONFIG_DIR` so concurrent sessions under different profiles stay
  independent.
- Add `newline` segment: starts a new status row (Claude Code renders each
  stdout line as its own row); rows that end up empty are dropped.
- Pin `@modelcontextprotocol/sdk@1.12.1`, `zod@3.25.76`, and
  `typescript@5.9.3` exactly. `bun.lock` is gitignored, so installs resolve
  fresh from ranges; the caret'd SDK drifted to 1.29.0, which nests its own
  zod 4 copy and fails typecheck under TS 5.9. Exact pins restore a single-zod,
  deterministic tree.

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
