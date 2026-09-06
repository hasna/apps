# AGENTS.md — How AI Agents Should Use @hasna/notes

`@hasna/notes` is a headless Notes package: an authenticated HTTPS CLI, MCP
server, SDK, and a PostgreSQL-only `personalnotes/v1` server (served at the
`/v1` authority root). Client processes never open a local database.

## Quick Start

```bash
# Install
bun install -g @hasna/notes

# One-line fetch of a note
notes get <note-id> --json
```

Credentials are resolved per request through the `@hasna/contracts` client
chain (hasna/apps#1720):

- **Hosted** (the fleet): a credential from `HASNA_NOTES_API_KEY`, the
  Keychain item `hasna.credentials.notes.api-key`, or
  `~/.hasna/notes/config/credentials` (owner-only `0600`) is enough; the
  authority defaults to `https://api.hasna.com/notes`. Set
  `HASNA_NOTES_API_URL` only to point somewhere else.
- There is **no local mode** and no fallback: with no credential the CLI and
  MCP server exit non-zero with no SQLite access and no local-fallback event.

## MCP

Register `notes-mcp` (stdio) with your agent runtime:

```json
{ "mcpServers": { "notes": { "command": "notes-mcp" } } }
```

Tools: `notes_list`, `notes_get`, `notes_create`, `notes_update`,
`notes_delete` (confirmation-gated), `notes_archive`, `notes_restore`,
`labels_list`, `labels_assign`, `labels_unassign`, `markdown_commands`,
`markdown_render`, `markdown_plain_text`, `markdown_apply_command`.
A long-lived MCP server re-resolves the credential on every tool call, so a
key rotation heals without restarting the server.

## SDK

```js
import { NotesClient } from '@hasna/notes/sdk';

const notes = new NotesClient(); // resolves per request: Keychain → credentials file → env
const page = await notes.list({ limit: 10 });
const note = await notes.get(page.items[0].id);
await notes.update(note.id, { title: 'Renamed' });
```

`resolveNotesClientTransport` / `createNotesHttpStore` are exported from
`./sdk` for diagnostic and integration code; the returned report names the
credential SOURCE and tier, never the value.

## CLI

```bash
notes list --json
notes get <id>
notes create --title "Brainstorm" --body "…" --label ideas
notes update <id> --title "Brainstorm v2"
notes archive <id> && notes restore <id>
notes storage status --json   # shows authority/key source and tier
```

`notes delete <id>` is confirmation-gated; pass `--yes` in non-interactive
shells after showing a preview. Data/legacy migration helpers are
copy-only maintenance actions (`notes storage migrate-legacy-path
--dry-run` first, always).

## Server

`notes-serve` is the self-hosted reference server: PostgreSQL only
(`HASNA_NOTES_DATABASE_URL` mandatory), API keys minted at first login
(`/v1/auth/login` + `/v1/auth/verify`), health at `/health`/`/ready`/`/version`.

## Anti-patterns

❌ **Don't read `HASNA_NOTES_API_KEY` yourself** — the resolver chain does that
per call; a hand-read is a stale snapshot and defeats rotation heals.
❌ **Don't set `HASNA_NOTES_DATABASE_URL` in a client process** — clients
reject it on purpose.
❌ **Don't pass a copied env object to the resolver** (hasna/apps#1788) — the
Keychain/disk tiers are ambient and gate on env identity; hand it
`process.env` as-is.
❌ **Don't attach a fleet credential to an explicit custom base URL** — an
explicit authority needs an explicit key (hasna/apps#1794).
❌ **Don't look for a local SQLite store** — there is none; this package is
remote-only by design.