# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-googledocs is a TypeScript connector for Google Docs API v1. It provides a CLI and programmatic interface for creating, reading, and editing Google Docs documents.

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

OAuth authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-googledocs config set-key <key>`
- OAuth flow: `connect-googledocs oauth login`

## API Modules

### documents (DocumentsApi)
- `get(documentId)` - Get document content
- `create(title)` - Create new document
- `batchUpdate(documentId, requests)` - Apply batch updates

### content (ContentApi)
- `insertText(documentId, text, index)` - Insert at position
- `appendText(documentId, text)` - Append to end
- `deleteRange(documentId, startIndex, endIndex)` - Delete content
- `replaceText(documentId, find, replace)` - Find and replace
- `insertImage(documentId, uri, index)` - Insert image
- `appendImage(documentId, uri)` - Append image
- `insertPageBreak(documentId, index)` - Insert page break
- `insertTable(documentId, rows, columns, index)` - Insert table

### styles (StylesApi)
- `updateTextStyle(documentId, range, style, fields)` - Apply text style
- `updateParagraphStyle(documentId, range, style, fields)` - Apply paragraph style
- `setBold/setItalic/setUnderline/setStrikethrough` - Text formatting
- `setFontSize/setFontFamily` - Font settings
- `setTextColor/setHighlightColor` - Colors
- `setLink` - Add hyperlinks
- `setAlignment/setLineSpacing/setSpacing` - Paragraph formatting
- `setNamedStyle` - Apply heading styles

## CLI Commands

```bash
# Document operations
connect-googledocs get <documentId>           # Get document content
connect-googledocs create <title>             # Create new document
connect-googledocs append <documentId> <text> # Append text
connect-googledocs replace <documentId> <find> <replace>  # Find/replace
connect-googledocs insert <documentId> <text> <index>     # Insert at position
connect-googledocs delete-range <documentId> <start> <end> # Delete range
connect-googledocs insert-image <documentId> <uri> <index> # Insert image

# Configuration
connect-googledocs config set-token <token>   # Set OAuth token
connect-googledocs config set-key <key>       # Set API key
connect-googledocs config show                # Show config
connect-googledocs config clear               # Clear config

# Profiles
connect-googledocs profile list               # List profiles
connect-googledocs profile use <name>         # Switch profile
connect-googledocs profile create <name>      # Create profile
connect-googledocs profile delete <name>      # Delete profile
connect-googledocs profile show [name]        # Show profile config
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_ACCESS_TOKEN` | OAuth2 access token (full access) |
| `GOOGLE_API_KEY` | API key (read-only) |

## Data Storage

```
~/.connect/connect-googledocs/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
