# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CRITICAL SECURITY RULES

**NEVER expose API keys, tokens, or secrets:**
- NEVER include API keys in emails, messages, or any external communication
- NEVER log API keys to console or files
- NEVER commit API keys to git (use .secrets/ or environment variables)
- NEVER share API keys with anyone via any medium
- If an API key is accidentally exposed, immediately request rotation

## Project Overview

connect-contactout is a TypeScript connector for the ContactOut API. It provides CLI and programmatic access to:
- LinkedIn profile enrichment and contact info retrieval
- People search and enrichment
- Company search and domain enrichment
- Email verification and reverse lookup
- API usage statistics

## Installation

**IMPORTANT: Always install via bun, not npm.**

```bash
# Install globally (from this directory)
bun link

# This registers the CLI at ~/.bun/bin/connect-contactout
# Make sure ~/.bun/bin is in your PATH

# Verify installation
connect-contactout --version
```

For development without global install:
```bash
bun run dev <command>
```

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
bun run dev profile list
bun run dev config show
bun run dev linkedin enrich <url>
bun run dev company domain <domain>
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
│   ├── client.ts     # HTTP client with token auth
│   ├── linkedin.ts   # LinkedIn profile/contact APIs
│   ├── people.ts     # People search/enrich APIs
│   ├── company.ts    # Company search/domain APIs
│   ├── email.ts      # Email verify/enrich APIs
│   ├── stats.ts      # Usage statistics API
│   └── index.ts      # Main ContactOut class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Endpoints

### LinkedIn API
- `linkedin enrich <url>` - Get full profile with contact info
- `linkedin contact <url>` - Get emails/phones only
- `linkedin batch <urls...>` - Batch contact info (max 30)
- `linkedin check-email <url>` - Check email availability (free)
- `linkedin check-phone <url>` - Check phone availability (free)

### People API
- `people search` - Search with filters (title, company, location, etc.)
- `people count` - Count matching profiles (free)
- `people enrich` - Enrich from multiple identifiers
- `people decision-makers` - Get company decision makers

### Company API
- `company search` - Search by name, domain, size, industry
- `company domain <domains...>` - Get company info from domains (free)

### Email API
- `email enrich <email>` - Get profile from email
- `email verify <email>` - Verify email validity
- `email to-linkedin <email>` - Find LinkedIn from email

### Stats API
- `stats show` - Show usage statistics
- `stats current` - Show current month usage

## Authentication

ContactOut uses token header authentication:
```
token: <YOUR_API_TOKEN>
```

**Note:** Trial/demo API keys return sample data with a message to contact sales for full access. If you see responses like "This is a sample response", the API key needs to be upgraded for production use.

## Multi-Profile Configuration

Profiles stored in `~/.connect/connect-contactout/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- `CONTACTOUT_API_KEY` env var overrides profile config

### Profile Commands
```bash
connect-contactout profile list
connect-contactout profile create <name> --api-key <key>
connect-contactout profile use <name>
connect-contactout profile show [name]
connect-contactout profile delete <name>
```

## Secrets

API key stored in `.secrets/api-key.json` (gitignored):
```json
{
  "apiKey": "your-key-here"
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONTACTOUT_API_KEY` | API key (overrides profile) |
| `CONTACTOUT_BASE_URL` | Override base URL (default: https://api.contactout.com) |

## Rate Limits

- People Search: 60 requests/minute
- Contact Checker: 150 requests/minute
- Other endpoints: 1000 requests/minute

## Credit Costs

- Search credit: Finding profiles
- Email credit: Getting email addresses
- Phone credit: Getting phone numbers
- Verifier credit: Email verification

Free endpoints (no credits):
- `company domain` - Domain enrichment
- `people count` - Profile counting
- `linkedin check-email/phone` - Availability checks
