# @hasna/styles

Style management platform for AI coding agents — profiles, preferences, health checks, and design system enforcement

[![npm](https://img.shields.io/npm/v/@hasna/styles)](https://www.npmjs.com/package/@hasna/styles)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/styles
```

## CLI Usage

```bash
styles --help
```

- `styles list`
- `styles info <name>`
- `styles use <name>`
- `styles init`
- `styles profile list`
- `styles profile create`

## MCP Server

```bash
styles-mcp
```

28 tools available.

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service styles
cloud sync pull --service styles
```

## Data Directory

Data is stored in `~/.hasna/styles/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
