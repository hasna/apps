# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-stytch is a TypeScript connector for the Stytch authentication and identity API. It provides HTTP Basic auth, multi-profile configuration, and CLI access to users, magic links, passwords, sessions, OTP, TOTP, WebAuthn, crypto wallets, and OAuth endpoints.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

HTTP Basic authentication using `project_id:secret` encoded as a Basic Authorization header. Credentials can be set via:

- Environment variables (see below)
- Profile configuration: `connect-stytch config set --project-id <id> --secret <secret>`

Base URLs: `https://api.stytch.com/v1` (live) or `https://test.stytch.com/v1` (test).

## CLI Commands

### Configuration
```bash
connect-stytch config set --project-id <id> --secret <secret> [--environment live|test]
connect-stytch config show
connect-stytch config clear
```

### Profile Management
```bash
connect-stytch profile list
connect-stytch profile use <name>
connect-stytch profile create <name> --project-id <id> --secret <secret>
connect-stytch profile delete <name>
connect-stytch profile show [name]
```

### Users
```bash
connect-stytch users search [--limit N] [--cursor CURSOR]
connect-stytch users get <userId>
connect-stytch users create --email <email>
connect-stytch users update <userId> --json <body>
connect-stytch users delete <userId>
```

### Magic Links
```bash
connect-stytch magic-links send --email <email>
connect-stytch magic-links login-or-create --email <email>
connect-stytch magic-links authenticate --token <token>
```

### Passwords
```bash
connect-stytch passwords create --email <email> --password <password>
connect-stytch passwords authenticate --email <email> --password <password>
connect-stytch passwords reset-start --email <email>
```

### Sessions
```bash
connect-stytch sessions list --user-id <userId>
connect-stytch sessions authenticate --session-token <token>
connect-stytch sessions revoke --session-id <id>
```

### OTP
```bash
connect-stytch otp email-send --email <email>
connect-stytch otp sms-send --phone <number>
connect-stytch otp authenticate --method-id <id> --code <code>
```

### TOTP
```bash
connect-stytch totp create --user-id <userId>
connect-stytch totp authenticate --user-id <userId> --code <code>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STYTCH_PROJECT_ID` | Stytch project ID (overrides profile) |
| `STYTCH_SECRET` | Stytch API secret (overrides profile) |
| `STYTCH_ENVIRONMENT` | `live` or `test` (default: live) |

## Data Storage

```
~/.hasna/connectors/connect-stytch/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

Profile JSON structure:
```json
{
  "projectId": "project-live-...",
  "secret": "secret-live-...",
  "environment": "live"
}
```

## Project Structure

```
src/
├── api/
│   ├── client.ts
│   ├── users.ts
│   ├── magic-links.ts
│   ├── passwords.ts
│   ├── sessions.ts
│   ├── otp.ts
│   ├── totp.ts
│   ├── webauthn.ts
│   ├── crypto-wallets.ts
│   ├── oauth.ts
│   └── index.ts
├── cli/index.ts
├── types/index.ts
└── utils/
    ├── config.ts
    └── output.ts
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
