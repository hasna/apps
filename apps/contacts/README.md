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

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service contacts
cloud sync pull --service contacts
```

## Data Directory

Data is stored in `~/.hasna/contacts/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
