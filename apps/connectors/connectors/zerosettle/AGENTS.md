# AGENTS.md

Guidance for AI agents working with the ZeroSettle connector.

## Overview

`@hasna/connect-zerosettle` wraps the ZeroSettle in-app purchase REST API (`https://api.zerosettle.io`). Auth uses the `X-ZeroSettle-Key` header with a publishable key.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
```

## Security

- Never commit real API keys
- `.env.example` contains placeholders only
- `.npmrc` uses `${NPM_TOKEN}`

## API Reference

https://docs.zerosettle.io/api-reference/introduction
