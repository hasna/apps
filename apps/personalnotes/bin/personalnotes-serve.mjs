#!/usr/bin/env bun
// PersonalNotes self-hosted HTTP API server bin (OSS surface: <name>-serve).
// Thin launcher for the reference server in ../server so `personalnotes-serve`
// is a first-class published surface of @hasna/personalnotes, alongside the
// `personalnotes` (CLI) and `personalnotes-mcp` (MCP) bins.
//
// Runs under Bun (the server uses Bun.serve + bun:sqlite). Flags/env are
// documented by `personalnotes-serve --help`.
import '../server/index.mjs';
