# Hasna Notes Integration Contracts

This document is the functionality contract for the web/native UI lane.

## Bridge Global

The JS bridge global is `window.HasnaNotes` (renamed from the pre-rename
global; no back-compat alias is assigned). New code must use
`window.HasnaNotes` only. The `hasna:*` CustomEvent names are an internal
wire contract and are intentionally unchanged.

## Boot And Hydrate Payload

The native host injects `window.__BOOT__` before `web/app.js` runs and later calls
`window.HasnaNotes.hydrate(boot)` after note mutations.

```js
{
  listDefaults: { limit: 10 },
  notes: [{
    id: "uuid-or-file-id",
    title: "Short title",
    body: "Markdown body",
    content: "Markdown body",
    contentFormat: "markdown",
    contentPreview: "First 500 body chars",
    labels: ["research"],
    tags: ["research"], // compatibility alias only
    status: "active",
    folder: "",
    machine: "studio-mac",            // informational attribution only
    machineFriendlyName: "Apple Studio",
    rev: 1,                           // per-note monotonic revision (schema v2)
    createdByActorType: "agent", // human | agent | system — or "" (origin recorded no provenance; preserved, never default-filled)
    createdByName: "Codewith",   // "" allowed for the same reason; UIs fall back to author for display
    archivedAt: "",
    trashedAt: "",
    trashExpiresAt: "",
    restoredAt: "",
    info: {
      createdBy: "Codewith",
      createdByActorType: "agent",
      createdAt: "2026-06-22T09:00:00Z",
      machine: "studio-mac",
      machineFriendlyName: "Apple Studio",
      currentMachine: "studio-mac"
    },
    createdAt: "2026-06-22T09:00:00Z",
    updatedAt: "2026-06-22T09:00:00Z",
    titleLocked: false,
    titleSource: "default", // default | generated | manual
    titleContentFingerprint: ""
  }],
  settings: {
    trashRetentionDays: 30
  }
}
```

Lists should render the latest 10 items by default and expose a "View more" or
incremental-load affordance. `listDefaults` applies on the initial boot only —
the host hydrates after every write, and hydrate must NOT reset the user's
pagination state.

## Version Bridge

The native host injects `window.__VERSION__` at document start alongside
`window.__BOOT__`, straight from the bundle's Info.plist (both values are
stamped by `scripts/build_notes.sh`):

```js
{
  version: "0.1.0",        // CFBundleShortVersionString — package.json "version"
  build: "20260702.201530" // CFBundleVersion — UTC build stamp (proves install freshness)
}
```

The About screen renders `Version {version} ({build})` from it (`({build})` is
omitted when `build` is empty). When the global is absent or `version` is empty
(plain browser, unbundled dev binary), app.js leaves the static
`#about-version` markup untouched.

## App Layout And Navigation

Vision 05007066 ("very simple, like Google Keep") defines the shell:

- Sidebar: NO app name. Home, New Note, the collapsible
  Notes section (`#sec-notes` + `#notes-list`), the collapsible Labels filter
  section (`#labels-section` + `#labels-list`). The bottom of the sidebar is an
  ICON-ONLY row (owner brief 2026-08-19): Settings (`#open-settings`), Archive
  (`#nav-archive`) and Trash (`#nav-trash`) — no label text. Archive and trash
  are BLENDED into just Trash: both icons open the single Trash view, and
  archiving sends the note to Trash (status `trash`). Trash is never deleted —
  soft delete / hidden state only.
  Label MANAGEMENT (create/rename/delete) lives in Settings → Labels
  (`#labels-page-main`); sidebar label rows only filter. Double-click (or the
  pencil icon) renames a label INLINE (req 7).
