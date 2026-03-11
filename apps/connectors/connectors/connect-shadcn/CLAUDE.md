# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-shadcn is a TypeScript wrapper for the shadcn CLI. It provides programmatic access to shadcn commands with multi-profile configuration support.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## CLI v4 (Mar 2026) — Major Update

shadcn CLI v4 released March 2026. Key new features:

### New Inspection Flags
```bash
npx shadcn@latest add button --dry-run   # preview without writing
npx shadcn@latest add button --diff      # show diff vs local changes
npx shadcn@latest add button --view      # inspect registry payload
```

### Presets — Design System Codes
Pack entire design system (colors, theme, icons, fonts, radius) into a short code:
```bash
npx shadcn@latest init --preset a1Dg5eFl   # scaffold with preset
```

### shadcn/skills — Agent Context
Gives AI coding agents context for working with components:
```bash
npx skills add shadcn/ui
```

### New shadcn info command
```bash
npx shadcn@latest info   # framework, version, installed components, docs links
```

### shadcn docs command
```bash
npx shadcn@latest docs combobox   # get docs, code, examples for any component
```

### shadcn init Templates (--template, --monorepo, --base)
```bash
npx shadcn@latest init -t next --monorepo   # next.js monorepo
npx shadcn@latest init --base radix          # choose Radix or Base UI primitives
```

### registry:base and registry:font
Registries can now distribute entire design systems and fonts as first-class types.

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-shadcn config set-key <key>`


## Key Patterns

### CLI Execution

The connector executes shadcn commands using child_process:
```typescript
spawn('npx', ['shadcn@latest', ...args], {
  cwd: this.cwd,
  env: { ...process.env, CI: 'true' },
});
```

### Multi-Profile Configuration

Profiles stored in `~/.connectors/connect-shadcn/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- `--cwd` flag overrides working directory

### Available Commands

- `add [components...]` - Add components to project
- `diff [component]` - Show diff against registry
- `init` - Initialize shadcn/ui
- `list` - List available components
- `exec <args...>` - Execute raw shadcn CLI command

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CI` | Set to 'true' automatically for non-interactive mode |

## Data Storage

```
~/.connectors/connect-shadcn/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
