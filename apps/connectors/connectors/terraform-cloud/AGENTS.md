# AGENTS.md

Guidance for AI agents working with the Terraform Cloud connector.

## Overview

TypeScript connector for HashiCorp Terraform Cloud JSON:API v2 with multi-profile CLI support.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via `TERRAFORM_CLOUD_TOKEN` or `connect-terraform-cloud config set-token <token>`.

Config path: `~/.hasna/connectors/connect-terraform-cloud/`

## Structure

- `src/api/client.ts` — JSON:API transport (Bearer + `application/vnd.api+json`)
- `src/api/index.ts` — Resource methods (orgs, workspaces, runs, vars, state, config versions, teams, projects, policy sets)
- `src/cli/index.ts` — Commander CLI
- `src/utils/config.ts` — Multi-profile storage

## Security

- No hardcoded tokens
- `.env.example` uses placeholders only
- No browser-use or scraper dependencies
