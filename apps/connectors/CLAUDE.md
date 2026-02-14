# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

`@hasna/connectors` is an open-source monorepo of 63 TypeScript API connectors. It provides:

- **CLI** (`connectors`) — Install, search, list, and manage connectors
- **Dashboard** (`connectors serve`) — Local web dashboard (shadcn/ui) for auth management
- **MCP Server** (`connectors-mcp`) — Model Context Protocol server for AI agents
- **Library** — Programmatic API for importing connectors into TypeScript projects

## Build & Run Commands

```bash
# Install dependencies
bun install

# Install dashboard dependencies
cd dashboard && bun install && cd ..

# Run CLI in development
bun run dev

# Build everything (dashboard + CLI + MCP + serve)
bun run build

# Build dashboard only
bun run build:dashboard

# Type check
bun run typecheck

# Run tests
bun test

# Publish to npm
npm publish
```

## CLI Commands

### Interactive Mode

```bash
connectors              # Interactive connector browser (TTY only)
connectors i            # Alias
```

### Install & Remove

```bash
connectors install <names...>        # Install one or more connectors
connectors install figma stripe      # Example
connectors install figma --overwrite # Overwrite existing
connectors install figma --json      # JSON output
connectors add <names...>           # Alias for install

connectors remove <name>            # Remove installed connector
connectors rm <name>                # Alias for remove
```

### Browse & Search

```bash
connectors list                     # List all 63 connectors
connectors list --installed         # List only installed connectors
connectors list --category "AI & ML" # Filter by category
connectors list --json              # JSON output
connectors ls                       # Alias for list

connectors search <query>           # Search by name, description, or tags
connectors search payment --json    # JSON output

connectors categories               # List all categories with counts
connectors categories --json        # JSON output
```

### Connector Details

```bash
connectors info <name>              # Show connector metadata
connectors info stripe --json       # JSON output

connectors docs <name>              # Show connector documentation (auth, env vars, API)
connectors docs gmail --json        # Structured JSON output
connectors docs gmail --raw         # Raw CLAUDE.md markdown
```

### Dashboard (Auth Management)

```bash
connectors serve                    # Start dashboard at http://localhost:19426
connectors serve --port 3000        # Custom port
connectors serve --no-open          # Don't open browser
connectors dashboard                # Alias for serve
connectors open                     # Start dashboard and open browser
```

The dashboard provides:
- All 63 connectors with installed/not-installed status
- Auth status detection (OAuth, API Key, Bearer Token)
- API key configuration via dialog
- OAuth flow for Google connectors (Gmail, Calendar, Drive, etc.)
- Token refresh and expiry monitoring
- Light/dark theme toggle
- Data table with sorting, filtering, pagination (10/page)
- Copy-to-clipboard install commands for not-installed connectors

### MCP Server

```bash
connectors-mcp                      # Start MCP server on stdio
```

MCP Tools available:
- `search_connectors` — Search by name, keyword, or description
- `list_connectors` — List all or by category
- `connector_docs` — Get auth, env vars, CLI commands for a connector
- `connector_info` — Get metadata and install status
- `install_connector` — Install connectors
- `remove_connector` — Remove connectors
- `list_installed` — List installed connectors
- `connector_auth_status` — Check auth status (type, configured, token expiry)

### Standalone Dashboard

```bash
connectors-serve                    # Start dashboard server (standalone binary)
connectors-serve --port 3000        # Custom port
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
│   ├── cli/              # Interactive CLI (Ink/React)
│   │   ├── components/
│   │   └── index.tsx
│   ├── lib/              # Core library
│   │   ├── installer.ts  # Install/remove connectors
│   │   └── registry.ts   # 63 connector definitions
│   ├── mcp/              # MCP server for AI agents
│   │   └── index.ts
│   ├── server/           # Dashboard server
│   │   ├── auth.ts       # Auth detection, token management
│   │   ├── dashboard.ts  # Legacy HTML template (unused)
│   │   ├── index.ts      # Standalone entry point
│   │   └── serve.ts      # HTTP server + API routes
│   └── index.ts          # Library exports
├── dashboard/            # React frontend (Vite + shadcn/ui)
│   ├── src/
│   │   ├── components/   # shadcn/ui + app components
│   │   ├── app.tsx       # Main dashboard app
│   │   └── main.tsx      # React entry point
│   └── dist/             # Built dashboard (served by server)
├── connectors/           # Individual connector packages
│   └── connect-*/        # Each connector (63 total)
└── bin/                  # Built CLI output
    ├── index.js          # CLI binary
    ├── mcp.js            # MCP server binary
    └── serve.js          # Dashboard server binary
```

## Dashboard API Routes

The dashboard server (port 19426) exposes:

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | GET | Dashboard UI |
| `/api/connectors` | GET | All connectors with auth status |
| `/api/connectors/:name` | GET | Single connector details |
| `/api/connectors/:name/key` | POST | Save API key (`{ key, field? }`) |
| `/api/connectors/:name/refresh` | POST | Refresh OAuth token |
| `/oauth/:name/start` | GET | Start OAuth flow (redirects) |
| `/oauth/:name/callback` | GET | OAuth callback handler |

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

## Auth & Data Storage

Connectors store configuration in `~/.connect/connect-{name}/`:
- `current_profile` — Active profile name
- `credentials.json` — OAuth client credentials (shared across profiles)
- `profiles/` — Profile JSON files with API keys and tokens

## Publishing

```bash
# Bump version in package.json
# Build everything
bun run build

# Publish
npm publish
```

The npm package includes `bin/`, `dist/`, `dashboard/dist/`, and `connectors/`.

## Dependencies

- commander: CLI argument parsing
- chalk: Terminal styling
- ink: React-based interactive CLI
- ink-select-input: Selection component for Ink
- @modelcontextprotocol/sdk: MCP server
- zod: Schema validation (MCP)
- Dashboard: React 19, Tailwind CSS v4, shadcn/ui, @tanstack/react-table, Radix UI
