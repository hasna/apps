# open-terminal

**Your AI agent finally understands terminal output.**

[![npm](https://img.shields.io/npm/v/@hasna/terminal)](https://www.npmjs.com/package/@hasna/terminal)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-78%20passing-brightgreen)]()

Smart terminal wrapper that saves AI agents **73-90% of tokens** on command output. Instead of dumping raw bash into context, it compresses, structures, and summarizes intelligently.

Also a natural language terminal for humans — type English, get shell commands.

## The Problem

AI coding agents waste massive tokens on terminal output:

```
Agent runs: npm test
Output: 200 lines of passing tests + 2 failures
Tokens wasted: ~2,000 (agent only needed the 2 failures)

Agent runs: find . -name "*.ts"
Output: 500 lines including node_modules
Tokens wasted: ~4,000 (agent needed ~20 source files)
```

**open-terminal fixes this.** Every command goes through a smart pipeline:

```
Raw output (2,000 tokens)
  → Noise filter (strip npm fund, progress bars)
  → Command rewriter (git log → --oneline -20)
  → AI summarization (Cerebras, $0.001/call)
  → Structured output (JSON, not text)
Result: 200 tokens (90% saved)
```

## How It Compares

| Feature | Raw Bash | RTK | open-terminal |
|---------|----------|-----|---------------|
| Output compression | None | Regex stripping | AI-powered summarization |
| Structured data | No | No | JSON parsers for git, test, build, errors |
| Diff caching | No | No | Only shows what changed between runs |
| Command optimization | No | No | Auto-rewrites suboptimal commands |
| Semantic search | No | No | AST-powered code navigation |
| Smart display | No | No | Groups paths, collapses patterns |
| Progressive disclosure | No | No | Summary first, expand on demand |
| MCP tools | 0 | 0 | 20+ tools |
| NL terminal | No | No | Speak English, get shell commands |
| Token tracking | No | No | Full economy dashboard with ROI |

**RTK compresses. open-terminal comprehends.**

## Install

```bash
npm install -g @hasna/terminal
```

## Quick Start

### For AI Agents

```bash
# Smart execution — the primary interface for agents
terminal exec "npm test"              # AI-summarized, noise-stripped
terminal exec "find . -name '*.ts'"   # auto-filtered, lazy if >100 results
terminal exec "git log"               # auto-rewritten to --oneline -20
terminal exec "npm ls"                # auto-rewritten to --depth=0

# Useful CLI commands
terminal repo                         # git status + diff + log in one call
terminal symbols src/app.ts           # file outline (functions, classes, exports)
terminal --help                       # full feature list
```

### For AI Agents (MCP Server)

```bash
# Install MCP server for your agent
terminal mcp install --claude    # Claude Code
terminal mcp install --codex     # OpenAI Codex
terminal mcp install --gemini    # Gemini CLI

# Or start manually
terminal mcp serve
```

### For Humans (NL Terminal)

```bash
# Set API key
export CEREBRAS_API_KEY=your_key   # free, open-source (default)
# or
export ANTHROPIC_API_KEY=your_key  # Claude

# Launch
terminal
```

Type in plain English: "list all typescript files" → `find . -name '*.ts'`

## Benchmarks

Real commands tested on a TypeScript monorepo:

| Command | Raw Tokens | Compressed | Saved |
|---------|-----------|------------|-------|
| `ls -laR src/` (budget 150) | 1,051 | 164 | **84%** |
| `grep export` (overflow guard) | 3,852 | 764 | **80%** |
| `find *.png` (smart display) | 800 | 82 | **90%** |
| `bun test` (2nd run, diff) | 423 | 10 | **98%** |
| `find . -type f` (AI summary) | 2,017 | 94 | **95%** |
| `npm install` (structured) | 49 | 9 | **82%** |
| **Total (10 commands)** | **13,067** | **3,495** | **73%** |

**ROI:** AI summarization costs $0.001 per call (Cerebras). Saves $0.029 in Claude Sonnet tokens. **21x return.**

At scale: 500 commands/day = **$41/month saved** per agent.

## MCP Tools (20+)

### Execution
| Tool | Description |
|------|-------------|
| `execute` | Run command with structured output, compression, or AI summary |
| `execute_smart` | AI-summarized output with progressive disclosure |
| `execute_diff` | Only return what changed since last run |
| `expand` | Retrieve full output from a previous execute_smart call |

### Search
| Tool | Description |
|------|-------------|
| `search_files` | Find files by pattern, auto-filter node_modules |
| `search_content` | Smart grep with file grouping and overflow guard |
| `search_semantic` | AST-powered search — find functions/classes by meaning |
| `read_file` | Cached file reading with offset/limit pagination |
| `read_symbol` | Read a specific function by name (88% vs whole file) |
| `symbols` | File structure outline with line numbers |
| `browse` | Structured directory listing |

### Git & Process Management
| Tool | Description |
|------|-------------|
| `repo_state` | Branch + status + staged/unstaged + recent commits (one call) |
| `explain_error` | Structured error diagnosis with fix suggestions |
| `bg_start` / `bg_stop` / `bg_status` | Background process management |
| `bg_wait_port` / `bg_logs` | Wait for port ready, tail process output |

### Recipes & State
| Tool | Description |
|------|-------------|
| `list_recipes` / `run_recipe` / `save_recipe` | Reusable command templates |
| `snapshot` | Capture terminal state for agent handoff |
| `token_stats` | Token savings dashboard |
| `session_history` | Query past session data |

## Smart Pipeline

Every command through `terminal exec` goes through:

1. **Command Rewriting** — auto-optimizes before execution
   - `find . | grep -v node_modules` → `find . -not -path '*/node_modules/*'`
   - `cat file | grep X` → `grep X file`
   - `git log` → `git log --oneline -20`
   - `npm ls` → `npm ls --depth=0`

2. **Noise Stripping** — removes zero-value output
   - npm fund warnings, progress bars, gyp noise, blank line runs

3. **Lazy Execution** — large results return count + sample
   - `>100 lines → {count: 500, sample: [first 20], categories: {src: 300, test: 150}}`

4. **AI Summarization** — Cerebras qwen-3-235b ($0.001/call)
   - Keeps: errors, failures, warnings, key results
   - Drops: passing tests, verbose logs, progress output

5. **Diff Caching** — identical/similar re-runs return diff only
   - Exact match: "unchanged" (98% savings)
   - >80% similar: diff-only format

6. **Structured Parsing** — JSON instead of text
   - Git status/log, test results, build output, npm install, errors

## CLI Commands

```
terminal                        Launch NL terminal (TUI)
terminal exec <command>         Smart execution with full pipeline
terminal repo                   Git repo state in one call
terminal symbols <file>         File outline (functions, classes, exports)
terminal stats                  Token economy dashboard
terminal sessions               List recent sessions
terminal sessions stats         Session analytics
terminal recipe add/list/run    Reusable command recipes
terminal collection create/list Recipe collections
terminal snapshot               Terminal state as JSON
terminal mcp serve              Start MCP server
terminal mcp install --claude   Install for Claude Code
terminal --help                 Full help
terminal --version              Version
```

## Configuration

```bash
# API key (pick one)
export CEREBRAS_API_KEY=your_key   # default, free tier available
export ANTHROPIC_API_KEY=your_key  # Claude models
```

Config at `~/.terminal/config.json`, sessions at `~/.terminal/sessions.db`, recipes at `~/.terminal/recipes.json`.

## Architecture

```
┌──────────────────────────────────────────────┐
│              open-terminal                    │
│                                              │
│  ┌────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Human  │  │ terminal │  │ MCP Server  │ │
│  │ TUI    │  │ exec     │  │ (20+ tools) │ │
│  └───┬────┘  └────┬─────┘  └──────┬──────┘ │
│      └────────────┼────────────────┘        │
│                   ▼                          │
│  ┌──────────────────────────────────────┐   │
│  │         Smart Pipeline               │   │
│  │  Rewrite → Noise → Lazy → AI → Diff │   │
│  └──────────────────┬───────────────────┘   │
│                     ▼                        │
│  ┌──────────────────────────────────────┐   │
│  │  Shell (zsh/bash)                    │   │
│  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

Apache 2.0 — Copyright 2026 Hasna, Inc.
