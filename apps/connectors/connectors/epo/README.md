# connect-epo

A TypeScript connector for the EPO Open Patent Services (OPS) API. Search and retrieve European patent data including publications, patent families, legal status, and register information.

## Features

- OAuth2 authentication with automatic token refresh
- Multi-profile configuration (switch between different API credentials)
- Full EPO OPS API coverage:
  - Published data search and retrieval
  - Patent family (INPADOC) data
  - Legal status information
  - EP Register access
  - CPC classification lookup
- Clean CLI with JSON/pretty output
- TypeScript with full type definitions

## Installation

```bash
# Install globally
bun install -g @hasna/connect-epo

# Or use with npx
npx @hasna/connect-epo
```

## Quick Start

### 1. Get EPO Credentials

Register at [EPO Developer Portal](https://developers.epo.org/) to get your Consumer Key and Secret.

### 2. Configure Credentials

```bash
connect-epo config set-credentials <consumer-key> <consumer-secret>
```

Or set environment variables:
```bash
export EPO_CONSUMER_KEY=your-key
export EPO_CONSUMER_SECRET=your-secret
```

### 3. Search Patents

```bash
# Search by title and applicant
connect-epo search "ti=solar AND pa=tesla"

# Get publication data
connect-epo publication biblio EP1000000

# Get patent family
connect-epo family get EP1000000
```

## CLI Usage

### Search

```bash
# Search published patents using CQL query
connect-epo search "ti=electric vehicle"
connect-epo search "pa=siemens AND pd>=2020" --range 1-50
```

### Publications

```bash
# Get publication by number
connect-epo publication get EP1000000

# Get specific data
connect-epo pub biblio EP1000000
connect-epo pub abstract EP1000000
connect-epo pub claims EP1000000
connect-epo pub description EP1000000
connect-epo pub images EP1000000
```

### Patent Family

```bash
# Get INPADOC family
connect-epo family get EP1000000

# With bibliographic data
connect-epo family biblio EP1000000

# With legal status
connect-epo family legal EP1000000
```

### Legal Status

```bash
connect-epo legal EP1000000
```

### EP Register

```bash
# Search register
connect-epo register search "pa=nokia"

# Get register data
connect-epo register get EP1000000

# Get procedural steps
connect-epo register steps EP1000000
```

### CPC Classification

```bash
# Look up classification
connect-epo classification get H01L

# With children
connect-epo class get H01L --children

# Search by keyword
connect-epo class search "semiconductor"
```

### Configuration

```bash
# Set credentials
connect-epo config set-credentials <key> <secret>

# Show current config
connect-epo config show

# Test authentication
connect-epo auth test

# Manage profiles
connect-epo profile create work --consumer-key xxx --consumer-secret xxx --use
connect-epo profile list
connect-epo profile use work
```

## Programmatic Usage

```typescript
import { EPO } from '@hasna/connect-epo';

// Create client
const epo = new EPO({
  consumerKey: 'your-key',
  consumerSecret: 'your-secret',
});

// Or from environment
const epo = EPO.fromEnv();

// Search patents
const results = await epo.publications.search('ti=solar', {
  rangeBegin: 1,
  rangeEnd: 25,
});

// Get bibliographic data
const biblio = await epo.publications.getBiblio('publication', 'epodoc', 'EP1000000');

// Get patent family
const family = await epo.family.getFamily('publication', 'epodoc', 'EP1000000');

// Get legal status
const legal = await epo.legal.getLegalStatus('publication', 'epodoc', 'EP1000000');

// Search EP Register
const register = await epo.register.search('pa=siemens');

// Get CPC classification
const cpc = await epo.classification.getCPC('H01L');
```

## CQL Query Syntax

The EPO OPS API uses CQL (Contextual Query Language) for searches.

### Common Fields

| Field | Description | Example |
|-------|-------------|---------|
| `ti` | Title | `ti=solar cell` |
| `ab` | Abstract | `ab=semiconductor` |
| `pa` | Applicant | `pa=tesla` |
| `in` | Inventor | `in=musk` |
| `pn` | Publication number | `pn=EP1000000` |
| `ap` | Application number | `ap=EP99123456` |
| `pr` | Priority number | `pr=US2019123456` |
| `pd` | Publication date | `pd=2020` or `pd>=20200101` |
| `ic` | IPC classification | `ic=H01L` |
| `cpc` | CPC classification | `cpc=H01L21` |

### Operators

- `AND` - Both conditions must match
- `OR` - Either condition matches
- `NOT` - Exclude matches
- `=` - Equals
- `>=`, `<=` - Date comparisons

### Examples

```bash
# Solar patents by Tesla
connect-epo search "ti=solar AND pa=tesla"

# Electric vehicle patents since 2020
connect-epo search "ti=electric vehicle AND pd>=2020"

# Patents in semiconductor classification
connect-epo search "ic=H01L AND ti=transistor"
```

## Document Reference Formats

- **epodoc**: Simplified format (e.g., `EP1000000`) - recommended
- **docdb**: Full format with kind code (e.g., `EP.1000000.A1`)
- **original**: Original application format

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EPO_CONSUMER_KEY` | Consumer key from EPO developer portal |
| `EPO_CONSUMER_SECRET` | Consumer secret from EPO developer portal |
| `EPO_BASE_URL` | Override API base URL (optional) |

## Data Storage

Configuration and tokens are stored in `~/.hasna/connectors/connect-epo/`:

```
~/.hasna/connectors/connect-epo/
├── current_profile   # Active profile name
├── token.json        # Cached OAuth token
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## API Rate Limits

The EPO OPS API has usage limits based on your subscription:
- Anonymous: 25 requests/week
- Registered: Varies by plan

See [EPO OPS documentation](https://www.epo.org/searching-for-patents/data/web-services/ops.html) for details.

## License

Apache-2.0
