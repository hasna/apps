# @hasna/brains

Fine-tuned model tracker and trainer — wraps OpenAI + Thinker Labs, gathers training data from todos/mementos/conversations/sessions

[![npm](https://img.shields.io/npm/v/@hasna/brains)](https://www.npmjs.com/package/@hasna/brains)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/brains
```

## CLI Usage

```bash
brains --help
```

- `brains models list`
- `brains models show`
- `brains finetune start`
- `brains finetune status`
- `brains data`

## MCP Server

```bash
brains-mcp
```

## REST API

```bash
brains-serve
```

## Storage Sync

This package supports package-native local/remote storage sync:

```bash
brains storage status
brains storage push
brains storage pull
```

Set `HASNA_BRAINS_DATABASE_URL` for a direct PostgreSQL connection, or configure `~/.hasna/brains/storage/config.json` for the brains RDS host settings.
Deprecated migration aliases are still accepted: `HASNA_BRAINS_CLOUD_DATABASE_URL`,
`OPEN_BRAINS_CLOUD_DATABASE_URL`, and `BRAINS_CLOUD_DATABASE_URL`.

## Data Directory

Data is stored in `~/.hasna/brains/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
