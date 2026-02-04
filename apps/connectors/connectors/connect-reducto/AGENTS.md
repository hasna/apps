# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-reducto is a TypeScript connector for Reducto API. It provides CLI and programmatic access to parse, extract, split, and edit documents with API key authentication.

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
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-reducto config set-key <key>`


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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REDUCTO_API_KEY` | API key (overrides profile) |

## Data Storage

```
~/.connect/connect-reducto/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
