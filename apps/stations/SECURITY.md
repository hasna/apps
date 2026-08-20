# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.0.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. Do not open a public GitHub issue.
2. Email hasna@hasna.com with details.
3. Include steps to reproduce if possible.
4. Allow reasonable time for a fix before public disclosure.

## Security Model

### Local-first fleet data

`@hasna/stations` stores runtime fleet data locally in SQLite under the Hasna
stations data directory. It makes no telemetry calls by default. Optional
PostgreSQL storage, S3 backups, webhook notifications, HTTP dashboard access,
and remote machine commands are only used when explicitly configured or invoked
by the operator.

### Public-safe output by default

Default CLI, MCP, and HTTP output redacts machine identifiers, local paths,
route targets, private network addresses, database URLs, and secret-like values
where those values could expose private fleet details. Private fleet metadata is
only returned when the operator explicitly opts in with private-output flags or
environment gates documented in the README.

### Remote commands and mutations

Provisioning, daemon lifecycle, hosts-file updates, notifications, runtime
events, and other mutating operations are dry-run or approval-gated unless the
command explicitly requires `--apply`, `--yes`, or a scoped mutation approval
token. Treat generated commands as local operator actions and review them before
running in production environments.

### Sensitive local files

Protect local machine state, manifests, SQLite databases, notification
configuration, and any private manifest adapters with normal workstation secret
hygiene. Do not include private manifests, `.env` files, database files, or
tool-local state directories in public issues, release artifacts, or npm
package contents.

## Best Practices

- Keep the Hasna stations data directory on a filesystem with restricted
  permissions.
- Use loopback-only HTTP dashboard defaults unless exposing the service on a
  trusted network.
- Require API keys or explicit unauthenticated loopback mode for Streamable HTTP
  MCP connections.
- Keep private fleet metadata out of public bug reports and open-source
  manifests.
- Run `bun run verify:release` before publishing a release.
