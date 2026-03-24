# @hasna/signatures

Open source e-signature platform — sign PDFs locally, manage documents, MCP + CLI + API

[![npm](https://img.shields.io/npm/v/@hasna/signatures)](https://www.npmjs.com/package/@hasna/signatures)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/signatures
```

## CLI Usage

```bash
open-signatures --help
```

## MCP Server

```bash
signatures-mcp
```

## REST API

```bash
signatures-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service signatures
cloud sync pull --service signatures
```

## Data Directory

Data is stored in `~/.hasna/signatures/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
