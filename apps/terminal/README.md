# open-terminal

Smart terminal wrapper for AI agents and humans. Speak plain English or let agents execute commands with structured output, token compression, and massive context savings.

## Why?

AI agents waste tokens on terminal interaction. Every `npm test` dumps hundreds of lines into context. Every `find` returns noise. `open-terminal` sits between callers and the shell, making every interaction dramatically more efficient.

**For agents:** MCP server with structured output, token compression, diff-aware caching, smart search, process supervision. Cut token usage 50-90% on verbose commands.

**For humans:** Natural language terminal powered by Cerebras (free, open-source) or Anthropic. Type "count typescript files" instead of `find . -name '*.ts' | wc -l`.

## Install

```bash
npm install -g @hasna/terminal
```

## Quick Start

### For Humans (TUI Mode)

```bash
# Set your API key (pick one)
export CEREBRAS_API_KEY=your_key  # free, open-source (default)
export ANTHROPIC_API_KEY=your_key # Claude

# Launch
t
```

Type in plain English. The terminal translates, shows you the command, and runs it.

### For AI Agents (MCP Server)

```bash
# Install for your agent
t mcp install --claude   # Claude Code
t mcp install --codex    # OpenAI Codex
t mcp install --gemini   # Gemini CLI
t mcp install --all      # All agents

# Or start manually
t mcp serve
```

## MCP Tools

| Tool | Description | Token Savings |
|------|-------------|---------------|
| `execute` | Run command with structured output, compression, or AI summary | 50-90% |
| `execute_diff` | Run command, return only what changed since last run | 80-95% |
| `browse` | List files as structured JSON, auto-filter node_modules | 60-80% |
| `search_files` | Find files by pattern, categorized (source/config/other) | 70-90% |
| `search_content` | Grep with grouping by file and relevance ranking | 60-80% |
| `explain_error` | Structured error diagnosis with fix suggestions | N/A |
| `bg_start` | Start background process with port auto-detection | N/A |
| `bg_status` | List managed processes with health info | N/A |
| `bg_wait_port` | Wait for a port to be ready | N/A |
| `bg_stop` / `bg_logs` | Stop process / get recent output | N/A |
| `list_recipes` / `run_recipe` / `save_recipe` | Reusable command templates | N/A |
| `snapshot` | Capture terminal state for agent handoff | N/A |
| `token_stats` | Token economy dashboard | N/A |

### Example: Structured Output

```
Agent: execute("npm test", {format: "json"})

→ {"passed": 142, "failed": 2, "failures": [{"test": "auth.test.ts:45", "error": "expected 200 got 401"}]}
  (saved 847 tokens vs raw output)
```

### Example: Diff Mode

```
Agent: execute_diff("npm test")  # first run → full output
Agent: execute_diff("npm test")  # second run → only changes

→ {"diffSummary": "+1 new line, -1 removed", "added": ["PASS auth.test.ts:45"], "removed": ["FAIL auth.test.ts:45"], "tokensSaved": 892}
```

### Example: Smart Search

```
Agent: search_files("*hooks*")

→ {"source": ["src/lib/webhooks.ts", "src/hooks/useAuth.ts"], "filtered": [{"count": 47, "reason": "node_modules"}], "tokensSaved": 312}
```

## Recipes

Reusable command templates with variable substitution:

```bash
# Save a recipe
t recipe add kill-port "lsof -i :{port} -t | xargs kill"

# Run it
t recipe run kill-port --port=3000

# List recipes
t recipe list

# Project-scoped recipes
t project init
t recipe add dev-start "npm run dev" --project

# Collections
t collection create docker "Docker commands"
t recipe add docker-build "docker build -t {tag} ." --collection=docker
```

## Token Economy

Track how many tokens you've saved:

```bash
t stats
```

```
Token Economy:
  Total saved:  124.5K
  By feature:
    Structured: 45.2K
    Compressed: 32.1K
    Diff cache: 28.7K
    Search:     18.5K
```

## TUI Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `ctrl+t` | New tab |
| `tab` | Switch tabs |
| `ctrl+w` | Close tab |
| `ctrl+b` | Browse mode (file navigator) |
| `ctrl+r` | Fuzzy history search |
| `ctrl+l` | Clear scrollback |
| `ctrl+c` | Cancel / exit |
| `?` | Explain command before running |
| `e` | Edit translated command |
| `→` | Accept ghost text suggestion |

## Configuration

Config stored at `~/.terminal/config.json`:

```json
{
  "provider": "cerebras",
  "permissions": {
    "destructive": true,
    "network": true,
    "sudo": false,
    "install": true,
    "write_outside_cwd": false
  }
}
```

## Architecture

```
┌──────────────────────────────────────────┐
│            open-terminal                  │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Human    │  │ MCP      │  │ CLI    │ │
│  │ TUI      │  │ Server   │  │ Tools  │ │
│  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       └──────────┬───┘────────────┘      │
│   ┌──────────────────────────────────┐   │
│   │  Output Intelligence Router      │   │
│   │  Parsers → Compression → Diff    │   │
│   └──────────────┬───────────────────┘   │
│   ┌──────────────────────────────────┐   │
│   │  Shell (zsh/bash)                │   │
│   └──────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

## License

MIT
