# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-epo is a TypeScript connector for the EPO Open Patent Services (OPS) API. It provides a CLI and programmatic interface to search and retrieve European patent data including publications, patent families, legal status, and register information.

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

# Run specific commands
bun run dev search "ti=solar AND pa=tesla"
bun run dev publication biblio EP1000000
bun run dev family get EP1000000
bun run dev legal EP1000000
bun run dev register search "pa=siemens"
bun run dev classification get H01L
bun run dev profile list
bun run dev config show
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere
- Use interfaces for all API types

## Project Structure

```
src/
├── api/
│   ├── client.ts         # HTTP client with OAuth2 authentication
│   ├── publications.ts   # Published data search and retrieval
│   ├── family.ts         # Patent family (INPADOC) data
│   ├── legal.ts          # Legal status information
│   ├── register.ts       # EP Register data
│   ├── classification.ts # CPC classification
│   └── index.ts          # Main EPO class
├── cli/
│   └── index.ts          # CLI commands
├── types/
│   └── index.ts          # Type definitions
├── utils/
│   ├── config.ts         # Multi-profile configuration
│   └── output.ts         # CLI output formatting
└── index.ts              # Library exports
```

## API Modules

### Publications API (`/published-data`)
- Search published patents using CQL queries
- Get publication by document number
- Retrieve bibliographic data, abstracts, descriptions, claims
- Get images metadata

### Family API (`/family`)
- Get INPADOC patent family data
- Retrieve family with bibliographic data
- Get family with legal status

### Legal Status API (`/legal`)
- Get legal status events for a patent
- Track patent lifecycle (grant, expiry, opposition, etc.)

### Register API (`/register`)
- Search EP Register
- Get detailed register data for applications
- Retrieve procedural steps

### Classification API (`/classification/cpc`)
- Look up CPC classification symbols
- Get classification hierarchy with children/ancestors
- Search classifications by keyword

## Authentication

The EPO OPS API uses OAuth2 with client credentials grant:
- Register at https://developers.epo.org/ to get Consumer Key and Secret
- Token endpoint: https://ops.epo.org/3.2/auth/accesstoken
- Tokens are automatically cached and refreshed

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EPO_CONSUMER_KEY` | Consumer key from EPO developer portal (required) |
| `EPO_CONSUMER_SECRET` | Consumer secret from EPO developer portal (required) |
| `EPO_BASE_URL` | Override base URL (default: https://ops.epo.org/3.2/rest-services) |

## Data Storage

```
~/.connect/connect-epo/
├── current_profile   # Active profile name
├── token.json        # Cached OAuth token
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "consumerKey": "xxx",
  "consumerSecret": "xxx",
  "baseUrl": "optional-custom-url"
}
```

## CLI Usage

```bash
# Search patents
connect-epo search "ti=solar AND pa=tesla"
connect-epo search "pa=siemens" --range 1-50

# Get publication data
connect-epo publication get EP1000000
connect-epo publication biblio EP1000000
connect-epo publication abstract EP1000000
connect-epo publication claims EP1000000

# Get patent family
connect-epo family get EP1000000
connect-epo family biblio EP1000000

# Get legal status
connect-epo legal EP1000000

# Search EP Register
connect-epo register search "pa=nokia"
connect-epo register get EP1000000

# CPC Classification
connect-epo classification get H01L
connect-epo classification get H01L --children
connect-epo classification search "semiconductor"

# Authentication
connect-epo auth test
connect-epo auth clear-token

# Configuration
connect-epo config set-credentials <key> <secret>
connect-epo config show
connect-epo profile create work --consumer-key xxx --consumer-secret xxx --use
connect-epo profile list
```

## Programmatic Usage

```typescript
import { EPO } from '@hasna/connect-epo';

// Create client
const epo = new EPO({
  consumerKey: 'your-key',
  consumerSecret: 'your-secret',
});

// Search patents
const results = await epo.publications.search('ti=solar AND pa=tesla');

// Get bibliographic data
const biblio = await epo.publications.getBiblio('publication', 'epodoc', 'EP1000000');

// Get patent family
const family = await epo.family.getFamily('publication', 'epodoc', 'EP1000000');

// Get legal status
const legal = await epo.legal.getLegalStatus('publication', 'epodoc', 'EP1000000');

// Search EP Register
const registerResults = await epo.register.search('pa=siemens');

// Get CPC classification
const cpc = await epo.classification.getCPC('H01L');
```

## Document Reference Formats

- **docdb**: Country code + number + kind (e.g., EP1000000A1)
- **epodoc**: Simplified format (e.g., EP1000000)
- **original**: Original application number format

## CQL Query Syntax

Common search fields:
- `ti=` - Title
- `ab=` - Abstract
- `pa=` - Applicant
- `in=` - Inventor
- `pn=` - Publication number
- `ap=` - Application number
- `pr=` - Priority number
- `pd=` - Publication date
- `ic=` - IPC classification

Example queries:
- `ti=solar AND pa=tesla` - Solar patents by Tesla
- `pa=siemens AND pd>=2020` - Siemens patents from 2020+
- `ic=H01L AND ti=transistor` - Transistor patents in H01L class

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
