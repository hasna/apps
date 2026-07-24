# PersonalNotes Integration Contracts

This document is the functionality contract for the web/native UI lane.

## Bridge Global Rename (Deprecation Notice)

The JS bridge global is `window.PersonalNotes` (renamed from `window.HasnaNotes`).
For ONE release `web/app.js` also assigns the deprecated back-compat alias
`window.HasnaNotes = window.PersonalNotes` so old hosts and integrations keep
working; it will be removed next release. New code must use
`window.PersonalNotes` only. The `hasna:*` CustomEvent names are an internal
wire contract and are intentionally unchanged.

## Boot And Hydrate Payload

The native host injects `window.__BOOT__` before `web/app.js` runs and later calls
`window.PersonalNotes.hydrate(boot)` after note mutations.

```js
{
  thisMachine: "studio-mac",
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
	  machines: [{
	    id: "studio-mac",
	    slug: "studio-mac",
	    displayName: "Apple Studio",
	    friendlyName: "Apple Studio",
	    platform: "macos",
	    status: "online",
	    online: true,
	    noteCount: 14,
	    activeNoteCount: 14,
	    archivedNoteCount: 1,
	    trashNoteCount: 0,
	    totalNoteCount: 15,
	    latestNoteUpdatedAt: "2026-06-22T09:00:00Z",
	    lastSeenAt: "2026-06-22T09:00:00Z",
	    recentActivityAt: "2026-06-22T09:00:00Z",
	    updatedAt: "2026-06-22T09:00:00Z",
	    // Sync facts are OPTIONAL and never fabricated: hosts/manifests may send
	    // them; machines.details(...) additionally overlays THIS machine's row
	    // from the boot `sync` object (syncedAt = lastSuccessAt, capability
	    // "notes-sync" once a sync client is configured — status ok OR error).
	    // Rows for machines whose sync state is unknown simply omit/empty them.
	    syncedAt: "2026-07-02T09:00:00.000Z",
	    capabilities: ["notes-sync"]
	  }],
  settings: {
    trashRetentionDays: 30
  },
  sync: {
    // Pass-through of <data-root>/sync-status.json (written by the CLI/daemon
    // after EVERY sync attempt). Hosts send { status: "never" } when the file
    // is missing. On "error", `error` holds the failure message and
    // lastSuccessAt keeps the previous good run.
    status: "ok", // "never" | "ok" | "error"
    lastSyncAt: "2026-07-02T09:00:00.000Z",
    lastSuccessAt: "2026-07-02T09:00:00.000Z",
    error: "",
    apiUrl: "https://personalnotes.ai",
    cursor: "2026-07-02T09:00:00.000Z",
    runner: "daemon" // "cli" | "daemon"
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
stamped by `scripts/build_personalnotes.sh`):

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

- Sidebar: NO app name. The machines filter dropdown sits at the top
  (`#machines-dd-btn` + `#machines-list`), then Home, New Note, the collapsible
  Notes section (`#sec-notes` + `#notes-list`), the collapsible Labels filter
  section (`#labels-section` + `#labels-list`), an Archive entry
  (`#nav-archive`), a Trash entry (`#nav-trash`), and Settings at the bottom.
  Label MANAGEMENT (create/rename/delete) lives in Settings → Labels
  (`#labels-page-main`); sidebar label rows only filter.
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
  Search ignores the sidebar machine/label/status filters, so opening a match
  (Enter or row click) reconciles those filters to whatever the chosen note
  needs — the editor MUST show the note the user picked, never a substitute.
  A machine-filter mismatch reconciles by JUMPING the machine filter to the
  picked note's own machine (vision 9f8fba61: selecting another machine's note
  navigates to that machine and shows it); label/status filters reset as
  needed. Notes without machine attribution fall back to All Machines.
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
Delete, and purge UI should call `window.PersonalNotes.notes.trash(noteId)` /
`window.PersonalNotes.notes.purge(noteId)` so the app confirmation is shown first;
raw WebKit destructive posts are internal persistence traffic and are ignored by
the native host unless the app layer already confirmed the action.

```js
window.webkit.messageHandlers.notes.postMessage({ action: "archive", note })
window.webkit.messageHandlers.notes.postMessage({ action: "restore", note })
window.PersonalNotes.notes.trash(noteId)
window.PersonalNotes.notes.purge(noteId)
```

