# AGENTS.md

Guidance for AI agents working with connect-trustpilot-business.

## Overview

TypeScript CLI for Trustpilot Business API: service reviews, invitations, business unit search, and webhook subscriptions.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

- Public routes: `apikey` header with API key
- Private routes (`/private/*`): client credentials access token (requires API secret)

## Structure

```
src/api/       # HTTP client and resource modules
src/cli/       # Commander CLI
src/types/     # TypeScript types
src/utils/     # Config and output helpers
```

## Security

- No hardcoded credentials
- `.env.example` uses placeholders only
- Uses `@hasna` namespace
