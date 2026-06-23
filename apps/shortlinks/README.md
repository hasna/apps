# @hasna/shortlinks

CLI-only shortlink management for custom domains.

`shortlinks` creates Bitly-style short URLs, supports multiple domains, records click analytics, can run a tiny redirect server, and includes helper commands for Cloudflare DNS/Workers, `@hasna/domains`, and package-native storage sync. Production serving can run directly against the shared RDS database with `--remote`; local SQLite is only for explicit local/offline use.

[![npm](https://img.shields.io/npm/v/@hasna/shortlinks)](https://www.npmjs.com/package/@hasna/shortlinks)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/shortlinks
```

The local database lives at:

```bash
~/.hasna/shortlinks/shortlinks.db
```

## Quick Start

```bash
shortlinks init --domain has.na
shortlinks create https://example.com --slug docs
shortlinks serve --host 127.0.0.1 --port 8787
```

Then a request for `https://has.na/docs` redirects to `https://example.com` and records a click.

## Agent-Friendly JSON

Every operational command supports `--json`:

```bash
shortlinks --json create https://example.com --domain has.na
shortlinks --json link list
shortlinks --json stats docs --domain has.na
shortlinks --json doctor
```

Errors are emitted as:

```json
{ "error": "message" }
```

## CLI

```bash
shortlinks init --domain has.na
shortlinks domain add has.na --default
shortlinks domain setup go.example.com --cloudflare --target shortlinks.example.com --dry-run
shortlinks domain check example.ai
shortlinks domain buy example.ai --dry-run

shortlinks create https://example.com --slug home
shortlinks link create https://example.com/docs --domain has.na --title Docs
shortlinks link list
shortlinks link get home --domain has.na
shortlinks link disable home --domain has.na
shortlinks link enable home --domain has.na
shortlinks stats home --domain has.na

shortlinks serve --port 8787
shortlinks serve --remote --port 8787
shortlinks doctor
```

## Admin API Security

The redirect server includes an admin API for automation. Mutating routes such as
`POST /api/links`, `POST /api/links/:slug/active`, `POST /api/domains`, and
`DELETE /api/links/:slug` require an explicit API token. Set
`SHORTLINKS_API_TOKEN` or `HASNA_SHORTLINKS_API_TOKEN` before using those routes:

```bash
export SHORTLINKS_API_TOKEN="$(openssl rand -hex 32)"
shortlinks serve --remote --host 127.0.0.1 --port 8787 --api-path-prefix /_shortlinks/api
```

If no token is configured, write routes fail closed with `401` instead of
accepting unauthenticated changes. Generated Cloudflare Workers are intended for
public redirect traffic only; by default they do not forward `/api` or
`/_shortlinks/api` to the shortlinks origin.

## Local Domain Setup

Record a local mapping with the `machines` CLI and print the remaining hosts/proxy setup:

```bash
shortlinks local setup has.na --port 8787
shortlinks local plan has.na --port 8787
```

The command emits the `/etc/hosts` line, a Caddy reverse-proxy snippet, and certificate paths. Writing `/etc/hosts` still requires sudo on macOS.

## Custom Domains

Add as many domains as you need:

```bash
shortlinks domain add has.na --default
shortlinks domain add go.example.com --provider cloudflare
```

Generated links use the default domain unless `--domain` is passed.

## Cloudflare

Create a dry-run plan:

```bash
shortlinks cloudflare plan has.na \
  --target shortlinks.example.com \
  --origin https://shortlinks.example.com
```

Write a Cloudflare Worker that forwards redirect requests to the server while
preserving the original host. The generated Worker treats `/a` and `/api` as
reserved public prefixes, and keeps known shortlinks admin API prefixes from
being proxied to the shortlinks origin. If `ATTACHMENTS_ORIGIN` is configured,
reserved attachment prefixes are sent there instead.

```bash
shortlinks cloudflare worker \
  --worker shortlinks \
  --origin https://shortlinks.example.com
```

Upsert DNS when `CLOUDFLARE_API_TOKEN` is available. Global API key auth is also supported with `CLOUDFLARE_API_KEY` plus `CLOUDFLARE_EMAIL`.

```bash
shortlinks cloudflare dns has.na --target shortlinks.example.com
```

## Buying Domains

Domain purchasing goes through the `domains` CLI from `@hasna/domains`:

```bash
shortlinks domain check new-short-domain.ai
shortlinks domain buy new-short-domain.ai --dry-run
```

This package does not install or call any removed `connect-*` packages.

## Storage Sync

Storage sync is optional and implemented inside this package:

```bash
shortlinks storage migrate
shortlinks storage push
shortlinks storage pull
shortlinks storage sync
```

For production storage, set `HASNA_SHORTLINKS_DATABASE_URL` or configure
`~/.hasna/shortlinks/storage/config.json` to run in hybrid/remote mode with
PostgreSQL. `SHORTLINKS_DATABASE_URL` remains supported as a rollback/local
fallback. The storage database service name is `shortlinks`.
Programmatic storage helpers are available from `@hasna/shortlinks/storage`.
Use direct RDS mode for production and live management:

```bash
shortlinks --remote create https://example.com
shortlinks --remote link list
shortlinks serve --remote --host 127.0.0.1 --port 8787
```

## AWS Origin

For an apex domain that needs stable A records, `infra/aws-ec2-user-data.sh` bootstraps a small EC2 redirect origin with:

- `@hasna/shortlinks` installed through Bun
- direct reads and click writes against the `shortlinks` RDS database through the package-native PostgreSQL store
- Caddy terminating HTTPS and proxying to `shortlinks serve`

The script reads the RDS password from AWS Secrets Manager through the instance role; it does not contain secret values.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

## Repository

The OSS repository is expected to be:

```text
hasna/shortlinks
```

The local workspace folder may still be named `open-shortlinks`; the published package and GitHub repo do not use the `open-` prefix.

## License

Apache-2.0. See [LICENSE](LICENSE).