- Header (content area, right side): the copy-note-as-Markdown action
  (`#note-copy`) and the editor delete action (`#note-delete`) — both visible
  only while the editor shows — then the Chat button (`#open-chat`) and
  minimize (`#win-min`). In native mode these sit ON the macOS traffic-light
  row; every header control carries `data-no-drag` so the shell drag strip
  passes clicks through (dragExclusions channel). `#note-copy` copies the
  title as an `# H1` (when the note has a real title) plus the Markdown body;
  copy feedback is a checkmark icon swap only — never "Copied" text.
- Search is a Cmd+K-style popover (`#search-pop`), not a page: Cmd+K (Ctrl+K)
  toggles it, typing filters notes, Enter opens the first match, Esc closes.
  Search ignores the sidebar label/status filters, so opening a match
  (Enter or row click) reconciles those filters to whatever the chosen note
  needs — the editor MUST show the note the user picked, never a substitute.
  Label/status filters reset as needed.
- Home: the quick-note composer is the hero, vertically centered. Below it the
  Recent notes render as a FLAT list (no card borders/backgrounds/shadows, no
  border-bottom between rows) with hover copy whose feedback is a checkmark
  icon only, then one subtle light-gray "View all notes" path (`#home-view-all`).
- Quick capture has ONE create path: the Home composer, the compact window, and
  finished voice recordings all create through the same helper, store the text
  as the note BODY (title left for AI auto-title), and show the same
  content-scoped toast (center-bottom of the content area).
- Compact mode is a window state: leaving it restores the pre-compact screen.

## Note Mutations

The web UI sends note mutations to the native host:

```js
window.webkit.messageHandlers.notes.postMessage({
  action: "create" | "save" | "delete",
  note
});
```

`note.labels` is canonical. `note.tags` may be emitted as a temporary compatibility
alias, but new UI copy should say "labels".

`note.body` and `note.content` are canonical Markdown text. `note.contentFormat`
is always `"markdown"` for newly written notes; legacy notes without that field
should be treated as Markdown-compatible plain text.

Manual title edits must set:

```js
note.titleLocked = true;
note.titleSource = "manual";
```

Archive and restore are explicit bridge actions. Destructive Trash,
Delete, and purge UI should call `window.HasnaNotes.notes.trash(noteId)` /
`window.HasnaNotes.notes.purge(noteId)` so the app confirmation is shown first;
raw WebKit destructive posts are internal persistence traffic and are ignored by
the native host unless the app layer already confirmed the action.

```js
window.webkit.messageHandlers.notes.postMessage({ action: "archive", note })
window.webkit.messageHandlers.notes.postMessage({ action: "restore", note })
window.HasnaNotes.notes.trash(noteId)
window.HasnaNotes.notes.purge(noteId)
```

Normal Delete ALWAYS calls the Trash path. There is NO permanent purge
(owner brief 2026-08-19 req 8): a note already in Trash stays hidden forever,
and delete()/purge() on the native bridge refuse to delete. Trash stays
attributed to the note's own `machine` field (there is no separate trash-machine
key in schema v2); `settings.trashRetentionDays` (default `30`) remains in the
data model but no longer triggers deletion.

## Markdown And Editor API

The app stores Markdown as the source of truth. Raw HTML is not trusted by the
runtime renderer; use the provided safe renderer or a renderer with the same
restricted policy. The current safe subset renders headings, paragraphs, bold,
italic, inline code, safe links, bullets, numbered lists, checklists, block
quotes, code blocks, and dividers. Raw HTML is escaped, `script`/`style` content
is ignored for plain-text extraction, and links are kept only for `http`,
`https`, `mailto`, or relative/hash URLs.

The web runtime exposes stable command and slash-menu contracts:

```js
window.HasnaNotes.markdown.commands()
window.HasnaNotes.markdown.slashCommands()
window.HasnaNotes.markdown.render(markdown)
window.HasnaNotes.markdown.plainText(markdown)
window.HasnaNotes.markdown.safeText(text)
window.HasnaNotes.markdown.applyCommand(markdown, options)
window.HasnaNotes.editor.commands()
window.HasnaNotes.editor.command(commandId, options)
```

