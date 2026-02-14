# Changelog

All notable changes to this project will be documented in this file.

## [0.0.5] - 2026-02-14

### Fixed
- TUI: session list now polls for updates (new sessions appear live)
- TUI: channels appear in session list with member/message counts
- TUI: opening a channel shows messages and lets you send to it
- TUI: new conversation flow creates real session on first message send
- TUI: channel sessions filtered from DM list (no duplicates)
- TUI: simplified message display to single-line format

## [0.0.4] - 2026-02-14

### Changed
- Rename CLI binary from `convo` to `conversations`
- Rename MCP binary from `convo-mcp` to `conversations-mcp`

## [0.0.3] - 2026-02-14

### Added
- Channels for broadcast messaging (many-to-many)
- CLI: `convo channel create|list|send|read|join|leave|members` commands
- MCP: create_channel, list_channels, send_to_channel, read_channel, join_channel, leave_channel tools
- Library: createChannel, listChannels, getChannel, joinChannel, leaveChannel, getChannelMembers exports
- `convo mark-read --channel` flag for marking channel messages as read
- `convo read --channel` filter for reading channel messages
- Channel member tracking with join/leave
- Auto-migration for existing databases (adds channel column)

## [0.0.2] - 2026-02-14

### Fixed
- Package visibility set to public on npm

## [0.0.1] - 2026-02-14

### Added
- Core messaging library (SQLite WAL, 200ms polling)
- Headless CLI with send, read, sessions, reply, mark-read, status commands
- MCP server with send_message, read_messages, list_sessions, reply, mark_read tools
- Interactive TUI with session list and chat view (Ink 5 + React 18)
- Programmatic API for library consumers
- All commands support --json for machine-readable output
