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
- credentials live in the connectors data home (resolved through `@hasna/paths`; `~/.hasna/connectors/` until the XDG data home is adopted)
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
- `connectors auth` stores credentials in the connectors data home (resolved through `@hasna/paths`)
- `connectors run` executes connector commands from the one-product runtime
- `connectors status` and `connectors doctor` verify setup and auth state

### Compact Output Defaults

CLI output is compact by default so agent terminals do not fill with huge
catalogs, README sections, credential status tables, or API records.

- `connectors list` shows a compact page. Use `--cursor <n>` or `--offset <n>`
  for the next page, `--limit <n>` to change page size, `--verbose` for wider
  rows, `--all --verbose` for the full human catalog, or `--json` for the full
  machine-readable payload.
- `connectors docs <name>` shows a summary. Use `--verbose` for full parsed
  sections, `--essential` for auth/env vars only, `--raw` for raw markdown, or
  `--json` for structured docs.
- `connectors status`, `connectors doctor`, `connectors jobs list`,
  `connectors workflows list`, `connectors whoami`, and dry-run install output
  page or truncate human rows by default. Use `--verbose`, `show`/`inspect`, or
  `--json` when full detail is needed.
- `connectors run` preserves JSON-style command output, but truncates very large
  human stdout. Use `connectors run --verbose <connector> ...` for full stdout.

## MCP Server

```bash
connectors-mcp
```

MCP tools also use compact defaults. `list_connectors`, `list_jobs`,
`list_workflows`, and `list_agents` return paged objects with `count`, `total`,
and `nextCursor`; pass `cursor` to continue, `limit` to change page size, and
`verbose: true` for full records. `connector_docs` and operation discovery
return summaries unless `verbose: true` or a specific detail path is requested.

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

## OpenActions And OpenAutomations Boundary

Connector operations may be exposed to OpenAutomations as `@hasna/actions`
manifests, but Connectors remains the owner of connector discovery,
enablement, consent, and credential health. An automation action should name
the connector operation and pass only scoped inputs plus references to
credentials that Connectors can resolve.

Recommended action shape:

```json
{
  "schemaVersion": "1.0",
  "id": "connectors.github.issue.create",
  "name": "Create GitHub issue",
  "version": "1.0.0",
  "bindings": [
    {
      "kind": "sdk",
      "package": "@hasna/connectors",
      "export": "runConnectorOperation",
      "metadata": {
        "connector": "github",
        "operation": "issues.create"
      }
    }
  ],
  "secrets": [
    {
      "name": "github",
      "ref": "hasna/xyz/opensource/connectors/prod/github",
      "required": true,
      "redaction": "full"
    }
  ],
  "approval": {
    "mode": "manual",
    "requiresApproval": true,
    "reason": "Creates or mutates data in an external account"
  },
  "audit": {
    "eventSource": "hasna.connectors",
    "redactPaths": ["secrets", "input.token", "input.authorization"],
    "evidenceRefs": ["connector:github", "operation:issues.create", "credentialScope:repo"]
  }
}
```

OpenAutomations owns the durable run/action queue and DLQ. Connectors owns
runtime auth checks, connector-specific consent, credential refresh, and
provider response normalization. Raw OAuth tokens, API keys, refresh tokens,
and session cookies must not be placed in automation specs, action queues, task
comments, or run evidence; use secret references and redacted audit metadata.

## Project Layout

Project-local enablement is lightweight:

```text
.connectors/
├── manifest.json
└── index.ts
```

The package no longer copies full connector source trees into each project.

## Data Directory

The connectors data home is resolved through `@hasna/paths` (XDG/macOS home layout). The legacy `~/.hasna/connectors/` default stays the effective data home until the store is actually migrated to the XDG data home (`~/.local/share/hasna/connectors` on Linux, with `connectors.db` present there) or the operator sets the data-kind override `HASNA_DATA_HOME`. The exact-app override `HASNA_CONNECTORS_DIR` wins unconditionally. An existing live store never becomes invisible on upgrade.

## Contributor Notes

Contributor guidance for the one-repo / one-product model lives in [docs/one-repo-one-product.md](docs/one-repo-one-product.md).

## License

Apache-2.0 -- see [LICENSE](LICENSE)