Command IDs are:

```txt
bold, italic, code, link, h1, h2, h3, paragraph, bullet-list,
numbered-list, quote, code-block, checklist, divider
```

`markdown.applyCommand(markdown, options)` returns:

```js
{
  markdown: "updated markdown",
  selectionStart: 0,
  selectionEnd: 0
}
```

`editor.command(commandId, options)` applies the command to the active note body
textarea, persists the note through the native bridge, and dispatches:

```js
window.addEventListener("hasna:editor-command", (event) => event.detail)
```

Event detail includes `{ commandId, noteId, result }`. Slash menus should render
the command list from `markdown.slashCommands()` and pass the selected `id` to
`editor.command(...)`.

The editor exposes the engine through exactly two minimal surfaces — there is
explicitly NO formatting toolbar:

- Selection popover (`#md-pop`): appears over selected editor-body text with
  bold, italic, inline code, and link, each routed through
  `editor.command(...)`.
- Slash menu (`#slash-menu`): typing `/` at the start of a line opens a menu
  rendered from `markdown.slashCommands()`, filtered by the text after the
  slash. Arrow keys move, Enter/Tab applies (removing the `/query` trigger
  text first), Escape closes. The `divider` command inserts `---` AFTER the
  selection — it never replaces selected text.

Recording and transcription text is stored VERBATIM (CRLF-normalized and
end-trimmed only — `window.HasnaNotes.recording.transcriptBody(text)`).
Spoken transcripts are prose, not Markdown the user typed: escaping them with
`markdown.safeText(text)` inserted stray backslashes before ordinary
punctuation ("3.5" → "3\.5"), the transcription-backslash bug. `safeText`
remains available for text that must render literally inside Markdown the app
generates. AI title generation uses `markdown.plainText(note.body)`, not raw
Markdown syntax.

## Chat And Agent API

Claude owns the visual Chat section. The functionality lane exposes a
tool-capable chat contract; do not add deterministic action buttons such as a
standalone "Consolidate" control. Consolidation, organization, summarization,
labeling, and note edits should be initiated through natural-language chat and
agent tools.

The web runtime exposes:

```js
window.HasnaNotes.chat.state()
window.HasnaNotes.chat.tools()
window.HasnaNotes.chat.send(prompt, options)
window.HasnaNotes.chat.approve(approvalId, approved)
window.HasnaNotes.chat.clear()
```

Chat is backed exclusively by the AI sidecar. There is no local fallback model:
when the sidecar is unavailable, `chat.send(...)` rejects with "AI unavailable",
chat state moves to `status: "error"` with that error, `hasna:chat-error` is
dispatched, and the chat page shows an honest unavailable state instead of
fabricated answers.

Chat state shape:

```js
{
  id: "chat-local",
  status: "ready" | "submitted" | "streaming" | "awaiting_confirmation" | "error",
  messages: [{
    id: "msg-...",
    role: "user" | "assistant",
    parts: [{ type: "text", text: "..." }],
    metadata: { sources: [] }
  }],
  toolCalls: [{
    id: "tool-1",
    name: "summarize_notes",
    input: {},
    state: "call" | "result" | "approval-requested" | "cancelled",
    result: {}
  }],
  sources: [{ id, title, updatedAt, createdAt, labels, status, machine }],
  pendingConfirmations: [{
    id: "approval-...",
    toolCallId: "tool-1",
    toolName: "consolidate_notes",
    input: {},
    preview: { title, noteCount, bodyPreview, sources }
  }],
  error: ""
}
```

The web layer dispatches:

```js
hasna:chat-state
hasna:chat-message
hasna:chat-delta
hasna:chat-tool-call
hasna:chat-tool-result
hasna:chat-sources
hasna:chat-confirmation
hasna:chat-finish
hasna:chat-error
```

