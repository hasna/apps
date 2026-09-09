# Notes SaaS wire contract, v1

The public browser binding (`@hasna/notes/sdk/browser`) and Swift companion
(`NotesLib`) accept a **complete API base**, for example
`https://notes.example.com/api/v1/` or `https://notes.example.com/v1/`.
Neither adds, removes or replaces version path components. HTTPS is required;
explicitly enabled loopback HTTP is available for tests. Credentials are injected
per request by the consuming application. No environment, disk, Keychain, default
fleet authority, cookie, CLI or database is consulted by these explicit bindings.
The existing Node `./sdk` and command surfaces retain their fleet resolver.

Requests use Bearer authentication, JSON bodies, bounded JSON responses and no
authenticated redirects. Cancellation propagates to the network operation.
Credentials are never included in error objects. 401/403 bodies are discarded.
Clients do not retry mutations automatically: retain an idempotency key for a
retry of the exact original request, and use a new key for changed intent.

## Data and routes

`sdk/browser.d.mts` declares the wire types; `sdk/wire-v1.schema.json` defines the
versioned response schema and `sdk/fixtures/wire-v1.json` is the cross-language
conformance fixture. Note fields use camelCase. Dates are RFC3339 UTC strings;
sequence values and cursors are opaque strings, never floating-point numbers.
Preserve Markdown byte content, frontmatter, historical folders and archive flags.

All paths below are relative to the configured API base:

| Method | Path | Request / response |
| --- | --- | --- |
| GET | notes | limit (1–200), cursor, include_deleted=1, label, search → `{data,nextCursor,hasMore}` |
| GET | notes/:id | active note; deleted or unknown → 404 |
| POST | notes | NoteInput → Note (201) |
| PATCH | notes/:id | partial NoteInput plus baseRevision → Note |
| DELETE | notes/:id | optional `{baseRevision}` → `{deleted:true,id,revision}` |
| POST | notes/:id/restore | optional `{baseRevision}` → restored Note |
| GET | changes | cursor, limit (1–200) → `{changes,cursor,hasMore}` |
| GET | labels | `{data:[{name,count}]}` |
| PATCH | labels/:label | `{name}` → `{updated}` across tenant notes |
| DELETE | labels/:label | `{updated}`; removes assignment, preserves notes |
| POST | export | `{exportId,notes}` including all recoverable notes |

List ordering is stable by immutable creation time plus ID, newest first. The
cursor includes the initial upper bound and filters; changing filters starts a
new traversal. It is never an offset. Concurrent additions are discovered by
refresh/change feed. A library load must consume every page, including empty
pages with a continuation. A partial fetch must never be shown as a complete
empty library. `nextCursor=null` and `hasMore=false` terminate the traversal.

The change feed is ascending by tenant mutation sequence, allocated under a
transactional tenant lock held through commit. Every mutation path contributes,
including restore, label changes and legacy sync. Each entry contains its note
snapshot or a permanent-delete tombstone; soft-deleted snapshots retain
`deletedAt`. `cursor` acknowledges exactly the last returned sequence, and does
not advance to wall-clock time. More than 100 changes, concurrent commits and
rolled-back writes must not skip notes. Repeated pages may be applied idempotently.

Mutation `baseRevision` is checked atomically with the write. A stale revision
returns 409 `{error:{code:"revision_conflict",message,details:{current:Note}}}`;
it never silently overwrites. Missing preconditions remain accepted for legacy
clients, but both new bindings send revisions when editing loaded notes.
`Idempotency-Key` (1–128 ASCII letters/digits or `._:-`) is scoped to tenant and
operation, and is recorded in the same transaction as the result. A repeated
key/body returns the original response; changed body returns 409
`idempotency_conflict`. Concurrent repeats cannot create duplicate notes.

## Compatibility and rollout

The SaaS service preserves `/api/v1` and adds `/v1` with the same authentication,
authorization, validation, data and errors. Legacy consumers may ignore additive
page fields. The existing Node resolver continues selecting its documented `/v1`
base; a product must provide its own explicit authority and credential together.
Timestamp-based legacy sync cursors trigger a full safe feed replay and return
the new opaque cursor, rather than interpreting a timestamp as a sequence.

New bindings may be released before every reference server supports these
additive operations. Deploy the corresponding service changes before switching
customer clients. Package publication, real HTTP conformance, SaaS deployment,
and final native customer acceptance are separate release gates.

## Independent consumers

```ts
import { NotesClient } from '@hasna/notes/sdk/browser';

const notes = new NotesClient({
  apiBase: 'https://notes.example.com/api/v1/',
  credential: () => currentSession.accessToken,
});
const page = await notes.list({ limit: 200 });
```

`swift/Package.swift` in the same npm archive exports `NotesLib`. Resolve and
verify the immutable npm archive before adding its `swift` directory as a
SwiftPM path dependency; do not copy its transport sources into the product.
Link only the `NotesLib` library product. The conformance executable under
`swift/Tests` is development tooling and is not installed with a customer app.
It uses Foundation so the fixture suite also runs with macOS Command Line Tools.

```swift
import NotesLib

let notes = try NotesClient(apiBase: URL(string: "https://notes.example.com/api/v1/")!) {
    try sessionStore.readCredential()
}
let page = try await notes.list(limit: 200)
```

Run `bun test test/browser-sdk.test.mjs`, `bun run test:sdk-types`, and
`bun run test:swift-sdk` from the package directory. Swift conformance starts
an isolated loopback fixture server and fails if any authenticated redirect
reaches its credential trap. The test fixture contains fictional accounts only.