Normal Delete should call the Trash path unless `note.status === "trash"`, in
which case Delete is a permanent purge. Trash stays attributed to the note's
own `machine` field (there is no separate trash-machine key in schema v2), and
retention is controlled by `settings.trashRetentionDays` (default `30`).

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
window.PersonalNotes.markdown.commands()
window.PersonalNotes.markdown.slashCommands()
window.PersonalNotes.markdown.render(markdown)
window.PersonalNotes.markdown.plainText(markdown)
window.PersonalNotes.markdown.safeText(text)
window.PersonalNotes.markdown.applyCommand(markdown, options)
window.PersonalNotes.editor.commands()
window.PersonalNotes.editor.command(commandId, options)
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
end-trimmed only — `window.PersonalNotes.recording.transcriptBody(text)`).
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
window.PersonalNotes.chat.state()
window.PersonalNotes.chat.tools()
window.PersonalNotes.chat.send(prompt, options)
window.PersonalNotes.chat.approve(approvalId, approved)
window.PersonalNotes.chat.clear()
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

Event `detail` always includes `{ chat: window.PersonalNotes.chat.state() }` plus
event-specific fields such as `{ message }`, `{ text }`, `{ toolCall }`,
`{ sources }`, `{ approval }`, or `{ error }`.

Agent tool IDs:

```txt
list_notes, search_notes, read_note, note_info, create_note, update_note,
append_note, label_note, unlabel_note, archive_note, trash_note, restore_note,
summarize_notes, find_related_notes, consolidate_notes
```

`window.PersonalNotes.chat.tools()` returns the same IDs with safety flags:

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
personalnotes agent "summarize renewal notes" --json
personalnotes agent "consolidate renewal notes" --json      # preview
personalnotes agent "consolidate renewal notes" --yes --json
```

MCP tools: `agent_tools`, `agent_run`, and `agent_tool_call`.
Direct CLI/MCP deletion surfaces are confirmation-gated. `delete`, `trash`,
`cleanup-trash`, `notes_delete`, `notes_trash`, and `trash_cleanup` return a
preview unless confirmed; permanent `purge` / `notes_purge` require `--yes` /
`--force` or `confirm: true`.

## Note Actions API

The web runtime exposes note actions for native controls and the visual/UI lane:

```js
window.PersonalNotes.notes.archive(noteId)
window.PersonalNotes.notes.trash(noteId)
window.PersonalNotes.notes.restore(noteId)
window.PersonalNotes.notes.purge(noteId)
window.PersonalNotes.notes.moveToMachine(noteId, machine, friendlyName?)
window.PersonalNotes.notes.info(noteId)
window.PersonalNotes.notes.setStatusFilter("active" | "archived" | "trash" | "all")
window.PersonalNotes.notes.cleanupExpiredTrash()
window.PersonalNotes.notes.settings()
window.PersonalNotes.notes.setTrashRetentionDays(days)
```

`notes.moveToMachine(...)` re-attributes a note to another machine ("Move to
machine" in the row context menu, shown on active notes). In schema v2 this is
a plain update of `note.machine` + `note.machineFriendlyName` (no move
provenance trail is kept). It persists through the native `move` bridge action
(`window.webkit.messageHandlers.notes.postMessage({ action: "move", note })`),
switches the machine filter to the destination via `machines.select(...,
{ reason: "move" })`, and dispatches `hasna:note-move` with `{ targetMachine,
targetMachineFriendlyName, selectedMachine, selectedNoteId, view }` on top of
the standard note detail. The fleet rsync engine stays cut — a note's `machine`
frontmatter is attribution ("which note belongs to what machine"), visible on
note rows, the editor meta line, and `notes.info(noteId)`.

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

Retention is ENFORCED on boot and hydrate: when expired Trash items exist, the
app runs the `cleanupExpiredTrash()` path — including its strong confirmation —
at most once per session, so declining does not re-prompt on the hydrate that
follows every save. Settings → Appearance exposes the retention picker
(`#retention-row`, options 7/30/90 days, default 30);
`notes.setTrashRetentionDays(days)` clamps to a minimum of 1 day (0 or negative
input becomes 1, matching the Swift store) and keeps 30 for non-numeric input.

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

## Machine Details API

