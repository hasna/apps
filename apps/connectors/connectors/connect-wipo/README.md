# connect-wipo

WIPO (World Intellectual Property Organization) API connector CLI and SDK with browser automation.

## Features

- **Patentscope** - PCT international patent application search (100M+ documents)
- **Madrid System** - International trademark registrations (Madrid Monitor)
- **WIPO Pearl** - Multilingual patent terminology and concept search
- **Browser Automation** - Playwright-based automation for web features
- **Multi-profile Support** - Switch between different configurations

## Quick Start

```bash
# Install globally
bun install -g @hasna/connect-wipo

# Or run locally
bun run dev --help

# Search PCT applications
connect-wipo patentscope search "machine learning"

# Search international trademarks
connect-wipo madrid search --mark "APPLE"

# Search terminology
connect-wipo pearl search "semiconductor"

# Browser automation (requires Playwright)
bunx playwright install chromium
connect-wipo browser patentscope "AI technology"
```

## Installation

```bash
# Install package
bun add @hasna/connect-wipo

# Install Playwright browsers for automation features
bunx playwright install chromium
```

## CLI Commands

### Patentscope (PCT Applications)

```bash
connect-wipo patentscope search <query>              # Search PCT applications
connect-wipo patentscope get <applicationNumber>     # Get by PCT number
connect-wipo patentscope publication <woNumber>      # Get by WO number
connect-wipo patentscope documents <applicationNum>  # List documents
connect-wipo patentscope family <applicationNum>     # Get family members
connect-wipo patentscope by-applicant <name>         # Search by applicant
connect-wipo patentscope by-inventor <name>          # Search by inventor
connect-wipo patentscope recent                      # Recent applications
```

### Madrid System (International Trademarks)

```bash
connect-wipo madrid search                           # Search with options
connect-wipo madrid get <registrationNumber>         # Get by IRN
connect-wipo madrid status <registrationNumber>      # Get status
connect-wipo madrid documents <registrationNumber>   # List documents
connect-wipo madrid check <mark>                     # Check availability
connect-wipo madrid by-holder <name>                 # Search by holder
connect-wipo madrid by-country <code>                # Search by country
connect-wipo madrid expiring                         # Marks expiring soon
```

### WIPO Pearl (Terminology)

```bash
connect-wipo pearl search <term>                     # Search terms
connect-wipo pearl translate <term> -s en -t de,fr   # Translate term
connect-wipo pearl concept <conceptId>               # Get concept
connect-wipo pearl concepts <query>                  # Search concepts
connect-wipo pearl synonyms <term> -l en             # Find synonyms
connect-wipo pearl languages                         # List languages
connect-wipo pearl domains                           # List domains
```

### Browser Automation

```bash
connect-wipo browser patentscope <query>             # Search Patentscope
connect-wipo browser madrid <markName>               # Search Madrid Monitor
connect-wipo browser global-brand <query>            # Search Global Brand DB
connect-wipo browser download-pct <num> <output>     # Download PCT doc
connect-wipo browser download-trademark-image <irn> <output>
connect-wipo browser check-trademark <mark>          # Check via browser
```

### Configuration

```bash
connect-wipo config set-key <apiKey>                 # Set API key (optional)
connect-wipo config set-headless true|false          # Browser visibility
connect-wipo config set-browser chromium             # chromium|firefox|webkit
connect-wipo config show                             # Show config
connect-wipo profile list                            # List profiles
connect-wipo profile create <name>                   # Create profile
connect-wipo profile use <name>                      # Switch profile
```

## SDK Usage

```typescript
import { WIPO } from '@hasna/connect-wipo';

// Create client
const wipo = new WIPO({ headless: true });

// Search PCT applications
const pct = await wipo.patentscope.search({
  query: 'artificial intelligence',
  rows: 25
});

// Get specific PCT application
const app = await wipo.patentscope.getByApplicationNumber('PCT/US2024/123456');

// Search international trademarks
const marks = await wipo.madrid.search({
  markName: 'APPLE',
  status: 'active'
});

// Check trademark availability
const { available, conflicts } = await wipo.madrid.checkAvailability('MY BRAND');

// Search terminology
const terms = await wipo.pearl.searchTerms({
  term: 'semiconductor',
  sourceLanguage: 'en'
});

// Translate a term
const translation = await wipo.pearl.translate('patent', 'en', ['de', 'fr']);

// Browser automation - Patentscope search
const results = await wipo.browser.searchPatentscope({
  query: 'TECH',
  searchType: 'simple',
});

// Download PCT document
await wipo.browser.downloadPCTDocument('PCT/US2024/123456', './doc.pdf');

// Always close when done
await wipo.close();
```

## API Modules

- `wipo.patentscope` - PCT application search, documents, family
- `wipo.madrid` - International trademark search, status, documents
- `wipo.pearl` - Terminology search, translation, concepts
- `wipo.browser` - Playwright automation for web features

## Configuration

Configuration stored in `~/.connect/connect-wipo/`:

```
~/.connect/connect-wipo/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `WIPO_API_KEY` | API key (optional for most operations) |
| `WIPO_HEADLESS` | Browser headless mode (default: true) |
| `WIPO_BROWSER` | Browser: chromium, firefox, webkit |

## Development

```bash
bun install          # Install dependencies
bun run typecheck    # Type check
bun run build        # Build for production
bun run dev          # Run CLI in development mode
```

## Output Formats

Use `-f json` for JSON output:

```bash
connect-wipo patentscope search "AI" -f json | jq '.applications[0].title'
```

## Notes

- Most WIPO APIs don't require authentication
- Browser automation requires Playwright browsers
- Patentscope contains 100M+ patent documents
- Madrid System covers international trademark registrations
- WIPO Pearl provides multilingual patent terminology
