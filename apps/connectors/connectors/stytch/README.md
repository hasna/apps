# connect-stytch

TypeScript connector for the [Stytch](https://stytch.com) authentication and identity API.

## Features

- HTTP Basic authentication (`project_id:secret`)
- Live and test environment support
- Users, magic links, passwords, sessions, OTP, TOTP, WebAuthn, crypto wallets, and OAuth APIs
- Multi-profile CLI configuration

## Install

```bash
bun install
```

## Configuration

```bash
connect-stytch config set --project-id <id> --secret <secret> [--environment live|test]
```

Or set environment variables (see `.env.example`).

## Usage

```bash
# Search users
connect-stytch users search --limit 10

# Get user
connect-stytch users get <user_id>

# Send magic link
connect-stytch magic-links send --email user@example.com

# Authenticate session
connect-stytch sessions authenticate --session-token <token>
```

## Development

```bash
bun run dev -- users search
bun run typecheck
bun test
```

## License

Apache-2.0
