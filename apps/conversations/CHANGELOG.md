# Changelog

All notable changes to this project will be documented in this file.

## [0.0.1] - 2026-02-14

### Added
- Core messaging library (SQLite WAL, 200ms polling)
- Headless CLI with send, read, sessions, reply, mark-read, status commands
- MCP server with send_message, read_messages, list_sessions, reply, mark_read tools
- Interactive TUI with session list and chat view (Ink 5 + React 18)
- Programmatic API for library consumers
- All commands support --json for machine-readable output
