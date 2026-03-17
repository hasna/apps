# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-slack is a TypeScript CLI and library for Slack's API. It provides channel management, messaging, and user operations with multi-profile support for managing multiple workspaces.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Async/await for all async operations
- Minimal dependencies: commander, chalk

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth
│   ├── channels.ts   # Channels/Conversations API
│   ├── messages.ts   # Messages API
│   ├── users.ts      # Users API
│   └── index.ts      # Main Slack class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # TypeScript types
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Bot token (xoxb-...) |
| `SLACK_USER_TOKEN` | User token (xoxp-...) |
| `SLACK_TEAM_ID` | Team/workspace ID |

## Multi-Profile Configuration

Configuration stored in `~/.connect/connect-slack/`:

```
~/.connect/connect-slack/
├── current_profile
└── profiles/
    └── default/
        ├── config.json
        └── tokens.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
