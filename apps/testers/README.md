# @hasna/testers

AI-powered QA testing CLI — spawns cheap AI agents to test web apps with headless browsers

[![npm](https://img.shields.io/npm/v/@hasna/testers)](https://www.npmjs.com/package/@hasna/testers)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/testers
```

## CLI Usage

```bash
testers --help
```

## MCP Server

```bash
testers-mcp
```

64 tools available.

## REST API

```bash
testers-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service testers
cloud sync pull --service testers
```

## Data Directory

Data is stored in `~/.hasna/testers/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
