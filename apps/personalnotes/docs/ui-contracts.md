# Hasna Notes Integration Contracts

This document is the functionality contract for the web/native UI lane.

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
    createdByActorType: "agent", // human | agent | system
    createdByName: "Codewith",
    openedFrom: "mcp",
    sourceContext: "ticket-123",
    archivedAt: "",
    trashedAt: "",
    trashExpiresAt: "",
    restoredAt: "",
    info: {
      createdBy: "Codewith",
      createdByActorType: "agent",
      createdAt: "2026-06-22T09:00:00Z",
      openedFrom: "mcp",
      sourceContext: "ticket-123"
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

Multi-machine is removed with no backwards compatibility: the boot payload carries
no `thisMachine`/`machines`, and notes carry no `machine`/`*Machine` fields. Legacy
notes that still have those frontmatter fields parse, but the fields are ignored and
dropped on the next save.

Lists should render the latest 10 items by default and expose a "View more" or
incremental-load affordance by increasing the local limit.

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

Normal Delete should call the Trash path unless `note.status === "trash"`, in
which case Delete is a permanent purge. Trash retention is controlled by
`settings.trashRetentionDays` (default `30`).

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

Recording and transcription text should be inserted with
`window.HasnaNotes.markdown.safeText(text)` before appending it to a Markdown note
body. AI title generation uses `markdown.plainText(note.body)`, not raw Markdown
syntax.

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
  sources: [{ id, title, updatedAt, createdAt, labels, status }],
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
should render `hasna:chat-confirmation` using the `approval.preview` and call
`chat.approve(approval.id, true | false)`. Agent-created notes use provenance:
`createdByActorType: "agent"`, a friendly agent name, `openedFrom: "chat"`, and
a source context.

Approvals include `toolCallId`; approving or rejecting updates the matching
`state.chat.toolCalls[]` item to `result` or `cancelled`. The web bridge accepts
explicit `options.noteId`/`selectedNoteId` for selected-note operations such as
read, note info, update, append, label/unlabel, archive, trash, and restore.

The sidecar exposes an optional AI SDK-style endpoint:

```txt
POST /chat
Content-Type: application/json
Accept: application/x-ndjson
```

Request body may include `{ prompt, messages, notes, maxSteps }`. Responses are
newline-delimited stream events such as `{ type: "text-delta" }`,
`{ type: "tool-call" }`, `{ type: "tool-result" }`, and `{ type: "finish" }`.
The sidecar operates over the supplied note snapshot and never writes to disk;
actual writes go through the web/CLI/MCP tools so confirmation and provenance
stay consistent.

CLI and MCP use the same tool registry:

```bash
hasna-notes agent "summarize renewal notes" --json
hasna-notes agent "consolidate renewal notes" --json      # preview
hasna-notes agent "consolidate renewal notes" --yes --json
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

`notes.trash(noteId)` and `notes.purge(noteId)` show the app confirmation before
mutating state. Normal delete copy should read "Move note to Trash?", while
permanent purge copy should read "Delete permanently?" and mention that the
action cannot be undone. `notes.cleanupExpiredTrash()` also requires a strong
confirmation before it permanently purges expired Trash items.

The web layer dispatches:

```js
hasna:note-archive
hasna:note-trash
hasna:note-restore
hasna:note-purge
hasna:trash-cleanup-ready
```

All note action event details include `{ noteId, note }`.

Drag/drop contract:

```txt
note rows: draggable, dataTransfer application/x-hasna-note-id=<note id>
```

`window.HasnaNotes.view.state()` returns `{ screen, labelFilter, statusFilter,
selectedId, visibleNoteIds }`. There is no machines API, machine filter, or
machine-details bridge — multi-machine has been removed with no backwards
compatibility.

Generated titles must set:

```js
note.titleLocked = false;
note.titleSource = "generated";
note.titleContentFingerprint = "<source fingerprint>";
```

## Recording API

Recording is app-level state. It must continue while navigating between Home, Notes,
Settings, and compact mode.

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
