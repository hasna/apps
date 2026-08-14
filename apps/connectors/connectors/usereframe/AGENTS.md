# AGENTS.md

Guidance for AI agents working with the Reframe (UserReframe) connector.

## Overview

Bearer-authenticated REST client for Reframe procurement workflows: BOMs, parts search, supplier quotes, purchase orders, shipments, and assistant messages.

## Auth

- `USEREFRAME_API_KEY` (required)
- `USEREFRAME_BASE_URL` (optional, default `https://api.usereframe.ai/v1`)
- Profiles: `~/.hasna/connectors/connect-usereframe/profiles/`

## Structure

```
src/api/       # client + resource modules
src/cli/       # connect-usereframe CLI
src/types/     # config and error types
src/utils/     # config + output helpers
```

## Validation

```bash
cd connectors/usereframe && bun install && bun run typecheck && bun run build && bun test
```
