# AGENTS.md

Guidance for AI coding agents working with the Weights & Biases connector.

## Project Overview

connect-wandb is a TypeScript connector for the W&B GraphQL API with multi-profile configuration, Bearer token authentication, and Commander.js CLI.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer Token authentication via `WANDB_API_KEY` or `wandb config set-key <key>`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WANDB_API_KEY` | API key (overrides profile) |
| `WANDB_BASE_URL` | Override GraphQL base URL |

## Data Storage

```
~/.hasna/connectors/wandb/
├── current_profile
└── profiles/
    └── default.json
```

## Key Patterns

- `WandbClient` handles GraphQL POST with Bearer auth and error handling
- `Wandb` facade exposes `viewer`, `projects`, and `graphql` APIs
- Run filters use JSON-stringified MongoDB-style syntax per W&B API
