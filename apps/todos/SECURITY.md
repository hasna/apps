# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.5.x   | Yes                |
| 0.4.x   | Security fixes only|
| < 0.4   | No                 |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email **hasna@todos.md** with details
3. Include steps to reproduce if possible
4. Allow reasonable time for a fix before public disclosure

## Security Model

### Local-first Architecture

todos.md stores all data in a local SQLite database. No data is sent to external
servers unless you explicitly use the sync feature.

### API Key Authentication

When API keys are configured:
- All API endpoints require `Authorization: Bearer <key>` header
- Keys are SHA-256 hashed before storage (plaintext never stored)
- Keys can have optional expiry dates
- The `/api/keys` management endpoints are always accessible

### Data at Rest

- SQLite database is stored on disk with filesystem permissions
- API key secrets are only shown once at creation time
- Webhook secrets are stored in plaintext (protect your database file)

### Rate Limiting

- API endpoints are rate-limited to 100 requests/minute per key/IP
- Rate limits are enforced in-memory

## Best Practices

- Set `TODOS_DB_PATH` to a location with restricted permissions
- Use API keys when exposing the dashboard on a network
- Rotate API keys periodically
- Use webhook secrets for payload verification