Event `detail` always includes `{ chat: window.HasnaNotes.chat.state() }` plus
event-specific fields such as `{ message }`, `{ text }`, `{ toolCall }`,
`{ sources }`, `{ approval }`, or `{ error }`.

Agent tool IDs:

```txt
list_notes, search_notes, read_note, note_info, create_note, update_note,
append_note, label_note, unlabel_note, archive_note, trash_note, restore_note,
summarize_notes, find_related_notes, consolidate_notes
```

`window.HasnaNotes.chat.tools()` returns the same IDs with safety flags:

```js
{
  name: "trash_note",
  description: "...",
  safety: {
    readOnly: false,
    mutates: true,
    requiresConfirmation: true
  }
}
```

Reading, searching, summarizing, note metadata, and related-note discovery run
directly. Broad or destructive writes expose a preview/approval first. The UI
should render `hasna:chat-confirmation` from the `approval.preview` as
human-readable text — never raw JSON payload dumps — and call
`chat.approve(approval.id, true | false)`. Agent-created notes use actor
provenance: `createdByActorType: "agent"` plus a friendly agent name in
`createdByName`.

Approvals include `toolCallId`; approving or rejecting updates the matching
`state.chat.toolCalls[]` item to `result` or `cancelled`. Approving posts the
approved tool call back to the sidecar `POST /tool` endpoint with
`confirm: true`; the web layer never re-implements the apply logic. The web
bridge accepts explicit `options.noteId`/`selectedNoteId` for selected-note
operations such as read, note info, update, append, label/unlabel, archive,
trash, and restore.

Chat streams from the sidecar AI SDK-style endpoint:

```txt
POST /chat
Content-Type: application/json
Accept: application/x-ndjson
```

Request body may include `{ prompt, messages, notes, maxSteps }`. Responses are
newline-delimited stream events such as `{ type: "text-delta" }`,
`{ type: "tool-call" }`, `{ type: "tool-result" }`, and `{ type: "finish" }`.
Chat writes are applied only by the sidecar's shared safe-tool registry (the
same registry as CLI/MCP), so confirmation and provenance stay consistent.

CLI and MCP use the same tool registry:

```bash
notes agent "summarize renewal notes" --json
notes agent "consolidate renewal notes" --json      # preview
notes agent "consolidate renewal notes" --yes --json
```

MCP tools: `agent_tools`, `agent_run`, and `agent_tool_call`.
Direct CLI/MCP deletion surfaces are confirmation-gated. `delete`, `trash`,
`cleanup-trash`, `notes_delete`, `notes_trash`, and `trash_cleanup` return a
preview unless confirmed; permanent `purge` / `notes_purge` require `--yes` /
`--force` or `confirm: true`.

## Note Actions API

The web runtime exposes note actions for native controls and the visual/UI lane:

```js
window.HasnaNotes.notes.archive(noteId)
window.HasnaNotes.notes.trash(noteId)
window.HasnaNotes.notes.restore(noteId)
window.HasnaNotes.notes.purge(noteId)
window.HasnaNotes.notes.info(noteId)
window.HasnaNotes.notes.setStatusFilter("active" | "archived" | "trash" | "all")
window.HasnaNotes.notes.cleanupExpiredTrash()
window.HasnaNotes.notes.settings()
window.HasnaNotes.notes.setTrashRetentionDays(days)
```

