# @hasna/economy

AI coding cost tracker — CLI + MCP server + REST API + web dashboard for Claude Code, Codex, and Gemini

[![npm](https://img.shields.io/npm/v/@hasna/economy)](https://www.npmjs.com/package/@hasna/economy)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/economy
```

## CLI Usage

```bash
economy --help
```

## MCP Server

```bash
economy-mcp --help
```

## REST API

```bash
economy-serve --help
```

## Native macOS Menubar

The `menubar/` app is a native SwiftUI menu bar app built with `MenuBarExtra`, not Electron. It targets macOS 26 and talks to the REST API exposed by `economy-serve`. The server URL is configurable inside the app and defaults to `http://127.0.0.1:3456`.

Build it on macOS with Xcode / Swift 6.2:

```bash
cd menubar
swift build -c release
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service economy
cloud sync pull --service economy
```

## Data Directory

Data is stored in `~/.hasna/economy/`.

The main SQLite database lives at `~/.hasna/economy/economy.db`. Older `~/.economy/` data is auto-migrated on first open.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
