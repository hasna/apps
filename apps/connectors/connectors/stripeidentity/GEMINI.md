# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-stripeidentity is a TypeScript CLI for interacting with the Stripe Identity API. It provides multi-profile configuration, Bearer token authentication, and a clean CLI structure using Commander.js. It wraps the two public Identity resources: VerificationSessions and VerificationReports.

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

# Run tests
bun test
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
├── api/                        # API client modules
│   ├── client.ts               # HTTP client with authentication
│   ├── verification-sessions.ts# VerificationSessions endpoints
│   ├── verification-reports.ts # VerificationReports endpoints
│   └── index.ts                # Main connector class
├── cli/
│   └── index.ts                # CLI commands
├── types/
│   └── index.ts                # TypeScript types
├── utils/
│   ├── config.ts               # Multi-profile configuration
│   └── output.ts               # CLI output formatting
└── index.ts                    # Library exports
```

## Authentication

Bearer Token authentication using a Stripe secret key. Credentials can be set via:
- Environment variable `STRIPE_IDENTITY_API_KEY`
- Profile configuration: `connect-stripeidentity config set-key <key>`

Organization keys (`sk_org_*`) additionally require an account ID (Stripe-Context header).

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/stripeidentity/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for a single command
- Environment variables override profile config

### Request Encoding

Stripe uses form-urlencoded bodies for POST requests with nested object support:
```typescript
// Input: { options: { document: { allowed_types: ['passport'] } } }
// Encoded: options[document][allowed_types][0]=passport
```

### API Surface

VerificationSessions (`/v1/identity/verification_sessions`):
- create, get (retrieve), update, list, cancel, redact

VerificationReports (`/v1/identity/verification_reports`):
- get (retrieve), list

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_IDENTITY_API_KEY` | Stripe secret key (overrides profile) |
| `STRIPE_IDENTITY_ACCOUNT_ID` | Account ID for org API keys (optional) |
| `STRIPE_IDENTITY_BASE_URL` | Override base URL (optional) |

## Data Storage

```
~/.hasna/connectors/stripeidentity/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling

## Reference

- Stripe Identity API: https://stripe.com/docs/api/identity
