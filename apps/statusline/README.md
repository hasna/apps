# statusline

Tiny, composable statusline CLI for AI coding agents. Pre-built segments you toggle
on and off — machine name, project + branch, model, context remaining, session cost,
and more — rendered as one or more rows in your agent's status bar.

```
apple03 · statusline (main) · 12h · 1.2k · fable 5 [1m] · 90% left · 95% cached · $0.04
```

Built with [Bun](https://bun.sh) + TypeScript. The CLI renderer is dependency-light; the optional MCP server uses the Model Context Protocol SDK. Apache-2.0.

## Install

```bash
bun install -g @hasna/statusline
statusline install claude        # wires it into the active Claude config dir
```

That's it — Claude Code picks it up on the next status refresh (no restart needed).

## Segments

`statusline list` shows a compact, enabled-first summary of your segments (use
`statusline list --all` for every row). The table below is the full catalog — all 27
segment ids from `src/segments/index.ts`.

`renderLine` walks your configured segment order, renders each one, and **drops**
anything that returns `null` or throws. A failed segment never breaks the host UI.

| Segment | Default | Description | Data source | Omit when | Example |
|---------|---------|-------------|-------------|-----------|---------|
| `machine` | on | Machine hostname (short) | `os.hostname()` — first label before `.` | never (always renders) | `apple03` |
| `project` | on | Project name with current Git branch | `gitProjectName(cwd)` + `gitBranch(cwd)`; falls back to cwd basename | no project name resolvable | `statusline (main)` |
| `project-name` | off | Project name only | `gitProjectName(cwd)` or cwd basename | outside a git repo with no name | `statusline` |
| `git-branch` | off | Current Git branch | `git branch --show-current` in `cwd` | outside git or detached | `main` |
| `commit-age` | on | Time since last commit (compact) | `git log -1` epoch vs now | no commits / not a repo | `12h` |
| `loc` | on | Lines of code tracked by Git (compact) | `git ls-files` + `wc -l` in repo root | outside git or zero lines | `1.2k` |
| `current-dir` | off | Current working directory (basename) | `StatusContext.cwd` | never (always renders basename) | `statusline` |
| `model` | off | Current model name (no context tag) | `StatusContext.model.id` via friendly formatter | no model id | `fable 5` |
| `model-context` | on | Model name with context-size tag | same formatter, keeps `[tag]` suffix | no model id | `fable 5 [1m]` |
| `model-with-reasoning` | off | Model name with its reasoning effort | lowercased `model.display_name` (or friendly id) + `effort.level`; falls back to `thinking.enabled` when on | no model | `fable (xhigh)` |
| `fast-mode` | off | Fast-mode indicator | `fastMode` in this session's Claude config-dir `settings.json` | fast mode is off or settings are unavailable | `fast` |
| `auth-profile` | off | Account profile this session runs as | this process's `CLAUDE_CONFIG_DIR`, resolved against the accounts registry | config dir is unmanaged and has no login | `account001` |
| `auth-email` | off | Account email this session is logged in as | the agent's own login record for this config dir, else the registry | no login recorded | `dev@example.com` |
| `five-hour-limit` | off | Percentage of the 5-hour rate limit used | `rate_limits.five_hour.used_percentage` | host reports no limit data | `5h:42%` |
| `seven-day-limit` | off | Percentage of the 7-day rate limit used | `rate_limits.seven_day.used_percentage` | host reports no limit data | `7d:12%` |
| `usage-session` | off | Session (5-hour) usage **remaining** for this pane's own account | this process's `CLAUDE_CONFIG_DIR` account uuid → the accounts usage cache at `~/.hasna/accounts/cache/usage/<uuid>.json` (kept warm by `@hasna/accounts`; **no cloud call**) | never omitted — shows `5h —` when usage is unknown, missing, stale, or rate-limited | `5h 87%` |
| `usage-weekly` | off | Weekly usage **remaining** for this pane's own account (the binding limit) | same local usage cache as `usage-session` | never omitted — shows `7d —` when usage is unavailable | `7d 92%` |
| `thread-title` | off | Thread title set with `/rename` | `session_name` | thread not renamed | `ship it` |
| `context-used` | off | Percentage of context window used | session transcript JSONL (`contextUsage`) | transcript missing/unreadable | `10%` |
| `context-remaining` | on | Percentage of context window remaining | transcript via `contextUsage` | transcript missing/unreadable | `90% left` |
| `used-tokens` | off | Total tokens in the context window | transcript usage block (input + output) | transcript missing/unreadable | `102k tok` |
| `cache-rate` | on | Percentage of input tokens served from cache | transcript usage block (`cache_read_input_tokens` / total input-side); Codex rollout / OpenCode DB for those providers | transcript missing/unreadable or zero input-side tokens | `87% cached` |
| `cost` | on | Session cost in USD | `StatusContext.cost.totalCostUsd` | cost is zero or missing | `$1,234.50` |
| `duration` | off | Session wall-clock duration | `StatusContext.cost.totalDurationMs` | duration is zero or missing | `1h30m` |
| `lines-changed` | off | Lines added/removed this session | `cost.totalLinesAdded/Removed` | both zero | `+142/-18` |
| `output-style` | off | Active output style | `StatusContext.outputStyle` | style is `default` or missing | `concise` |
| `agent-version` | off | Host agent version | `StatusContext.version` | version missing | `v2.1.39` |
| `session-id` | off | Session identifier (short) | first UUID segment of `sessionId` | no session id | `abc12345` |
| `newline` | off | Row break | renderer starts a new output row | always (the segment emits no text itself) | line break |

### Context segments and transcripts

Segments that report context usage (`context-used`, `context-remaining`, `used-tokens`,
`cache-rate`) read the session transcript path from the provider payload.
`contextUsage` scans the JSONL for the last assistant entry with a `usage` block and
sums `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Window
size is **1,000,000** when the model id contains `[1m]`, otherwise **200,000**.

`cache-rate` is `cache_read_input_tokens / (input_tokens + cache_creation_input_tokens
+ cache_read_input_tokens)` from the same last usage block, rendered as a rounded
percentage (`87% cached`). It renders `0% cached` during the pre-warm phase of a
session (a nonzero divisor with no cache hits yet) — the same render-zero-not-drop
convention as `five-hour-limit` — and is omitted only when the transcript is
missing/unreadable or the divisor is zero. For Codex and OpenCode it reads those
providers' own usage channels instead (see Providers below).

With the test fixture transcript (100k input-side tokens on a 1m window), expect
`context-used` → `10%`, `context-remaining` → `90% left`, `used-tokens` → `102k tok`,
`cache-rate` → `95% cached`.

### Which account am I? (`auth-profile`)

Statusline payloads carry no account or profile field, so `auth-profile` reads the
config dir **this process** was handed — `CLAUDE_CONFIG_DIR`, which multi-account
launchers set per session — and resolves it in order:

1. the `@hasna/accounts` registry entry whose `dir` matches, preferring one that
   belongs to the agent being rendered (a dir can be claimed by several tools;
   another tool's entry is never adopted);
2. the managed layout `<accountsHome>/profiles/<tool>/<name>`, for dirs the local
   registry has no entry for;
3. the account email the agent recorded in that dir, when neither names a profile.

It never consults an "active"/"current" profile pointer. Those are global — and,
against a shared registry, global across every machine: two sessions running under
different accounts would both report whichever profile was switched to last.
Resolving from the process's own config dir keeps concurrent sessions independent.

Where the agent's login record lives mirrors Claude Code's own rule: `.config.json`
in the config dir wins, otherwise `.claude<oauth-variant>.json`. Note the base dir
is the config dir **or the home dir** — with `CLAUDE_CONFIG_DIR` unset the file is
`~/.claude.json`, a sibling of `~/.claude` rather than something inside it.

Registry location comes from `@hasna/accounts` itself when it is installed
alongside this package (imported lazily, only when an auth segment renders);
otherwise from its documented overrides `ACCOUNTS_STORE_PATH`, then
`ACCOUNTS_HOME`, then `~/.hasna/accounts`. `@hasna/accounts` is not a dependency —
with none of it present the segment renders nothing rather than guessing.

**Known limitation.** Renaming a profile does not move its dir. For a profile the
local registry has no entry for, step 2 therefore reports the name the dir was
created with until the registry catches up. Step 1 is tried first so a profile the
registry knows about always wins.

### Colours

Segments may declare a colour, applied by `renderLine` when colours are on
(the default). The rate-limit segments escalate from yellow to red at 80%.

```bash
statusline colors off      # or set "colors": false in the config
```

`NO_COLOR` in the environment always wins.

### Quick reference from `statusline list`

`statusline list` is compact by default so it stays friendly in agent terminals —
enabled segments first, capped rows, and hints for the detail paths:

```
Segments: 8 enabled / 27 total (showing 12 of 27)
state  default  id
on     yes      machine
on     yes      project
on     yes      commit-age
on     yes      loc
on     yes      model-context
on     yes      context-remaining
on     yes      cache-rate
on     yes      cost
off    no       project-name
off    no       git-branch
off    no       current-dir
off    no       model
off    no       model-with-reasoning
Hint: use `--all` for all matching rows, `statusline show <id>` for details, `--verbose` for descriptions, `--json` for machines.
```

Use gradual disclosure when you need more:

```bash
statusline list --verbose             # include descriptions, still capped
statusline list --all --verbose       # include every row with descriptions
statusline list --all                 # show every segment row
statusline list --limit 5             # cap rows explicitly
statusline list --enabled             # only enabled segments
statusline list --disabled            # only disabled segments
statusline list --search token        # filter by id or description
statusline list --json                # structured output for tooling
statusline show model-context         # full details for one segment
statusline inspect used-tokens --json # JSON detail path
```

`statusline list --json` returns `{ total, matching, showing, limited, segments, next }`.
Each segment has `{ id, description, enabled, defaultEnabled }`; `next` is `null`
unless the result is limited. Column padding is display-only — it does not affect
statusbar width.

## Usage

```bash
statusline list                          # compact segment summary
statusline search token --json           # search ids/descriptions; list flags apply
statusline show model-context             # show one segment in detail
statusline enable used-tokens duration    # turn segments on (appended at the end)
statusline disable loc                    # turn segments off
statusline colors off                     # drop ANSI colours
statusline order machine project model-context cost   # exact order = enabled set
statusline separator " | "                # change the separator
statusline preview                        # render a sample line from the current dir
statusline reset                          # back to defaults
statusline install claude                 # update the active Claude settings file
statusline version                        # print the package version
```

Config lives at `~/.config/statusline/config.json` (override with `$STATUSLINE_CONFIG`):

```json
{
  "separator": " · ",
  "colors": true,
  "segments": ["machine", "project", "commit-age", "loc", "model-context", "context-remaining", "cache-rate", "cost"]
}
```

## Theming and layout

There is no fixed width knob — the rendered line grows with enabled segments. Control
length practically:

1. **Fewer segments** — `statusline disable` segments you do not need, or `statusline order` to pick a compact set.
2. **Shorter separator** — `statusline separator "·"` or `" | "` (default is `" · "`).
3. **Split project info** — use `project-name` + `git-branch` instead of combined `project` if you want to omit the branch when unknown.
4. **Rely on omit-when-null** — segments like `cost`, `context-remaining`, and `lines-changed` disappear when data is unavailable instead of showing placeholders.

**Segment order matters.** `statusline order a b c` sets both the display order and the
exact enabled set — segments not listed are disabled. `statusline enable` appends new
ids to the end; `statusline disable` removes them.

**Config path:** `~/.config/statusline/config.json`, overridable with `$STATUSLINE_CONFIG`.
`statusline reset` restores `defaultConfig()` (separator + default segment list above).

## How it works

Claude Code pipes a JSON payload (cwd, model, session cost, transcript path, …) to the
configured `statusLine` command on every status refresh. `statusline render` parses it,
renders each enabled segment, drops anything unavailable, and prints one or more rows.
The `newline` segment starts a new row; empty rows are removed. Segments
that need more than the payload offers (e.g. `context-remaining`) read the session
transcript to compute it. A segment failure is never fatal — it's simply omitted.

## SDK

The package root is a side-effect-free SDK surface:

```ts
import {
  renderStatusline,
  listSegments,
  enableSegments,
  saveConfig,
  loadConfig,
} from "@hasna/statusline";

const config = loadConfig();
const line = await renderStatusline({ cwd: process.cwd() }, config);
const next = enableSegments(["duration"], config).config;
saveConfig(next);
```

Useful exports include `parseClaudeInput`, `renderLine`, `renderStatusline`, `segments`,
`getSegment`, `listSegments`, `defaultConfig`, `loadConfig`, `saveConfig`, `configPath`,
`previewStatusline`, `enableSegments`, `disableSegments`, `orderSegments`,
`setSeparator`, `setColors`, `installClaude`, the cache-rate channel
(`cacheRate`, `codexCacheRate`, `latestCodexSessionPath`, `opencodeCacheRate`), and the
account, context, format, and Git helpers.

## MCP

`statusline-mcp` starts a stdio MCP server:

```bash
statusline-mcp
```

It exposes safe tools for `statusline_health`, `render_statusline`, `preview_statusline`,
`list_segments`, `get_config`, `update_config`, `enable_segments`,
`disable_segments`, `order_segments`, and `reset_config`. Config mutation tools
require `confirm_write: true`; every mutation tool supports `dry_run: true`.

The MCP server intentionally does not mutate Claude settings. Use
`statusline install claude` or the `installClaude()` SDK helper when you
explicitly want to wire the CLI into Claude Code.

## Providers

### Claude Code (implemented)

```bash
bun install -g @hasna/statusline
statusline install claude
```

`installClaude()` writes to `$CLAUDE_CONFIG_DIR/settings.json` when the variable is
non-blank, falling back to `~/.claude/settings.json`. A leading `~/` in
`CLAUDE_CONFIG_DIR` is expanded against `$HOME`. This matters for multi-account setups: when a session is
bound to an isolated config dir, `~/.claude/settings.json` is never read, so
installing there wires up a statusline that silently never runs.

Only `~/.claude` is created on demand. Every other target — an isolated config
dir, or a path passed as `installClaude(path)` — must already exist: installing
there is a request to configure a profile someone else created, not to fabricate
one. The rule follows the target, not the shell you install from, so driving a
list of profiles gives the same answer from any session. Pass the environment to
resolve against as `installClaude(undefined, env)`.

```json
{
  "statusLine": { "type": "command", "command": "statusline render" }
}
```

Existing settings are preserved; the previous file is backed up as
`settings.json.bak-statusline`. Claude Code pipes JSON on stdin to `statusline render`
on every status refresh — **no restart needed**.

**stdin fields** parsed by `parseClaudeInput` (`src/providers/claude.ts`):

| Payload field | Maps to `StatusContext` |
|---------------|-------------------------|
| `cwd` / `workspace.current_dir` | `cwd` |
| `workspace.project_dir` | `projectDir` |
| `model.id`, `model.display_name` | `model.id`, `model.displayName` |
| `cost.total_cost_usd` | `cost.totalCostUsd` |
| `cost.total_duration_ms` | `cost.totalDurationMs` |
| `cost.total_lines_added/removed` | `cost.totalLinesAdded/Removed` |
| `transcript_path` | `transcriptPath` |
| `session_id` | `sessionId` |
| `session_name` | `sessionName` |
| `version` | `version` |
| `output_style.name` | `outputStyle` |
| `effort.level` | `effort` |
| `thinking.enabled` | `thinking` |
| `rate_limits.five_hour.used_percentage` | `rateLimits.fiveHour.usedPercentage` |
| `rate_limits.seven_day.used_percentage` | `rateLimits.sevenDay.usedPercentage` |

Every field is optional — partial or empty payloads still produce a usable context.

### Codex CLI (implemented, env-selected)

Codex ships its own built-in segment picker and has no external `statusLine` command
hook, so there is no `statusline install codex` — the renderer is invoked standalone
with the provider selected by the environment:

```bash
STATUSLINE_PROVIDER=codex statusline render
```

`cache-rate` then reads the newest Codex session rollout
(`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, newest file mtime): the LAST
`event_msg` line whose `payload.type` is `token_count`, whose
`payload.info.total_token_usage` holds **cumulative session totals**
(`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, …). The rate is
`cached_input_tokens / (input_tokens + cached_input_tokens + cache_write_input_tokens)`,
clamped to `[0, 1]`. Exposed on the SDK as `latestCodexSessionPath()` /
`codexCacheRate(path?)`. Caveat: the semantics of Codex's `input_tokens` relative to
`cached_input_tokens` (uncached-only vs total) are inferred from measured samples —
the clamp and the fixture tests lock the adapter to the documented shape.

### OpenCode (implemented, env-selected)

OpenCode has no statusline/footer hook in its config as of v1.3.x, so the same
env-selector applies:

```bash
STATUSLINE_PROVIDER=opencode statusline render
```

`cache-rate` reads `~/.local/share/opencode/opencode.db` (SQLite) with a read-only
`Bun.sqlite` query — zero new dependencies, and a WAL lock mid-write degrades to
omitting the segment, never a crash. It takes the newest session row's
`tokens_cache_read / (tokens_input + tokens_cache_read + tokens_cache_write)` from the
`session` table, falling back to `session_v2` when `session` has no populated row (both
schemas carry the columns). SDK surface: `opencodeCacheRate({ dbPath?, sessionId? })`.

### Cursor (not implemented — no verifiable source)

No `statusline install cursor` and no adapter. Unlike Codex and OpenCode, Cursor has
**no local per-turn token-usage record to read**: `~/.cursor/chats/*/store.db` holds
only `blobs`/`meta` tables, and `~/.cursor/ai-tracking/ai-code-tracking.db` carries no
per-turn usage. Token usage is only visible in Cursor's own UI/API, so per the honesty
rule no adapter is fabricated. If Cursor later persists usage locally, an adapter slots
in behind the same `cacheRate(ctx)` dispatch.

### Other agents

| Agent | Status |
|-------|--------|
| Codex CLI | ✅ `STATUSLINE_PROVIDER=codex` — `cache-rate` from the newest session rollout |
| OpenCode | ✅ `STATUSLINE_PROVIDER=opencode` — `cache-rate` from the sessions DB |
| Cursor | ❌ no local per-turn token usage exists — no adapter (see above) |
| Codewith | ⏳ no statusline/footer hook; a future `parseCodewithInput` would map its payload into `StatusContext` and reuse the registry (tracked in STA-00003) |

Adding a provider means one small adapter: agent payload/source → `StatusContext`
(`src/providers/types.ts`) or a `cacheRate(ctx)` data channel. PRs welcome.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
echo '{"cwd":"'$PWD'","model":{"id":"claude-fable-5[1m]"}}' | bun src/cli.ts render
```

Spot-check fixture output:

```bash
cat test/fixtures/claude-input.json | bun src/cli.ts render
```

## License

[Apache-2.0](LICENSE)
