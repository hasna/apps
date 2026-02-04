# connect-reducto

Reducto API connector - Document parsing, extraction, and manipulation

## Installation

```bash
bun install -g @hasna/connect-reducto
```

## Quick Start

```bash
# Set your API key
connect-reducto config set-key YOUR_API_KEY

# Or use environment variable
export REDUCTO_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Authentication
```bash
connect-reducto auth setup --api-key <key>
connect-reducto auth logout
connect-reducto auth status
```

### Parse Documents
```bash
connect-reducto parse url <documentUrl>
connect-reducto parse url <url> --chunking section --extract-tables
connect-reducto parse file ./document.pdf
connect-reducto parse file ./doc.pdf --output-mode markdown --page-range 1-5
```

### Extract Structured Data
```bash
connect-reducto extract url <documentUrl> --schema schema.json
connect-reducto extract file ./invoice.pdf --schema invoice-schema.json
connect-reducto extract file ./doc.pdf --schema schema.json --examples examples.json
```

### Split Documents
```bash
connect-reducto split url <documentUrl>
connect-reducto split file ./document.pdf --split-by page
connect-reducto split file ./doc.pdf --max-size 1000 --overlap 100
```

### Edit Documents
```bash
connect-reducto edit url <documentUrl> --edits edits.json
connect-reducto edit file ./form.pdf --edits form-data.json --flatten
connect-reducto edit file ./doc.pdf --edits edits.json --output-format pdf
```

### Jobs Management
```bash
connect-reducto jobs list
connect-reducto jobs get <jobId>
connect-reducto jobs cancel <jobId>
```

### Documents Management
```bash
connect-reducto docs list
connect-reducto docs get <documentId>
connect-reducto docs delete <documentId>
```

### Profiles
```bash
connect-reducto profile list
connect-reducto profile create <name>
connect-reducto profile use <name>
connect-reducto profile delete <name>
```

## Profile Management

```bash
# Create profiles for different accounts
connect-reducto profile create work --api-key xxx --use
connect-reducto profile create personal --api-key yyy

# Switch profiles
connect-reducto profile use work

# Use profile for single command
connect-reducto -p personal <command>

# List profiles
connect-reducto profile list
```

## Library Usage

```typescript
import { Reducto } from '@hasna/connect-reducto';

const client = new Reducto({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REDUCTO_API_KEY` | API key (overrides profile) |

## Data Storage

Configuration stored in `~/.connect/connect-reducto/`:

```
~/.connect/connect-reducto/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

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

## License

MIT
