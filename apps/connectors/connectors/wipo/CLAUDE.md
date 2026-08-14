# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-wipo is a TypeScript connector for WIPO (World Intellectual Property Organization) APIs with browser automation support via Playwright. It provides both API integration and browser automation for features not available through APIs.

### API Features
- **Patentscope** - PCT (Patent Cooperation Treaty) international patent application search
- **Madrid System** - International trademark registrations (Madrid Monitor)
- **WIPO Pearl** - Multilingual patent terminology and concept search

### Browser Automation (Playwright)
- **Patentscope Web** - PCT application search via browser
- **Madrid Monitor** - International trademark search via browser
- **Global Brand Database** - Trademark, appellation, and emblem search
- **Document Downloads** - Download PCT documents and trademark images

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
bun run dev patentscope search "machine learning"
bun run dev madrid search --mark "APPLE"
bun run dev pearl search "semiconductor"
bun run dev browser patentscope "AI technology"
bun run dev profile list
bun run dev config show
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk, playwright
- Type annotations required everywhere
- Use interfaces for all API types

## Project Structure

```
src/
├── api/
│   ├── client.ts       # HTTP client for WIPO APIs
│   ├── patentscope.ts  # Patentscope API (PCT applications)
│   ├── madrid.ts       # Madrid System API (international trademarks)
│   ├── pearl.ts        # WIPO Pearl API (terminology)
│   ├── browser.ts      # Playwright browser automation
│   └── index.ts        # Main WIPO class
├── cli/
│   └── index.ts        # CLI commands
├── types/
│   └── index.ts        # Type definitions
├── utils/
│   ├── config.ts       # Multi-profile configuration
│   └── output.ts       # CLI output formatting
└── index.ts            # Library exports
```

## API Endpoints

| Endpoint | Base URL | Purpose |
|----------|----------|---------|
| Patentscope | https://patentscope.wipo.int/search/api | PCT application search |
| Patentscope WS | https://patentscope.wipo.int/wapps/ws | Web services |
| Madrid | https://www3.wipo.int/madrid/monitor/api | Madrid trademark system |
| Madrid Gazette | https://www.wipo.int/madrid/gazette/api | Gazette publications |
| WIPO Pearl | https://wipopearl.wipo.int/api/v1 | Terminology database |
| Global Brand | https://www3.wipo.int/branddb/api | Global brand database |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WIPO_API_KEY` | API key (optional for most APIs) |
| `WIPO_TOKEN` | Alternative API key variable |
| `WIPO_HEADLESS` | Run browser in headless mode (default: true) |
| `WIPO_BROWSER` | Browser to use: chromium, firefox, webkit |
| `WIPO_OUTPUT_DIR` | Output directory for downloads |

## Data Storage

```
~/.hasna/connectors/connect-wipo/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "optional-key",
  "headless": true,
  "browser": "chromium",
  "outputDir": "./output"
}
```

## CLI Usage

```bash
# Patentscope operations (PCT applications)
connect-wipo patentscope search "artificial intelligence"
connect-wipo patentscope get PCT/US2024/123456
connect-wipo patentscope publication WO/2024/123456
connect-wipo patentscope documents PCT/US2024/123456
connect-wipo patentscope family PCT/US2024/123456
connect-wipo patentscope by-applicant "Google LLC"
connect-wipo patentscope by-inventor "John Smith"
connect-wipo patentscope recent

# Madrid System operations (international trademarks)
connect-wipo madrid search --mark "APPLE"
connect-wipo madrid get 1234567
connect-wipo madrid status 1234567
connect-wipo madrid documents 1234567
connect-wipo madrid check "MY BRAND"
connect-wipo madrid by-holder "Apple Inc"
connect-wipo madrid by-country US
connect-wipo madrid expiring --days 90

# WIPO Pearl operations (terminology)
connect-wipo pearl search "semiconductor"
connect-wipo pearl translate "patent" --source en --target de,fr,zh
connect-wipo pearl concept C12345
connect-wipo pearl concepts "machine learning"
connect-wipo pearl synonyms "patent" --language en
connect-wipo pearl languages
connect-wipo pearl domains

# Browser automation
connect-wipo browser patentscope "drone technology"
connect-wipo browser madrid "TECH BRAND"
connect-wipo browser global-brand "BRAND NAME"
connect-wipo browser download-pct PCT/US2024/123456 ./document.pdf
connect-wipo browser download-trademark-image 1234567 ./trademark.png
connect-wipo browser check-trademark "MY BRAND NAME"

# Configuration
connect-wipo config set-key your-api-key
connect-wipo config set-headless true
connect-wipo config set-browser chromium
connect-wipo config show
connect-wipo profile create work --api-key xxx --use
connect-wipo profile list
```

## Programmatic Usage

```typescript
import { WIPO } from '@hasnaxyz/connect-wipo';

// Create client (API key optional for most operations)
const wipo = new WIPO({ headless: true });

// Or from environment
const wipo = WIPO.fromEnv();

// Search PCT applications
const pctResults = await wipo.patentscope.search({
  query: 'machine learning',
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

// Get mark status
const status = await wipo.madrid.getStatus('1234567');

// Search terminology
const terms = await wipo.pearl.searchTerms({
  term: 'semiconductor',
  sourceLanguage: 'en',
  targetLanguages: ['de', 'fr', 'zh']
});

// Translate a term
const translation = await wipo.pearl.translate('patent', 'en', ['de', 'fr']);

// Browser automation - Patentscope search
const browserResults = await wipo.browser.searchPatentscope({
  query: 'TECH BRAND',
  searchType: 'simple',
});

// Check trademark via browser
const browserCheck = await wipo.browser.checkTrademarkAvailability('MY BRAND');

// Download PCT document
await wipo.browser.downloadPCTDocument('PCT/US2024/123456', './document.pdf');

// Always close browser resources when done
await wipo.close();
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
- playwright: Browser automation

## Notes

- Most WIPO APIs don't require authentication for read operations
- Browser automation requires Playwright browsers to be installed (`bunx playwright install chromium`)
- Patentscope contains 100M+ patent documents from PCT and national collections
- Madrid System covers international trademark registrations under the Madrid Protocol
- WIPO Pearl provides multilingual patent terminology across major languages
