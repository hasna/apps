# @hasna/mcps

Meta-MCP registry & CLI — discover, manage, and proxy MCP servers

[![npm](https://img.shields.io/npm/v/@hasna/mcps)](https://www.npmjs.com/package/@hasna/mcps)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/mcps
```

## CLI Usage

```bash
mcps --help
```

- `mcps list`
- `mcps search`
- `mcps add`
- `mcps remove`
- `mcps enable`
- `mcps disable`
- `mcps tools`
- `mcps call`
- `mcps info`
- `mcps doctor`

## MCP Server

```bash
mcps-mcp
```

26 tools available.

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service mcps
cloud sync pull --service mcps
```

## Data Directory

Data is stored in `~/.hasna/mcps/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