A note's `machine` frontmatter is plain informational attribution ("which
note belongs to what machine"); the machine MANIFEST surface and the
multi-machine sync machinery were removed in 0.2.0 (see "Machine surface
removed" below), but the attribution field itself stays on the note model and
in the wire dialect, visible in `notes.info(noteId)`.

`notes.trash(noteId)` and `notes.purge(noteId)` show the app confirmation before
mutating state. Normal delete copy should read "Move note to Trash?", while
permanent purge copy should read "Delete permanently?" and mention that the
action cannot be undone. `notes.cleanupExpiredTrash()` also requires a strong
confirmation before it permanently purges expired Trash items.

The sidebar Trash entry (`#nav-trash`) opens the Notes page filtered to
`status: "trash"`; the Archive entry (`#nav-archive`) does the same for
`status: "archived"`. Trash rows show a retention countdown derived from
`note.trashExpiresAt` (legacy trash without that stamp falls back to
`trashedAt` + the retention setting, so pre-retention notes still expire)
plus hover Restore and permanent-Delete actions
(permanent Delete goes through the "Delete permanently?" confirmation).
Archived rows get hover Restore; every list row gets hover copy with the
checkmark-icon-only feedback.

Retention enforcement is DISABLED (owner brief 2026-08-19 req 8): trash is
never deleted, so `cleanupExpiredTrash()` is inert, no confirmation is ever
asked, and the Settings → Appearance retention picker has been removed.
`notes.setTrashRetentionDays(days)` still exists for the host contract (clamps
to a minimum of 1 day, keeps 30 for non-numeric input) but never triggers
deletion.

The web layer dispatches:

```js
hasna:note-archive
hasna:note-trash
hasna:note-restore
hasna:note-purge
hasna:note-move
hasna:trash-cleanup-ready
```

All note action event details include `{ noteId, note }`.

## Machine surface removed

The Machines dropdown, the Settings → Machines page, the machine details
popover, and the `window.HasnaNotes.machines.*` / `sync` APIs were removed in
0.2.0 together with the machine manifest and the multi-machine sync machinery
(see docs/sync.md). The boot payload no longer carries `machines`,
`thisMachine`, or `sync`. Hosts MUST NOT send them; the web layer ignores any
leftover fields.

A note's `machine` frontmatter still records a STABLE identity, never a
cosmetic display name: `$HASNA_NOTES_MACHINE` override → `machine` in the
notes config (`~/.config/hasna-notes/config.json`) → short hostname. The Swift
shell (`Note.currentMachine`) and the JS lane (`machineIdentity()` in
tools/notes-lib.mjs) resolve identically. The field is attribution only.

## Sync Status

Multi-machine sync status is removed. There is no `notes sync` CLI, no sync
daemon, no sync-status.json surface, and no Settings sync row. The client is a
plain HTTP API client; server reachability and auth failures surface through
the HTTP transport's own errors (see docs/sync.md).

Generated titles must set:

```js
note.titleLocked = false;
note.titleSource = "generated";
note.titleContentFingerprint = "<source fingerprint>";
```

## Recording API

Recording is app-level state. It must continue while navigating between Home, Notes,
Settings, and compact mode.

Recording has exactly ONE surface per screen. On Home the quick-note composer
itself becomes the recording surface: the input bar hides, one timer renders
inside the record circle (hover reveals stop), pause/resume sits inline, and the
transcript streams below with no heading. On every other screen a minimal
indicator (`#rec-pill`) shows top-right with the same timer + pause/stop
controls; it follows the system light/dark theme and is hidden on Home so no
duplicate popover or second timer ever exists.

The public web API is:

```js
window.HasnaNotes.recording.state()
window.HasnaNotes.recording.start()
window.HasnaNotes.recording.pause()
window.HasnaNotes.recording.resume()
window.HasnaNotes.recording.stop()
```

State snapshots have this shape:

```js
{
  status: "idle" | "recording" | "paused" | "stopping" | "transcribing" | "complete" | "error",
  mode: "realtime" | "bounded",
  provider: "openai" | "elevenlabs" | "openai-bounded",
  elapsed: "0:12",
  partialTranscript: "live partial text",
  finalTranscript: "committed transcript",
  progress: { phase: "transcribing-audio", percent: 0.6 },
  progressPhase: "transcribing-audio",
  progressPercent: 0.6,
  busy: true,
  canPause: false,
  canResume: false,
  canStop: false,
  error: ""
}
```

The stop lifecycle is observable as `recording|paused -> stopping ->
transcribing -> complete -> idle` for successful recordings. Realtime providers
may continue sending `hasna:transcript-delta` and `hasna:transcript-complete`
while status is `transcribing`.

`elapsed` (and the `elapsedMs` posted to the native `window` handler) EXCLUDES
paused time: the timer holds while status is `paused` and resumes where it left
off, matching the native menu-bar status item.

## Recording Events

The web layer dispatches browser events:

```js
window.addEventListener("hasna:recording-state", (event) => event.detail)
window.addEventListener("hasna:recording-progress", (event) => event.detail)
window.addEventListener("hasna:transcript-delta", (event) => event.detail)
window.addEventListener("hasna:transcript-complete", (event) => event.detail)
```

Transcript event details contain at least:

```js
{
  text: "transcript text",
  provider: "openai" | "elevenlabs",
  mode: "realtime"
}
```

## Native Recording Bridge

The web layer also posts state to native handlers when present:

```js
window.webkit.messageHandlers.recording.postMessage({
  action: "state",
  state: recordingSnapshot
});

window.webkit.messageHandlers.window.postMessage({
  action: "recording",
  state: "started" | "paused" | "resumed" | "stopping" | "transcribing" | "complete" | "error" | "stopped" | "tick",
  status: "transcribing",
  elapsedMs: 12345,
  progress: { phase: "awaiting-final-transcript", percent: null }
});
```

## Theme Bridge

The web layer owns the persisted appearance preference (Settings → Appearance,
localStorage `notes-theme`). On boot and on every change it reports the
preference to the native host so the window backing and the WKWebView color
scheme match the app theme, not just the OS appearance:

```js
window.webkit.messageHandlers.window.postMessage({
  action: "theme",
  theme: "system" | "light" | "dark",   // the user's preference
  effective: "light" | "dark"           // informational: what is rendered now
});
```

The shell pins the window `NSAppearance` for explicit `light`/`dark` (releasing
it for `system`), re-resolves the appearance-dynamic canvas backing color, and
persists the preference (UserDefaults `HasnaNotesThemePref`) so the next
launch paints the correct backing before the web layer boots. Browsers without
`window.webkit` skip the post — theme handling stays fully functional.

The native menu/status item controls the same recorder by evaluating:

```js
window.HasnaNotes.recording.start()
window.HasnaNotes.recording.pause()
window.HasnaNotes.recording.resume()
window.HasnaNotes.recording.stop()
```

## Realtime Providers

The sidecar exposes:

```txt
GET  /health
POST /title
POST /transcribe
WS   /realtime-transcribe?provider=openai|elevenlabs&sampleRate=24000
```

Bounded transcription uses `HASNA_NOTES_TRANSCRIBE_MODEL` (default
`gpt-4o-transcribe`). OpenAI realtime uses the transcription-session WebSocket
endpoint (`/v1/realtime?intent=transcription`) and sends
`HASNA_NOTES_OPENAI_REALTIME_TRANSCRIPTION_MODEL` (default
`gpt-realtime-whisper`) as `audio.input.transcription.model`. No `model=` query
parameter is sent on that WebSocket. Transcription-only model names are not
allowed in the legacy realtime session-model slot. If an override puts
`gpt-realtime-whisper`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, or
`whisper-1` there, the sidecar falls back to `gpt-realtime` and exposes a
`configWarnings` entry from `/health`. `HASNA_NOTES_TRANSCRIBE_MODEL=
gpt-realtime-whisper` is also ignored because the bounded `/transcribe` endpoint
uses request/response speech-to-text models.

OpenAI realtime events and ElevenLabs Scribe v2 realtime events are normalized to:

```js
{ type: "ready", provider, sampleRate, model, sessionModel, mode }
{ type: "transcript.delta", text, delta }
{ type: "transcript.completed", text }
{ type: "error", error }
```
