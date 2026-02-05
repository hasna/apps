# AGENTS.md

Guidance for AI agents working with this repository.

## Overview

This is `@hasna/connectors`, an open-source monorepo of TypeScript API connectors providing CLI installation and programmatic access to 80+ API integrations.

## Quick Commands

```bash
bun install          # Install dependencies
bun run dev          # Run CLI
bun run build        # Build
bun run typecheck    # Type check
```

## Connector Blacklist (DO NOT ADD)

### Browser-Use Scrapers
These use browser automation and should NOT be in the open-source repo:

**Romanian E-commerce:**
aboutyou, altex, answear, carrefour, catena, cel, dedeman, drmax, elefant, emag, evomag, farmaciatei, fashiondays, flanco, footshop, glovo, helpnet, ipb, kaufland, leroymerlin, lidl, mediagalaxy, megaimage, mytheresa, notino, olx, pcgarage, sensiblu, tazz, vivre

**Romanian Baby/Kids:**
babyjohn, jacadi, jumbo, mashashop, minikidi, minikids, nichiduta, noriel, smyk

**Travel Scrapers:**
googleflights, kayak, kiwi, ryanair, skyscanner, wizzair

**Other:**
clickbank, escrow, farfetch, browseruse (wrapper)

## Adding Connectors

1. Check blacklist first
2. Verify uses real API (check for browser-use dependency)
3. Copy to `connectors/connect-{name}/`
4. Update `.npmrc` to `@hasna` namespace
5. Remove internal references
6. Verify no secrets committed
7. Update registry in `src/lib/registry.ts`

## Structure

```
connectors/connect-{name}/
├── src/
│   ├── api/          # API client
│   ├── cli/          # CLI commands
│   ├── types/        # TypeScript types
│   └── utils/        # Config, output
├── package.json
├── CLAUDE.md
├── AGENTS.md
└── README.md
```

## Security Checks

Before committing any connector:
- [ ] No hardcoded API keys/tokens
- [ ] No internal references (beepmedia, hasnaxyz)
- [ ] Uses `@hasna` namespace
- [ ] .env.example has placeholders only
- [ ] .npmrc uses `${NPM_TOKEN}` variable
