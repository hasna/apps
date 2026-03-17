# connect-patentsview

A TypeScript connector for the USPTO PatentsView API. Search and analyze US patent data including patents, inventors, assignees, CPC classifications, and locations.

## Features

- Search patents by title, abstract, assignee, inventor, CPC classification
- Search inventors and assignees
- Browse CPC (Cooperative Patent Classification) hierarchy
- Location-based patent analytics
- Multi-profile configuration support
- Pretty and JSON output formats
- TypeScript with full type definitions

## Prerequisites

**API Key Required:** The PatentsView API requires an API key for authentication.

Get your free API key at: https://patentsview-support.atlassian.net/servicedesk/customer/portal/1/group/1/create/18

## Installation

```bash
# Install globally
bun install -g @hasna/connect-patentsview

# Or use directly
bunx @hasna/connect-patentsview
```

## Quick Start

```bash
# Configure your API key
connect-patentsview config set-key YOUR_API_KEY

# Search patents by title
connect-patentsview patents search --title "artificial intelligence"

# Get a specific patent
connect-patentsview patents get 10000000

# Search top assignees
connect-patentsview assignees top --limit 25

# Search inventors by name
connect-patentsview inventors search --name "Smith"

# Browse CPC classifications
connect-patentsview cpc sections
connect-patentsview cpc search --section G

# Get top patent locations
connect-patentsview locations top --us
```

## CLI Commands

### Patents

```bash
# Search patents
connect-patentsview patents search [options]
  --title <text>      Search by title
  --abstract <text>   Search by abstract
  --assignee <name>   Search by assignee organization
  --inventor <name>   Search by inventor last name
  --cpc <code>        Search by CPC classification
  --year <year>       Filter by year
  --from <date>       Start date (YYYY-MM-DD)
  --to <date>         End date (YYYY-MM-DD)
  --limit <n>         Number of results (default: 25)
  --page <n>          Page number (default: 1)

# Get single patent
connect-patentsview patents get <patentId>

# Get recent patents
connect-patentsview patents recent --limit 50

# Get most cited patents
connect-patentsview patents cited --limit 25
```

### Assignees

```bash
# Search assignees
connect-patentsview assignees search [options]
  --org <name>        Search by organization name
  --name <lastname>   Search by individual last name
  --country <code>    Filter by country
  --state <code>      Filter by state (US only)

# Get single assignee
connect-patentsview assignees get <assigneeId>

# Get top assignees by patent count
connect-patentsview assignees top --limit 25
```

### Inventors

```bash
# Search inventors
connect-patentsview inventors search [options]
  --name <lastname>   Search by last name
  --first <firstname> Filter by first name
  --country <code>    Filter by country
  --state <code>      Filter by state (US only)

# Get single inventor
connect-patentsview inventors get <inventorId>

# Get top inventors
connect-patentsview inventors top --limit 25

# Get prolific inventors (with many patents)
connect-patentsview inventors prolific --min 100
```

### CPC Classifications

```bash
# Search CPC subgroups
connect-patentsview cpc search [options]
  --title <text>      Search by title
  --section <id>      Filter by section (A-H, Y)
  --class <id>        Filter by class (e.g., G06)
  --subclass <id>     Filter by subclass (e.g., G06F)
  --group <id>        Filter by group (e.g., G06F3/00)
  --prefix <id>       Search by ID prefix

# Get single CPC subgroup
connect-patentsview cpc get <cpcId>

# List CPC sections
connect-patentsview cpc sections

# Get top CPC subgroups by patent count
connect-patentsview cpc top --limit 25
```

### Locations

```bash
# Search locations
connect-patentsview locations search [options]
  --country <code>    Filter by country
  --state <code>      Filter by state (US only)
  --city <name>       Search by city name

# Get top locations
connect-patentsview locations top [options]
  --us                US locations only
  --state <code>      Top cities in a specific US state
```

### Configuration

```bash
# Set API key
connect-patentsview config set-key YOUR_API_KEY

# Show configuration
connect-patentsview config show

# Manage profiles
connect-patentsview profile list
connect-patentsview profile create <name> [--api-key KEY] [--use]
connect-patentsview profile use <name>
connect-patentsview profile show [name]
connect-patentsview profile delete <name>
```

