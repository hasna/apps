# statusline

Tiny, composable statusline CLI for AI coding agents. Pre-built segments you toggle
on and off — machine name, project + branch, model, context remaining, session cost,
and more — rendered as a single line for your agent's status bar.

```
apple03 · statusline (main) · 12h · 1.2k · fable 5 [1m] · 90% left · $0.04
```

Built with [Bun](https://bun.sh) + TypeScript. The CLI renderer is dependency-light; the optional MCP server uses the Model Context Protocol SDK. Apache-2.0.

## Install

```bash
bun install -g @hasna/statusline
statusline install claude        # wires it into ~/.claude/settings.json
```

That's it — Claude Code picks it up on the next status refresh (no restart needed).

## Segments

`statusline list` shows a compact, enabled-first summary of your segments (use
`statusline list --all` for every row). The table below is the full catalog — all 18
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
| `current-dir` | off | Current working directory (basename) | `StatusContext.cwd` | never (always renders basename) | `open-statusline` |
| `model` | off | Current model name (no context tag) | `StatusContext.model.id` via friendly formatter | no model id | `fable 5` |
| `model-context` | on | Model name with context-size tag | same formatter, keeps `[tag]` suffix | no model id | `fable 5 [1m]` |
| `context-used` | off | Percentage of context window used | session transcript JSONL (`contextUsage`) | transcript missing/unreadable | `10%` |
| `context-remaining` | on | Percentage of context window remaining | transcript via `contextUsage` | transcript missing/unreadable | `90% left` |
| `used-tokens` | off | Total tokens in the context window | transcript usage block (input + output) | transcript missing/unreadable | `102k tok` |
| `cost` | on | Session cost in USD | `StatusContext.cost.totalCostUsd` | cost is zero or missing | `$1,234.50` |
| `duration` | off | Session wall-clock duration | `StatusContext.cost.totalDurationMs` | duration missing | `1h30m` |
| `lines-changed` | off | Lines added/removed this session | `cost.totalLinesAdded/Removed` | both zero | `+142/-18` |
| `output-style` | off | Active output style | `StatusContext.outputStyle` | style is `default` or missing | `concise` |
| `agent-version` | off | Host agent version | `StatusContext.version` | version missing | `v2.1.39` |
| `session-id` | off | Session identifier (short) | first UUID segment of `sessionId` | no session id | `abc12345` |

### Context segments and transcripts

Segments that report context usage (`context-used`, `context-remaining`, `used-tokens`)
read the session transcript path from the provider payload. `contextUsage` scans the
JSONL for the last assistant entry with a `usage` block and sums
`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Window size is
**1,000,000** when the model id contains `[1m]`, otherwise **200,000**.

With the test fixture transcript (100k input-side tokens on a 1m window), expect
`context-used` → `10%`, `context-remaining` → `90% left`, `used-tokens` → `102k tok`.

### Quick reference from `statusline list`

`statusline list` is compact by default so it stays friendly in agent terminals —
enabled segments first, capped rows, and hints for the detail paths:

```
Segments: 7 enabled / 18 total (showing 12 of 18)
state  default  id
on     yes      machine
on     yes      project
on     yes      commit-age
on     yes      loc
on     yes      model-context
on     yes      context-remaining
on     yes      cost
off    no       project-name
off    no       git-branch
off    no       current-dir
off    no       model
off    no       context-used
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
statusline enable used-tokens duration    # turn segments on (appended at the end)
statusline disable loc                    # turn segments off
statusline order machine project model-context cost   # exact order = enabled set
statusline separator " | "                # change the separator
statusline preview                        # render a sample line from the current dir
statusline reset                          # back to defaults
```

Config lives at `~/.config/statusline/config.json` (override with `$STATUSLINE_CONFIG`):

```json
{
  "separator": " · ",
  "segments": ["machine", "project", "commit-age", "loc", "model-context", "context-remaining", "cost"]
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
renders each enabled segment, drops anything unavailable, and prints one line. Segments
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

Useful exports include `parseClaudeInput`, `renderLine`, `segments`, `getSegment`,
`defaultConfig`, `loadConfig`, `saveConfig`, `configPath`, `previewStatusline`,
`orderSegments`, `disableSegments`, `setSeparator`, and `installClaude`.

## MCP

`statusline-mcp` starts a stdio MCP server:

```bash
statusline-mcp
```

It exposes safe tools for `render_statusline`, `preview_statusline`,
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

`installClaude()` writes to `~/.claude/settings.json`:

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
| `version` | `version` |
| `output_style.name` | `outputStyle` |

Every field is optional — partial or empty payloads still produce a usable context.

### Codewith (not implemented)

`statusline install` only accepts `claude` today. Running
`statusline install codewith` errors with *unsupported target* (`src/cli.ts`).

The renderer is provider-agnostic: a future `parseCodewithInput` would map Codewith's
status payload into `StatusContext` (`src/providers/types.ts`) and reuse the same
segment registry. No install wiring exists yet (tracked in STA-00003).

### Cursor (not implemented)

Same gap as Codewith — no `statusline install cursor` subcommand and no Cursor-specific
parser. A future adapter would implement `parseCursorInput` → `StatusContext` and hook
into Cursor's status bar the same way Claude does (tracked in STA-00004).

### Other agents

| Agent | Status |
|-------|--------|
| OpenCode | ⏳ no statusline/footer hook in its config as of v1.3.x — the renderer is provider-agnostic (`src/providers/`), so an adapter slots in the moment one exists |
| Codex CLI | Codex ships its own built-in segment picker; no external command hook |

Adding a provider means one small parser: agent payload → `StatusContext`
(`src/providers/types.ts`). PRs welcome.

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
