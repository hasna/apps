# @hasna/contacts

Contact management for AI coding agents — CLI + MCP + Web

[![npm](https://img.shields.io/npm/v/@hasna/contacts)](https://www.npmjs.com/package/@hasna/contacts)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/contacts
```

## CLI Usage

```bash
contacts --help
```

## MCP Server

```bash
contacts-mcp
```

## HTTP mode

Long-lived Streamable HTTP transport (stateless, bind `127.0.0.1` only):

```bash
contacts-mcp --http              # default port 8809
contacts-mcp --http --port 8809
MCP_HTTP=1 contacts-mcp
```

- Health: `GET http://127.0.0.1:8809/health`
- MCP: `http://127.0.0.1:8809/mcp`

The REST server (`contacts-serve`) also exposes `/health` and `/mcp` when running.

## REST API

```bash
contacts-serve
```

## Storage

Contacts owns its local SQLite storage directly. It does not depend on shared
cloud runtime commands or MCP tools.

```bash
contacts storage status
contacts storage status --json
contacts cloud status --json
```

`contacts cloud status` remains as a compatibility alias that reports local
storage and remote-sync availability. `contacts cloud push` and
`contacts cloud pull` return a clear unsupported message until repo-native
remote sync is configured inside this package. `contacts cloud feedback` saves
feedback locally in the contacts database.

## Data Directory

Data is stored in `~/.hasna/contacts/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