## Programmatic Usage

```typescript
import { PatentsView } from '@hasna/connect-patentsview';

// Create client with API key
const pv = new PatentsView({ apiKey: 'your-api-key' });

// Or from environment variable (PATENTSVIEW_API_KEY)
const pv = PatentsView.fromEnv();

// Search patents
const results = await pv.patents.searchByTitle('machine learning', {
  per_page: 25,
  sort: [{ patent_date: 'desc' }],
});

console.log(`Found ${results.total_hits} patents`);
results.patents.forEach(p => {
  console.log(`${p.patent_id}: ${p.patent_title}`);
});

// Get a specific patent
const patent = await pv.patents.get('10000000');

// Search assignees
const assignees = await pv.assignees.searchByOrganization('Microsoft');

// Get prolific inventors
const inventors = await pv.inventors.getProlific(200);

// Search CPC classifications
const cpc = await pv.cpc.searchBySection('H'); // Electricity

// Custom query with all options
const customSearch = await pv.patents.search(
  // Query filters
  {
    _and: [
      { patent_year: { _gte: 2020 } },
      { assignees: { assignee_organization: { _contains: 'IBM' } } },
    ],
  },
  // Fields to return
  ['patent_id', 'patent_title', 'patent_date', 'patent_num_cited_by_us_patents'],
  // Options
  {
    per_page: 100,
    page: 1,
    sort: [{ patent_num_cited_by_us_patents: 'desc' }],
  }
);
```

## API Reference

### Query Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `_eq` | Equals | `{ "patent_year": { "_eq": 2024 } }` |
| `_neq` | Not equals | `{ "patent_type": { "_neq": "design" } }` |
| `_gt` | Greater than | `{ "patent_num_claims": { "_gt": 10 } }` |
| `_gte` | Greater than or equal | `{ "patent_year": { "_gte": 2020 } }` |
| `_lt` | Less than | `{ "patent_year": { "_lt": 2000 } }` |
| `_lte` | Less than or equal | `{ "patent_num_claims": { "_lte": 5 } }` |
| `_begins` | Starts with | `{ "inventor_name_last": { "_begins": "Sm" } }` |
| `_contains` | Contains | `{ "assignee_organization": { "_contains": "Google" } }` |
| `_text_any` | Full-text (any word) | `{ "patent_title": { "_text_any": "AI machine learning" } }` |
| `_text_all` | Full-text (all words) | `{ "patent_abstract": { "_text_all": "neural network" } }` |
| `_text_phrase` | Full-text (exact phrase) | `{ "patent_title": { "_text_phrase": "deep learning" } }` |

### Logical Operators

```typescript
// AND - all conditions must match
{
  "_and": [
    { "patent_year": { "_gte": 2020 } },
    { "patent_type": { "_eq": "utility" } }
  ]
}

// OR - any condition must match
{
  "_or": [
    { "assignee_country": { "_eq": "US" } },
    { "assignee_country": { "_eq": "JP" } }
  ]
}

// NOT - negate a condition
{
  "_not": { "patent_type": { "_eq": "design" } }
}
```

### CPC Sections

| Section | Description |
|---------|-------------|
| A | Human Necessities |
| B | Performing Operations; Transporting |
| C | Chemistry; Metallurgy |
| D | Textiles; Paper |
| E | Fixed Constructions |
| F | Mechanical Engineering; Lighting; Heating; Weapons; Blasting |
| G | Physics |
| H | Electricity |
| Y | General Tagging of New Technological Developments |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PATENTSVIEW_API_KEY` | API key for authentication | Required |
| `PATENTSVIEW_BASE_URL` | Override API base URL | `https://search.patentsview.org/api/v1` |

## Data Storage

Configuration is stored in `~/.connect/connect-patentsview/`:

```
~/.connect/connect-patentsview/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── custom.json   # Custom profiles
```

## Rate Limits

The PatentsView API has a rate limit of **45 requests per minute** per API key.

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## API Documentation

- [PatentsView API Documentation](https://search.patentsview.org/docs)
- [PatentsView Data Dictionary](https://patentsview.org/download/data-download-dictionary)
- [Get API Key](https://patentsview-support.atlassian.net/servicedesk/customer/portal/1/group/1/create/18)

## License

MIT
