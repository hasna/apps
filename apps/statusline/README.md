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

`statusline list` shows everything available:

```
  [x] machine            Machine hostname (short)
  [x] project            Project name with current Git branch
  [ ] project-name       Project name (omitted when unavailable)
  [ ] git-branch         Current Git branch (omitted when unavailable)
  [x] commit-age         Time since last commit (compact)
  [x] loc                Lines of code tracked by Git (compact)
  [ ] current-dir        Current working directory (basename)
  [ ] model              Current model name
  [x] model-context      Model name with context-size tag (e.g. [1m])
  [ ] context-used       Percentage of context window used (omitted when unknown)
  [x] context-remaining  Percentage of context window remaining (omitted when unknown)
  [ ] used-tokens        Total tokens in the context window (omitted when unknown)
  [x] cost               Session cost in USD (omitted when zero)
  [ ] duration           Session wall-clock duration
  [ ] lines-changed      Lines added/removed this session (omitted when zero)
  [ ] output-style       Active output style (omitted when default)
  [ ] agent-version      Host agent version (e.g. Claude Code version)
  [ ] session-id         Session identifier (short)
```

## Usage

```bash
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

| Agent | Status |
|-------|--------|
| Claude Code | ✅ `statusline install claude` |
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

## License

[Apache-2.0](LICENSE)
