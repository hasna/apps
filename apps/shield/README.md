# @hasna/security

AI-powered security scanner for git repos — CLI, MCP, API, Web Dashboard, SDK with Cerebras LLM

[![npm](https://img.shields.io/npm/v/@hasna/security)](https://www.npmjs.com/package/@hasna/security)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/security
```

## CLI Usage

```bash
security --help
```

## MCP Server

```bash
security-mcp
```

25 tools available.

## REST API

```bash
security-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service security
cloud sync pull --service security
```

## Data Directory

Data is stored in `~/.hasna/security/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
