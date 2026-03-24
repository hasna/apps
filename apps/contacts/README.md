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
