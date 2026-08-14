# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-abstract is a TypeScript connector for the [Abstract API](https://www.abstractapi.com/) platform. It provides access to IP geolocation, email validation, phone validation, exchange rates, and company enrichment APIs.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Architecture

### Authentication

Abstract API uses `api_key` as a query parameter (not a header):
```
https://ipgeolocation.abstractapi.com/v1/?api_key=YOUR_KEY&ip_address=1.2.3.4
```

### Multi-Subdomain Design

Each Abstract API service has its own subdomain:
- `https://ipgeolocation.abstractapi.com` - IP Geolocation
- `https://emailvalidation.abstractapi.com` - Email Validation
- `https://phonevalidation.abstractapi.com` - Phone Validation
- `https://exchange-rates.abstractapi.com` - Exchange Rates
- `https://companyenrichment.abstractapi.com` - Company Enrichment

The client supports a `baseUrl` override per request. Each API module defines its own BASE_URL constant.

### All endpoints are GET-only

Abstract API uses GET requests for all operations with query parameters.

## Project Structure

```
src/
├── api/
│   ├── client.ts       # HTTP client with api_key query param auth
│   ├── geolocation.ts  # IP Geolocation API
│   ├── email.ts        # Email Validation API
│   ├── phone.ts        # Phone Validation API
│   ├── exchange.ts     # Exchange Rates API (live, convert, historical)
│   ├── company.ts      # Company Enrichment API
│   └── index.ts        # Main Connector class
├── cli/
│   └── index.ts        # CLI commands
├── types/
│   └── index.ts        # Type definitions
├── utils/
│   ├── config.ts       # Multi-profile config (~/.hasna/connectors/connect-abstract/)
│   └── output.ts       # CLI output formatting
└── index.ts            # Library exports
```

## API Endpoints

### IP Geolocation
- `GET /v1/` — Look up geolocation for an IP (or requester's IP)

### Email Validation
- `GET /v1/` — Validate an email address

### Phone Validation
- `GET /v1/` — Validate a phone number

### Exchange Rates
- `GET /v1/live` — Get live exchange rates
- `GET /v1/convert` — Convert between currencies
- `GET /v1/historical` — Get historical rates

### Company Enrichment
- `GET /v1/` — Enrich company data by domain

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ABSTRACT_API_KEY` | Abstract API key (overrides profile) |
| `ABSTRACT_TOKEN` | Token (alias for API key) |
| `ABSTRACT_API_SECRET` | API secret (optional) |

## CLI Commands

```bash
connect-abstract geolocation lookup [--ip <address>] [--fields <fields>]
connect-abstract email validate <email> [--auto-correct]
connect-abstract phone validate <phone>
connect-abstract exchange live -b <base> [-t <target>]
connect-abstract exchange convert -b <base> -t <target> [-a <amount>] [-d <date>]
connect-abstract exchange historical -b <base> -d <date> [-t <target>]
connect-abstract company enrich <domain> [--fields <fields>]
connect-abstract config set-key <key>
connect-abstract config show
connect-abstract profile list|use|create|delete|show
```
