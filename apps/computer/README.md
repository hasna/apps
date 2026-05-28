# @hasna/computer

Open-source computer use for AI agents. Control your Mac with Anthropic Claude or OpenAI.

**CLI + MCP Server + REST API + SDK**

## What it does

An AI model sees your screen (via screenshots) and controls your mouse and keyboard to complete tasks — like a remote human operator, but powered by AI.

```bash
# Tell the AI to do something on your Mac
computer run "open Safari and search for 'weather in NYC'"

# Take a screenshot
computer screenshot -o screen.png

# View past sessions
computer sessions
```

## Features

- **Multi-provider** — Anthropic (Claude computer use) or OpenAI (CUA)
- **macOS native** — Uses `screencapture` + `cliclick` for zero-dependency screen control
- **MCP server** — Other AI agents can use your computer as a tool
- **REST API** — Integrate from any language
- **Session logging** — Every action logged in SQLite, fully replayable
- **SDK** — Import and use programmatically in TypeScript/Bun

## Install

```bash
bun install -g @hasna/computer
```

**Prerequisites:**
- macOS (Apple Silicon or Intel)
- [Bun](https://bun.sh) runtime
- `cliclick` — `brew install cliclick`
- Accessibility permissions (System Settings > Privacy & Security > Accessibility)
- An API key: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`

## CLI

```bash
computer run <task>              # Run a computer use task
computer run <task> -p openai    # Use OpenAI instead of Anthropic
computer run <task> -s 30        # Limit to 30 steps
computer screenshot              # Capture current screen
computer sessions                # List past sessions
computer session <id>            # Show session details + action log
computer stats                   # Usage statistics
```

## MCP Server

Add to your Claude Code config:

```json
{
  "mcpServers": {
    "computer": {
      "command": "computer-mcp"
    }
  }
}
```

## HTTP mode

Shared Streamable HTTP transport for multi-agent sessions (stdio remains the default):

```bash
computer-mcp --http              # http://127.0.0.1:8806/mcp
MCP_HTTP=1 computer-mcp          # same via env
computer-mcp --http --port 9000    # override port
```

- Health: `GET http://127.0.0.1:8806/health` → `{"status":"ok","name":"computer"}`
- MCP endpoint is also mounted on `computer-serve` at `/mcp`.

**Available tools:**
- `computer_run_task` — Run a full computer use task
- `computer_screenshot` — Capture the screen
- `computer_click` — Click at coordinates
- `computer_type` — Type text
- `computer_key` — Press keys
- `computer_scroll` — Scroll
- `computer_mouse_move` — Move the mouse
- `computer_open_url` — Open a URL
- `computer_open_app` — Open an app
- `computer_screen_size` — Get screen resolution
- `computer_list_sessions` — List sessions
- `computer_get_session` — Get session details
- `computer_stats` — Usage stats

## REST API

```bash
computer-serve  # Starts on port 19450
```

```bash
# Run a task
curl -X POST localhost:19450/run -d '{"task":"open calculator"}'

# Take a screenshot
curl localhost:19450/screenshot

# Execute a single action
curl -X POST localhost:19450/action -d '{"type":"click","point":{"x":500,"y":300}}'

# List sessions
curl localhost:19450/sessions
```

## SDK

```typescript
import { runTask, captureScreenshot, createMacDriver } from "@hasna/computer";

// Run a full task
const session = await runTask({
  task: "open Notes and create a new note",
  provider: "anthropic",
  maxSteps: 20,
  onStep: (step, response, result) => {
    console.log(`Step ${step}: ${response.action?.type}`);
  },
});

// Or control manually
const driver = createMacDriver();
const screenshot = await driver.screenshot();
const result = await driver.execute({
  type: "click",
  point: { x: 500, y: 300 },
});
```

## How it works

1. Screenshots your screen
2. Sends the screenshot to the AI model (Claude or GPT)
3. The model analyzes what's on screen and returns an action (click, type, scroll, etc.)
4. The action is executed on your Mac
5. A new screenshot is taken
6. Repeat until the task is done (or max steps reached)

## Providers

| Provider | Model | Tool |
|----------|-------|------|
| Anthropic | Claude Sonnet 4.5 (default) | `computer_20250124` |
| OpenAI | `computer-use-preview` | CUA Responses API |

## Data

Sessions and action logs are stored in `~/.hasna/computer/computer.db` (SQLite).

## License

Apache-2.0
