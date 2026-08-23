---
"@hasna/notes": minor
---

**BREAKING: the macOS desktop app is removed from `@hasna/notes` and now lives in `hasna-products/personalnotes`.** Owner directive 2026-08-22: this package ships headless only — a local-first notes CLI, an MCP server, an importable SDK, and a self-hosted HTTP server (SQLite or PostgreSQL).

Removed: the SwiftPM manifest (`Package.swift`), the native WKWebView shell and store library (`Sources/HasnaNotesApp`, `Sources/HasnaNotesCore`, `Sources/HasnaNotesSmoke`), the bundled browser UI (`web/`), the AI sidecar server (`ai-sidecar/`), the brand and app-icon assets (`assets/`), the app build and deploy scripts, and the app-only tooling and docs that existed to serve them. `test/app-removal.test.mjs` guards every removed path against reintroduction. The final upstream commits carrying the app in this repo are **da9764f4 (#638)** and **5a449b417**; the removal landed as **20804a7ce (#934)**.

**No published surface changed.** The `bin` entries (`notes`, `notes-mcp`, `notes-serve`), the `exports` map (`.`, `./sdk`, `./events`), and the `files` array are byte-identical, so the npm payload is unchanged. Voice capture, realtime transcription, and the chat UI were app surfaces and moved with the app; the `--sidecar <url>` title client remains and now points at any endpoint exposing `POST /title` (this package ships the client, not the server). Two manifest edits were required and are not payload changes: `"ai-sidecar"` dropped from this package's `workspaces` and from `apps/notes/ai-sidecar` in the monorepo root `package.json` — without them `bun install` fails with `Workspace not found "ai-sidecar"`.

Interoperability is unchanged: the `personalnotes/v1` wire dialect and the Markdown-with-YAML-frontmatter on-disk format remain the shared contract between this package and the desktop app.

Bump level is `minor`, not `major`, per this repository's demonstrated convention for a pre-1.0 breaking change to this exact package: `notes-sync-removal` (removal of the whole multi-machine sync surface) and `notes-two-backend-storage` (which states "Breaking for downstream consumers" in its own body) both shipped as `minor` and landed together in 0.3.0. `major` here would declare 1.0.0, which is a product statement this gate-healing change is not authorized to make.
