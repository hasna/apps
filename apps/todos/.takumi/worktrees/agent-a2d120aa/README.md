# @hasna/todos

Universal task management for AI coding agents - CLI + MCP server + interactive TUI

[![npm](https://img.shields.io/npm/v/@hasna/todos)](https://www.npmjs.com/package/@hasna/todos)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/todos
```

## CLI Usage

```bash
todos --help
```

## MCP Server

```bash
todos-mcp
```

135 tools available.

## REST API

```bash
todos-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service todos
cloud sync pull --service todos
```

## Data Directory

Data is stored in `~/.hasna/todos/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
