# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-abuselpdb is a TypeScript connector for the [AbuseIPDB API](https://www.abuseipdb.com/api). It provides IP abuse checking, reporting, and blacklist access for threat intelligence and security operations.

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

AbuseIPDB uses a custom `Key` header:
```
Key: YOUR_API_KEY
```

### Base URL

```
https://api.abuseipdb.com/api/v2
```

### Response Format

All responses are wrapped in a `data` envelope:
```json
{ "data": { ... } }
```

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Key header auth
│   ├── check.ts      # IP check and block check APIs
│   ├── report.ts     # Report, list reports, clear address APIs
│   ├── blacklist.ts  # Blacklist API
│   └── index.ts      # Main Connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile config (~/.connect/connect-abuselpdb/)
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Endpoints

### Check
- `GET /check` — Check single IP for abuse reports
- `GET /check-block` — Check CIDR network block

### Report
- `POST /report` — Submit abuse report for an IP
- `GET /reports` — List paginated reports for an IP
- `DELETE /clear-address` — Clear your own reports for an IP

### Blacklist
- `GET /blacklist` — Download blacklist of abusive IPs

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ABUSEIPDB_API_KEY` | AbuseIPDB API key (overrides profile) |
| `ABUSEIPDB_TOKEN` | Token (alias for API key) |
| `ABUSEIPDB_API_SECRET` | API secret (optional) |

## CLI Commands

```bash
connect-abuselpdb check ip <address> [-d <days>] [--verbose]
connect-abuselpdb check block <network> [-d <days>]
connect-abuselpdb report submit <ip> -c <categories> [-m <comment>]
connect-abuselpdb report list <ip> [-d <days>] [--page <n>] [--per-page <n>]
connect-abuselpdb report clear <ip>
connect-abuselpdb blacklist get [-c <confidence>] [-l <limit>] [--only-countries <codes>]
connect-abuselpdb config set-key <key>
connect-abuselpdb config show
connect-abuselpdb profile list|use|create|delete|show
```

## Abuse Category IDs

| ID | Category |
|----|----------|
| 1 | DNS Compromise |
| 3 | Fraud Orders |
| 4 | DDoS Attack |
| 5 | FTP Brute-Force |
| 7 | Phishing |
| 9 | Open Proxy |
| 10 | Web Spam |
| 11 | Email Spam |
| 14 | Port Scan |
| 15 | Hacking |
| 18 | Brute Force |
| 19 | Bad Web Bot |
| 21 | Web App Attack |
| 22 | SSH |
