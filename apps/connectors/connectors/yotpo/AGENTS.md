# AGENTS.md

Guidance for AI agents working with the Yotpo connector.

## Overview

TypeScript API connector for Yotpo reviews and UGC. Uses utoken auth via store ID + API secret.

## Security

- No hardcoded credentials
- `.env.example` has placeholders only
- Uses `@hasna` namespace

## Commands

```bash
bun install
bun run typecheck
bun run build
bun test
```
