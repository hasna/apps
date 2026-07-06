# AGENTS.md

## Overview

connect-tumblr — Tumblr API v2 connector with OAuth2 and CLI.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Structure

```
src/
├── api/       # client, users, blogs, posts, tags
├── cli/       # Commander CLI
├── types/
└── utils/     # config, auth, output
```

## Auth

OAuth2 bearer tokens. CLI: `connect-tumblr auth login`.

## Security

- No hardcoded secrets
- `.env.example` has placeholders only
- `@hasna` namespace
