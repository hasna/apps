# @hasna/crawl

AI-powered web crawler — self-hosted Firecrawl alternative. Crawl, extract, render JS, search. CLI + MCP + REST API + Dashboard.

[![npm](https://img.shields.io/npm/v/@hasna/crawl)](https://www.npmjs.com/package/@hasna/crawl)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/crawl
```

## CLI Usage

```bash
crawl --help
```

- `crawl crawl <url>`
- `crawl list`
- `crawl stats`
- `crawl search <query>`
- `crawl sitemap <url>`
- `crawl map <url>`
- `crawl export`

## MCP Server

```bash
crawl-mcp
```

30 tools available.

## REST API

```bash
crawl-serve
```

## Storage Sync

This package supports optional remote storage sync directly against a Postgres/RDS
database. Local SQLite remains the default. Screenshot artifacts can optionally
sync to S3 using Bun's native S3 client.

```bash
export HASNA_CRAWL_DATABASE_URL=postgres://...
export HASNA_CRAWL_S3_BUCKET=my-crawl-artifacts
export HASNA_CRAWL_S3_PREFIX=open-crawl/prod
export HASNA_CRAWL_AWS_REGION=us-east-1

crawl storage status
crawl storage push
crawl storage pull
crawl storage sync
crawl storage artifacts status
crawl storage artifacts upload
crawl storage artifacts download
```

MCP exposes the same flow through `storage_status`, `storage_push`,
`storage_pull`, `storage_sync`, `storage_artifacts_upload`, and
`storage_artifacts_download`.

## Data Directory

Data is stored in `~/.hasna/crawl/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
