# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

`@hasna/connectors` is an open-source monorepo of TypeScript API connectors. It provides a CLI to install connectors into projects and a library of curated API integrations.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk, ink (for CLI)
- Type annotations required everywhere

## Project Structure

```
├── src/
│   ├── cli/           # Interactive CLI (Ink/React)
│   │   ├── components/
│   │   └── index.tsx
│   ├── lib/           # Core library
│   │   ├── installer.ts
│   │   └── registry.ts
│   └── index.ts       # Library exports
├── connectors/        # Individual connector packages
│   └── connect-*/     # Each connector
└── bin/               # Built CLI output
```

## Connector Blacklist

The following connectors should NOT be added to this open-source repository:

### Romanian Store Scrapers (browser-use based)
These are browser automation scrapers for Romanian e-commerce sites:
- connect-aboutyou, connect-altex, connect-answear
- connect-carrefour, connect-catena, connect-cel
- connect-dedeman, connect-drmax, connect-elefant
- connect-emag, connect-evomag, connect-farmaciatei
- connect-fashiondays, connect-flanco, connect-footshop
- connect-glovo, connect-helpnet, connect-ipb
- connect-kaufland, connect-leroymerlin, connect-lidl
- connect-mediagalaxy, connect-megaimage, connect-mytheresa
- connect-notino, connect-olx, connect-pcgarage
- connect-sensiblu, connect-tazz, connect-vivre

### Romanian Baby/Kids Store Scrapers
- connect-babyjohn, connect-jacadi, connect-jumbo
- connect-mashashop, connect-minikidi, connect-minikids
- connect-nichiduta, connect-noriel, connect-smyk

### Travel Scrapers (browser-use based)
- connect-googleflights, connect-kayak, connect-kiwi
- connect-ryanair, connect-skyscanner, connect-wizzair

### Other Blacklisted
- connect-clickbank (affiliate marketing platform)
- connect-escrow (financial/sensitive)
- connect-farfetch (browser scraper)
- connect-browseruse (wrapper, already have it)

## Adding New Connectors

When adding connectors from the dev folder:

1. Verify it's NOT in the blacklist above
2. Verify it uses real APIs (not browser-use scrapers)
3. Copy to `connectors/connect-{name}/`
4. Update `.npmrc` to use `@hasna` namespace
5. Remove any internal references (beepmedia, hasnaxyz, etc.)
6. Ensure no secrets or API keys are committed
7. Update `src/lib/registry.ts` to include the connector

## Environment Variables

Each connector has its own environment variables documented in its README.md and CLAUDE.md files.

## Data Storage

Connectors store configuration in `~/.connect/connect-{name}/`:
- `current_profile` - Active profile name
- `profiles/` - Profile JSON files

## Dependencies

- commander: CLI argument parsing
- chalk: Terminal styling
- ink: React-based interactive CLI
- ink-select-input: Selection component for Ink
