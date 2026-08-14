# Contributing to open-terminal

Thanks for your interest in contributing! open-terminal is an open-source smart terminal wrapper that saves AI agents 73-90% of tokens on terminal output.

## Development Setup

```bash
git clone https://github.com/hasna/terminal.git
cd terminal
npm install
npm run build    # TypeScript compilation
bun test         # Run tests
```

## Architecture

```
src/
  cli.tsx              # CLI entry point (TUI + subcommands)
  ai.ts                # NL translation (Cerebras/Anthropic providers)
  compression.ts       # Token compression engine
  noise-filter.ts      # Strip noise (npm fund, progress bars, etc.)
  command-rewriter.ts   # Auto-optimize commands before execution
  output-processor.ts  # AI-powered output summarization
  diff-cache.ts        # Diff-aware output caching
  smart-display.ts     # Visual output compression for TUI
  file-cache.ts        # Session file read cache
  lazy-executor.ts     # Lazy execution for large results
  expand-store.ts      # Progressive disclosure store
  economy.ts           # Token savings tracker
  sessions-db.ts       # SQLite session tracking
  supervisor.ts        # Background process manager
  snapshots.ts         # Session state snapshots
  tree.ts              # Tree compression for file listings
  mcp/
    server.ts          # MCP server (20+ tools)
    install.ts         # MCP installer for Claude/Codex/Gemini
  providers/
    base.ts            # LLM provider interface
    anthropic.ts       # Anthropic provider
    cerebras.ts        # Cerebras provider (default)
  parsers/             # Structured output parsers
  search/              # Smart search (file, content, semantic)
  recipes/             # Reusable command templates
```

## How to Contribute

### Adding a new parser
Parsers detect and structure specific command output types. See `src/parsers/` for examples. Each parser needs:
- `detect(command, output)` — returns true if this parser can handle the output
- `parse(command, output)` — returns structured data

### Adding a command rewrite rule
See `src/command-rewriter.ts`. Add a pattern + rewrite function to the `rules` array.

### Adding an MCP tool
See `src/mcp/server.ts`. Register with `server.tool(name, description, schema, handler)`.

## Running Tests

```bash
bun test                    # All tests
bun test src/parsers/       # Parser tests only
bun test --coverage         # With coverage
```

## Commit Convention

We use conventional commits:
- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructuring
- `test:` — adding tests
- `docs:` — documentation
- `chore:` — maintenance

## License

Apache 2.0 — Copyright 2026 Hasna, Inc.