Machines render as a compact dropdown at the TOP of the sidebar
(`#machines-dd-btn` opens the `#machines-list` menu; the button shows the active
filter's friendly name). Selecting a machine filters the notes list via
`machines.select(...)`. Machine rows can render from the boot payload
immediately. For a right-click "View details" flow, use the cached API first and
optionally request a native refresh:

```js
window.PersonalNotes.machines.list()
window.PersonalNotes.machines.details(machineId)
window.PersonalNotes.machines.select(machineId, { reason, noteId, statusFilter })
window.PersonalNotes.machines.requestDetails(machineId).then(detail => ...)
window.PersonalNotes.view.state()
```

`machines.select(...)` canonicalizes machine aliases (`id`, `slug`,
`friendlyName`, `displayName`), switches the main view to Notes, clears the
sidebar label filter, resets note pagination to the latest 10, selects the
requested note when supplied, and otherwise selects the newest visible note for
that machine. Selecting a machine filters purely over the LOCAL synced store —
every machine's notes are local files after sync, so `machines.select(...)`
never round-trips the native bridge. The `machineDetails` bridge remains for
explicit details flows only (`machines.requestDetails(...)`, Settings machine
rows, right-click "View details").

Selecting a note that belongs to a different machine than the active filter
(search, Home recent cards, chat source chips) jumps the machine filter to the
note's own machine and shows the note (vision 9f8fba61) — selection + render
MUST work across machine filter switches.

Right-clicking a machine row (vision f8659e18) BOTH dispatches
`hasna:machine-context` (the integration hook, detail
`{ machineId, machine }`) AND renders the `#machine-pop` details popover:
display name, a "This machine" badge when the row is this machine, id/slug,
platform, status, note counts, last activity, and last sync. It fills from the
cached `machines.details(id)` synchronously, refreshes in place when
`machines.requestDetails(id)` resolves, and closes on Escape, outside
pointer-down, scroll, or selecting a machine.

The web layer dispatches:

```js
window.addEventListener("hasna:machine-context", (event) => event.detail)
window.addEventListener("hasna:machine-select", (event) => event.detail)
window.addEventListener("hasna:machine-details-request", (event) => event.detail)
window.addEventListener("hasna:machine-details", (event) => event.detail)
```

`hasna:machine-select` detail:

```js
{
  machineId: "studio-mac",
  machine: machineDetail,
  selectedNoteId: "note-id-or-null",
  reason: "sidebar" | "settings" | "details" | "native" | "api" | "move",
  view: window.PersonalNotes.view.state()
}
```

`window.PersonalNotes.view.state()` returns `{ screen, machineFilter, labelFilter,
statusFilter, selectedId, visibleNoteIds, selectedMachine }`.

Native refresh bridge:

```js
window.webkit.messageHandlers.notes.postMessage({
  action: "machineDetails",
  machine: "studio-mac",
  requestId: "machine-..."
});

window.PersonalNotes.machines.receiveDetails({
  requestId: "machine-...",
  machine: machineDetail
});
```

Details include manifest fields when present (`friendlyName`, `slug`/`id`,
`online`, `status`, `platform`, activity timestamps, `syncedAt`,
`capabilities`) and notes-derived fallbacks (`noteCount`, archive/trash counts,
`latestNoteUpdatedAt`). Machine attribution is informational: rows come from
the optional `~/.hasna/machines/machines.json` manifest (friendly names/slugs)
plus the `machine` frontmatter seen in notes — the manifest FILE is the only
discovery source (no external CLI fallback), and there is no fleet sync engine
behind the rows; notes travel via server sync only (see Sync Status).

A note's `machine` frontmatter records a STABLE identity, never a cosmetic
display name: `$PERSONALNOTES_MACHINE` override → `machine` in the sync client
config (`~/.config/personalnotes/config.json`) → short hostname. The Swift
shell (`Note.currentMachine`, also the boot `thisMachine`) and the JS lane
(`machineIdentity()` in tools/notes-lib.mjs) resolve identically. Friendly
names are display-layer: note rows and the editor meta line show the note's
own `machineFriendlyName`, else the machines list's friendly name for the
slug, else the raw slug.

## Sync Status

Server sync is owned by the `personalnotes` CLI (`personalnotes sync`, the
`sync --watch` daemon, and the shell app's background timer, which spawns the
same bundled CLI). The web layer only DISPLAYS the outcome — it never runs
sync itself.

- The boot/hydrate payload carries the `sync` object above; the host reads it
  from `<data-root>/sync-status.json` and hydrates after every scheduled run,
  so pulled notes appear without user action.
- Settings → Machines renders it in the `#sync-status-row` element:
  - `never` / missing → the off state with a pointer to
    `personalnotes auth device` + `personalnotes sync --install-service`.
  - `ok` → "Synced <relative time> · <server host>" (green dot).
  - `error` → "Sync failing — <error>. Last success <relative time>." (red
    dot). An error status MUST NEVER render as the green synced state — auth
    failures stay visible until a run succeeds.
- The web runtime exposes the raw snapshot:

```js
window.PersonalNotes.sync.status() // last boot/hydrate `sync` object, or null
```

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
window.PersonalNotes.recording.state()
window.PersonalNotes.recording.start()
window.PersonalNotes.recording.pause()
window.PersonalNotes.recording.resume()
window.PersonalNotes.recording.stop()
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
localStorage `personalnotes-theme`). On boot and on every change it reports the
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
persists the preference (UserDefaults `PersonalNotesThemePref`) so the next
launch paints the correct backing before the web layer boots. Browsers without
`window.webkit` skip the post — theme handling stays fully functional.

The native menu/status item controls the same recorder by evaluating:

```js
window.PersonalNotes.recording.start()
window.PersonalNotes.recording.pause()
window.PersonalNotes.recording.resume()
window.PersonalNotes.recording.stop()
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
