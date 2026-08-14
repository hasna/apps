# CLAUDE.md

Guidance for Claude Code when working with the Weights & Biases connector.

## Project Overview

connect-wandb is a TypeScript CLI and library for the Weights & Biases GraphQL API (`https://api.wandb.ai/graphql`). It provides viewer lookup, project run listing, and ad-hoc GraphQL queries with multi-profile support.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Project Structure

```
src/
├── api/
│   ├── client.ts     # GraphQL client with Bearer auth
│   ├── viewer.ts     # Viewer query
│   ├── projects.ts   # Project runs query
│   ├── graphql.ts    # Ad-hoc queries
│   └── index.ts      # Wandb facade
├── cli/index.ts
├── types/index.ts
├── utils/config.ts
└── utils/output.ts
```

## Authentication

Bearer Token authentication. Credentials via:
- `WANDB_API_KEY` environment variable
- Profile config: `wandb config set-key <key>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WANDB_API_KEY` | W&B API key |
| `WANDB_BASE_URL` | Custom GraphQL endpoint (default: `https://api.wandb.ai/graphql`) |

## Multi-Profile Configuration

Configuration stored in `~/.hasna/connectors/wandb/`:

```
~/.hasna/connectors/wandb/
├── current_profile
└── profiles/
    └── default.json
```

## GraphQL Endpoint

- Base URL: `https://api.wandb.ai/graphql`
- Auth: `Authorization: Bearer <api_key>`

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
