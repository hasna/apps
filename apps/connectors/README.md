# @hasna/connectors

Open source connector library - Install API connectors with a single command

[![npm](https://img.shields.io/npm/v/@hasna/connectors)](https://www.npmjs.com/package/@hasna/connectors)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/connectors
```

## CLI Usage

```bash
connectors --help
```

- `connectors install`
- `connectors list`
- `connectors search`
- `connectors info`
- `connectors docs`
- `connectors remove`
- `connectors categories`
- `connectors auth`
- `connectors doctor`

## MCP Server

```bash
connectors-mcp
```

## REST API

```bash
connectors-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service connectors
cloud sync pull --service connectors
```

## Data Directory

Data is stored in `~/.hasna/connectors/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
