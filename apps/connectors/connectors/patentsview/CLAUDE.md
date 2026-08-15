# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-patentsview is a TypeScript connector for the USPTO PatentsView API. It provides a CLI and programmatic interface to search and analyze patent data, including patents, inventors, assignees, CPC classifications, and locations.

**API Key Required:** The PatentsView API requires an API key for authentication. Get one at: https://patentsview-support.atlassian.net/servicedesk/customer/portal/1/group/1/create/18

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

# Configure API key
bun run dev config set-key YOUR_API_KEY

# Run specific commands
bun run dev patents search --title "machine learning"
bun run dev patents get 10000000
bun run dev inventors search --name "Smith"
bun run dev assignees search --org "Google"
bun run dev cpc search --section G
bun run dev locations top --us
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
│   ├── client.ts      # HTTP client with X-Api-Key auth
│   ├── patents.ts     # Patents search and retrieval
│   ├── assignees.ts   # Assignee search and retrieval
│   ├── inventors.ts   # Inventor search and retrieval
│   ├── cpc.ts         # CPC classification search
│   ├── locations.ts   # Location search
│   └── index.ts       # Main PatentsView class
├── cli/
│   └── index.ts       # CLI commands
├── types/
│   └── index.ts       # Type definitions
├── utils/
│   ├── config.ts      # Multi-profile configuration
│   └── output.ts      # CLI output formatting
└── index.ts           # Library exports
```

## API Modules

### Patents API (`/patent/`)
- Search patents with various filters
- Get single patent by ID
- Search by title, abstract, assignee, inventor, CPC
- Filter by date range or year
- Get recent or most cited patents

### Assignees API (`/assignee/`)
- Search assignees (patent owners)
- Get by organization name or individual name
- Filter by location (country, state, city)
- Get top assignees by patent count

### Inventors API (`/inventor/`)
- Search inventors
- Get by name
- Filter by location
- Get prolific inventors
- Get top inventors by patent count

### CPC API (`/cpc_subgroup/`)
- Search CPC classifications
- Search by section, class, subclass, or group
- Search by title text
- Get top CPC categories by patent count

### Locations API (`/location/`)
- Search locations
- Filter by country, state, city
- Get top locations by patent count
- Get top US cities

## Query Format

The PatentsView API uses JSON queries with:
- `q`: Query object with filters (e.g., `{ "patent_title": { "_contains": "AI" } }`)
- `f`: Fields to return (array of field names)
- `o`: Options (pagination, sorting)

### Query Operators

| Operator | Description |
|----------|-------------|
| `_eq` | Equals |
| `_neq` | Not equals |
| `_gt` / `_gte` | Greater than / Greater than or equal |
| `_lt` / `_lte` | Less than / Less than or equal |
| `_begins` | Starts with |
| `_contains` | Contains |
| `_text_any` | Full-text search (any word) |
| `_text_all` | Full-text search (all words) |
| `_text_phrase` | Full-text search (exact phrase) |

### Logical Operators

- `_and`: Array of conditions (all must match)
- `_or`: Array of conditions (any must match)
- `_not`: Negate a condition

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PATENTSVIEW_API_KEY` | API key for authentication (required) |
| `PATENTSVIEW_BASE_URL` | Override base URL (default: https://search.patentsview.org/api/v1) |

## Data Storage

```
~/.hasna/connectors/connect-patentsview/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "your-api-key",
  "baseUrl": "optional-custom-url"
}
```

## CLI Usage

```bash
# Configure API key first
connect-patentsview config set-key YOUR_API_KEY

# Search patents
connect-patentsview patents search --title "machine learning"
connect-patentsview patents search --assignee "Google"
connect-patentsview patents search --inventor "Smith"
connect-patentsview patents search --cpc "G06F3/01"
connect-patentsview patents search --year 2024
connect-patentsview patents search --from 2023-01-01 --to 2023-12-31

# Get specific patent
connect-patentsview patents get 10000000

# Get recent/cited patents
connect-patentsview patents recent --limit 50
connect-patentsview patents cited --limit 25

# Search assignees
connect-patentsview assignees search --org "Apple"
connect-patentsview assignees search --country US --state CA
connect-patentsview assignees top --limit 25
connect-patentsview assignees get <assignee_id>

# Search inventors
connect-patentsview inventors search --name "Wang" --first "Wei"
connect-patentsview inventors search --country JP
connect-patentsview inventors top --limit 25
connect-patentsview inventors prolific --min 200
connect-patentsview inventors get <inventor_id>

# Search CPC classifications
connect-patentsview cpc search --title "neural network"
connect-patentsview cpc search --section G
connect-patentsview cpc search --class G06
connect-patentsview cpc search --subclass G06F
connect-patentsview cpc sections
connect-patentsview cpc top --limit 25
connect-patentsview cpc get G06F3/01

# Search locations
connect-patentsview locations search --country US
connect-patentsview locations search --state CA
connect-patentsview locations search --city "San Francisco"
connect-patentsview locations top --us
connect-patentsview locations top --state CA

# Configuration
connect-patentsview config set-key YOUR_API_KEY
connect-patentsview config show
connect-patentsview profile create research --api-key KEY --use
connect-patentsview profile list
```

## Programmatic Usage

```typescript
import { PatentsView } from '@hasnaxyz/connect-patentsview';

// Create client with API key
const patentsview = new PatentsView({ apiKey: 'your-api-key' });

// Or from environment variable
const patentsview = PatentsView.fromEnv(); // Uses PATENTSVIEW_API_KEY

// Search patents
const patents = await patentsview.patents.searchByTitle('machine learning', {
  per_page: 25,
  page: 1,
});

// Get a specific patent
const patent = await patentsview.patents.get('10000000');

// Search assignees
const assignees = await patentsview.assignees.searchByOrganization('Google');

// Get top inventors
const inventors = await patentsview.inventors.getTopByPatentCount(25);

// Search CPC by section
const cpc = await patentsview.cpc.searchBySection('G', { per_page: 50 });

// Get top US cities
const locations = await patentsview.locations.getTopUSCities(25);

// Custom query
const results = await patentsview.patents.search(
  { patent_year: { _gte: 2020 }, assignees: { assignee_organization: { _contains: 'IBM' } } },
  ['patent_id', 'patent_title', 'patent_date'],
  { per_page: 100, sort: [{ patent_date: 'desc' }] }
);
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
