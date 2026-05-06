# @hasna/shortlinks

CLI-only shortlink management for custom domains.

`shortlinks` creates Bitly-style short URLs, supports multiple domains, records click analytics, can run a tiny redirect server, and includes helper commands for Cloudflare DNS/Workers, `@hasna/domains`, and `@hasna/cloud` sync.

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
shortlinks doctor
```

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
  --target shortlinks.hasna.xyz \
  --origin https://shortlinks.hasna.xyz
```

Write a Cloudflare Worker that forwards requests to the redirect server while preserving the original host:

```bash
shortlinks cloudflare worker \
  --worker shortlinks \
  --origin https://shortlinks.hasna.xyz
```

Upsert DNS when `CLOUDFLARE_API_TOKEN` is available. Global API key auth is also supported with `CLOUDFLARE_API_KEY` plus `CLOUDFLARE_EMAIL`.

```bash
shortlinks cloudflare dns has.na --target shortlinks.hasna.xyz
```

## Buying Domains

Domain purchasing goes through the `domains` CLI from `@hasna/domains`:

```bash
shortlinks domain check new-short-domain.ai
shortlinks domain buy new-short-domain.ai --dry-run
```

This package does not install or call any removed `connect-*` packages.

## Cloud Sync

`shortlinks` is compatible with `@hasna/cloud` conventions:

```bash
cloud setup
shortlinks cloud migrate
shortlinks cloud push
shortlinks cloud pull
shortlinks cloud sync
```

The cloud database service name is `shortlinks`.

## AWS Origin

For an apex domain that needs stable A records, `infra/aws-ec2-user-data.sh` bootstraps a small EC2 redirect origin with:

- `@hasna/shortlinks` installed through Bun
- local SQLite data synced with the `shortlinks` RDS database through `@hasna/cloud`
- Caddy terminating HTTPS and proxying to `shortlinks serve`
- a systemd timer that syncs links and clicks every minute

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
