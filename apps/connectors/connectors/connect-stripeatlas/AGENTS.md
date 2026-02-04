# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-stripeatlas is a TypeScript connector for Stripe Atlas. Since Stripe Atlas doesn't have a public API, this connector uses browser automation (Playwright) to interact with the Stripe Atlas dashboard.

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
- Profile configuration: `connect-stripeatlas config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/stripeatlas/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Stripe Atlas uses email/password authentication via browser:
- Credentials stored in profile config
- Browser automation logs in to dashboard
- Session managed by Playwright

### Browser Automation

Since Stripe Atlas has no public API, all interactions are done via browser automation:
1. Launch headless browser with Playwright
2. Navigate to atlas.stripe.com
3. Authenticate with email/password
4. Scrape or interact with dashboard elements

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_ATLAS_EMAIL` | Stripe Atlas account email |
| `STRIPE_ATLAS_PASSWORD` | Stripe Atlas account password |

## Data Storage

```
~/.connect/connect-stripeatlas/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
