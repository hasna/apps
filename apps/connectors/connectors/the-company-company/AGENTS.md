# AGENTS.md

Guidance for AI agents working with the The Company Company connector.

## Overview

`@hasna/connect-the-company-company` is a bearer-token REST connector for the Company Company business agent platform.

## Security

- Never commit API keys or secrets
- Use `.env.example` placeholders only
- Profiles stored at `~/.hasna/connectors/connect-the-company-company/`

## Commands

```bash
bun install
bun run typecheck
bun run build
bun test src/api/client.test.ts
```
