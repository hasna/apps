# @hasna/connectors

Open-source connector platform for enabling, authenticating, and running API connectors from one package.

[![npm](https://img.shields.io/npm/v/@hasna/connectors)](https://www.npmjs.com/package/@hasna/connectors)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/connectors
```

## What It Is

`@hasna/connectors` is a single-product runtime:

- connectors stay inside this repo and package
- projects enable the connectors they want through `.connectors/manifest.json`
- credentials live in `~/.hasna/connectors/`
- CLI, MCP, REST, and the dashboard all use the same connector registry

## CLI

```bash
connectors --help
```

Typical flow:

```bash
connectors install github stripe
connectors auth github
connectors run github --help
connectors run stripe products list --limit 5
```

Key commands:

- `connectors install` writes project enablement to `.connectors/manifest.json`
- `connectors list` and `connectors search` browse the shared catalog
- `connectors docs` reads connector docs from the internal registry
- `connectors auth` stores credentials in `~/.hasna/connectors/`
- `connectors run` executes connector commands from the one-product runtime
- `connectors status` and `connectors doctor` verify setup and auth state

## MCP Server

```bash
connectors-mcp
```

## HTTP mode

```bash
connectors-mcp --http            # http://127.0.0.1:8808/mcp
MCP_HTTP=1 connectors-mcp
```

Health: `GET http://127.0.0.1:8808/health`. MCP is also mounted on `connectors-serve` at `/mcp`.

## REST API

```bash
connectors-serve
```

The local REST API is served by the one-product runtime at
`http://localhost:9876`. Use `@hasna/connectors-sdk` with
`ConnectorsClient` or `LocalConnectorsClient` for this local
`connectors-serve` API.

Hosted SaaS products should use `HostedConnectorsClient` from
`@hasna/connectors-sdk`. The hosted client talks to a platform
`/api/v1` endpoint with bearer API keys and does not require local connector
installs or individual connector packages.

## Project Layout

Project-local enablement is lightweight:

```text
.connectors/
├── manifest.json
└── index.ts
```

The package no longer copies full connector source trees into each project.

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service connectors
cloud sync pull --service connectors
```

## Data Directory

Data is stored in `~/.hasna/connectors/`.

## Contributor Notes

Contributor guidance for the one-repo / one-product model lives in [docs/one-repo-one-product.md](docs/one-repo-one-product.md).

## License

Apache-2.0 -- see [LICENSE](LICENSE)
