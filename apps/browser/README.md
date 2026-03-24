# @hasna/browser

General-purpose browser agent toolkit — Playwright, Chrome DevTools Protocol, Lightpanda with auto engine selection. CLI + MCP + REST + SDK.

[![npm](https://img.shields.io/npm/v/@hasna/browser)](https://www.npmjs.com/package/@hasna/browser)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/browser
```

## CLI Usage

```bash
browser --help
```

## MCP Server

```bash
browser-mcp
```

1 tools available.

## REST API

```bash
browser-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service browser
cloud sync pull --service browser
```

## Data Directory

Data is stored in `~/.hasna/browser/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
