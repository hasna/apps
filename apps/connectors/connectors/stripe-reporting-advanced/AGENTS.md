# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-stripe-reporting-advanced is a TypeScript CLI and library for the
[Stripe Reporting API](https://docs.stripe.com/api/reporting). It generates
scheduled financial reports (report types and report runs), with multi-profile
configuration, Bearer token authentication, and a Commander.js CLI.

## Build & Run Commands

```bash
bun install        # Install dependencies
bun run dev        # Run CLI in development
bun run build      # Build for distribution
bun run typecheck  # Type check
bun test           # Run unit tests
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
├── api/                 # API client + resource modules
│   ├── client.ts        # HTTP client (Bearer auth, form-urlencoded bodies)
│   ├── report-types.ts  # /reporting/report_types
│   ├── report-runs.ts   # /reporting/report_runs
│   ├── client.test.ts   # Unit tests (mocked fetch)
│   └── index.ts         # Main Connector class
├── cli/
│   └── index.ts         # CLI commands
├── types/
│   └── index.ts         # TypeScript types
├── utils/
│   ├── config.ts        # Multi-profile configuration
│   └── output.ts        # CLI output formatting
└── index.ts             # Library exports
```

## Authentication

Bearer token authentication with a Stripe secret key. Credentials come from:
- `STRIPE_API_KEY` environment variable, or
- Profile configuration: `connect-stripe-reporting-advanced config set-key <key>`

Report types require a live-mode key; report runs work in test or live mode.

## Key Patterns

### Request Encoding

Stripe uses form-urlencoded bodies with nested bracket notation. See
`encodeFormData` in `src/api/client.ts`:

```typescript
// Input:  { report_type: 'x', parameters: { columns: ['net'] } }
// Encoded: report_type=x&parameters[columns][0]=net
```

### Multi-Profile Configuration

Profiles are stored in `~/.hasna/connectors/stripe-reporting-advanced/profiles/`.
Environment variables override profile config.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_API_KEY` | Stripe secret API key (required) |
| `STRIPE_BASE_URL` | Override base URL |
| `STRIPE_API_VERSION` | Pin a Stripe API version |
