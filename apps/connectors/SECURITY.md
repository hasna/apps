# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue.
2. Email the maintainers at **security@hasna.dev** with:
   - A description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. You will receive an acknowledgment within 48 hours.
4. We will work with you to understand and address the issue before any public disclosure.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Security Measures

This project implements the following security measures:

- **CSRF protection** on OAuth flows via state tokens
- **Path traversal prevention** on connector name validation (`/^[a-z0-9-]+$/`)
- **Scoped CORS** to `localhost` (not wildcard)
- **Security headers** (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`)
- **Request body size limits** (1MB max)
- **Fetch timeouts** (10s) on external HTTP requests
- **No secrets in source** — credentials stored in `~/.connect/` only

## Credential Storage

Connector credentials are stored locally at `~/.connect/connect-{name}/`. OAuth tokens are written with `0o600` permissions. No credentials are ever sent to our servers or included in the npm package.
