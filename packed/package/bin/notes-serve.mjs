#!/usr/bin/env bun
// Hasna Notes self-hosted HTTP API server bin (OSS surface: <name>-serve).
// Thin launcher for the reference server in ../server so `notes-serve`
// is a first-class published surface of @hasna/notes, alongside the
// `notes` (CLI) and `notes-mcp` (MCP) bins.
//
// Runs under Bun (Bun.serve with mandatory server-side PostgreSQL). Flags/env are
// documented by `notes-serve --help`.
import '../server/index.mjs';
