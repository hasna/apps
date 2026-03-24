# @hasna/terminal

Smart terminal wrapper for AI agents and humans — structured output, token compression, MCP server, natural language

[![npm](https://img.shields.io/npm/v/@hasna/terminal)](https://www.npmjs.com/package/@hasna/terminal)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/terminal
```

## CLI Usage

```bash
terminal --help
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service terminal
cloud sync pull --service terminal
```

## Data Directory

Data is stored in `~/.hasna/terminal/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
