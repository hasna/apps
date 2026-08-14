# AGENTS.md

Guidance for AI agents working with `@hasna/connect-trustpilot`.

## Overview

Trustpilot Business API connector with dual auth (API key for public reads, OAuth bearer for private endpoints).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Structure

```
connectors/trustpilot/
├── src/
│   ├── api/
│   │   ├── client.ts
│   │   ├── categories.ts
│   │   ├── business-units.ts
│   │   ├── reviews.ts
│   │   ├── invitations.ts
│   │   ├── products.ts
│   │   ├── consumers.ts
│   │   ├── tags.ts
│   │   ├── oauth.ts
│   │   └── index.ts
│   ├── cli/index.ts
│   ├── types/index.ts
│   └── utils/{config,output}.ts
├── package.json
└── CLAUDE.md
```

## Security

- No hardcoded API keys or tokens
- No internal org references
- No browser-use / scraper dependency
- `.env.example` uses placeholders only

## Auth Pattern

Public endpoints: `auth: 'apikey'` → `apikey` header
Private endpoints: default `auth: 'private'` → Bearer token, API key fallback
