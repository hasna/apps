# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-mailchimp is a TypeScript connector for the Mailchimp Marketing API v3.0. It provides CLI and library access to manage audiences, members, campaigns, templates, tags, segments, and reports.

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
bun run dev account info
bun run dev list ls
bun run dev member ls <listId>
bun run dev campaign ls
bun run dev config show
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Basic auth
│   └── index.ts      # Mailchimp API wrapper class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Coverage

### Account
- Get account information
- Ping/health check

### Lists/Audiences
- List, get, create, update, delete audiences

### Members
- List, get, add, update members
- Archive/delete members
- Manage member tags

### Campaigns
- List, get, create, update, delete campaigns
- Send, schedule, unschedule campaigns
- Pause, resume, replicate campaigns
- Get/set campaign content

### Templates
- List, get, create, update, delete templates
- Get template content

### Tags
- List tags for audience
- Get/update member tags

### Segments
- List, get, create, update, delete segments

### Reports
- List campaign reports
- Get detailed report
- Click details, open details, unsubscribes

## Authentication

Uses Basic auth with API key (data center extracted from key):
```typescript
// API key format: abc123def456-us1
// Data center is the suffix after the dash
'Authorization': `Basic ${base64('anystring:' + apiKey)}`
```

Base URL is constructed from data center:
```
https://{dc}.api.mailchimp.com/3.0
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MAILCHIMP_API_KEY` | API key (overrides profile) |
| `MAILCHIMP_SERVER_PREFIX` | Override server prefix/data center |

## Data Storage

```
~/.connect/connect-mailchimp/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
