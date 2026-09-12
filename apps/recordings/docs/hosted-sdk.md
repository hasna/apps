# Hosted SDK

`@hasna/recordings/hosted` provides `HostedRecordingsClient` for hosted recording
metadata, account, paste-history and provider-catalog operations. The existing `./sdk` retains its
separate legacy API. This additive client neither translates legacy fields nor
records audio, opens a login browser, manages credentials or starts a speech
provider. Bun is the tested runtime; browser compatibility is not claimed.

```ts
import { HostedRecordingsClient, recordingCursor } from "@hasna/recordings/hosted";

const client = new HostedRecordingsClient({
  apiBase: configuration.completeV1Base,
  credentialProvider: ({ apiBase, signal }) => session.accessTokenFor(apiBase, signal),
});
const { recordings } = await client.listRecordings({ limit: 25 });
if (recordings.length === 25) {
  const next = await client.listRecordings({ limit: 25, ...recordingCursor(recordings.at(-1)!) });
}
```

The caller supplies a complete API base ending in `/v1`, including any prefix.
Remote bases require HTTPS; HTTP requires an explicit exact loopback address.
The client has no default endpoint or ambient environment, disk or Keychain
credential lookup. Public `health()` and `version()` never request credentials;
all other methods request a fresh caller-supplied Bearer credential. Injected
`fetch` is trusted and must honor manual redirects and AbortSignal. No request
follows a redirect, sends cookies or retries automatically.

`bootstrap()` sends an empty object; the server derives account/profile authority
from the authenticated session. `account()` reads that account and `ready()`
checks authenticated readiness. The caller owns OAuth, refresh and credential
storage. `logout()` revokes the current server session family; the caller must
also clear its stored credentials.

`listRecordings`, `getRecording`, `saveRecording` and `renameRecording` use
camelCase values: `id`, optional `sessionId`, `title`, `transcript`, and
`durationMs`. Duration is milliseconds. `deleteRecording` returns
`{state:'pending'}` for accepted cleanup or `{state:'removed'}` for completed
deletion. Pending is not proof that audio has been purged. Repeat explicitly;
reads may return the `recording_deleted` error after a permanent tombstone.

`listPasteReceipts`, `savePasteReceipt`, `deletePasteReceipt` and
`clearPasteHistory` use the hosted paste contract. An input `occurredAt` must be
UTC ending in `Z`; omit it for server time. `client_reported` receipt evidence
does not mean the server observed the target. Empty text remains valid when
retention is disabled. Recordings and receipts can contain private text; callers
should avoid logging responses.

Both lists require `before` and `beforeId` together or neither. `recordingCursor`
selects the last row's `createdAt` and ID; `pasteCursor` selects its `occurredAt`
and ID. There is no inferred total or automatic pagination. A full page can be
the last page. Inputs are validated before credentials or fetch; future JSON
response fields are preserved by the low-level recording/account operations; the
provider catalog projects only its public fields. Advertised metadata must include a compatible
version and all required capabilities; entirely absent metadata remains legacy
compatible. This is stricter than an older hosted adapter that accepted empty
capability advertisements.

The default 20-second deadline includes credential acquisition and the entire
response body. Caller cancellation has the same scope. Encoded JSON requests
are limited to 1 MiB before credentials are requested. Responses are limited to
4 MiB of decoded bytes by default, configurable from 1 KiB to 32 MiB; compressed
wire Content-Length is not compared with decoded size. The transport bounds its
growing buffer, not total process memory. Error bodies are cancelled unread.

`RecordingsSDKError` contains a fixed code/message and optional HTTP status and
validated UUID request ID. It retains no body, endpoint, token, server message or
original cause. A timed-out mutation may already have committed: reconcile using
the known recording or receipt ID instead of blindly retrying. This JSON client
does not implement audio upload/download, WebSocket sessions, native app control,
tenant storage, usage admission or provider execution.

## Hosted Library across interfaces

The additive `HostedLibrary` adapter provides `list`, `get`, `rename` and `delete`
operations through CLI, MCP, serve and SDK. `HostedPasteHistory` provides a
read-only receipt page across the same interfaces. Library output includes only `id`, `title`,
`createdAt` and `durationMs`; `transcript` requires an explicit option. Unknown
upstream fields are omitted. Metadata can itself be private. The upstream
currently returns transcript text before projection, so this minimizes output
rather than implementing server-side redaction.

The CLI always emits JSON. Configure a complete API base and the **name** of an
environment variable containing that API's existing bearer session:

```sh
recordings --json hosted --api-base "$MY_RECORDINGS_API_BASE" --credential-env MY_RECORDINGS_SESSION list --limit 25
recordings hosted --api-base "$MY_RECORDINGS_API_BASE" --credential-env MY_RECORDINGS_SESSION get <recording-id> --include-text
recordings hosted --api-base "$MY_RECORDINGS_API_BASE" --credential-env MY_RECORDINGS_SESSION rename <recording-id> "New title"
recordings hosted --api-base "$MY_RECORDINGS_API_BASE" --credential-env MY_RECORDINGS_SESSION delete <recording-id>
```

The named variable is read fresh per request. No token argument, implicit API
base, local-store fallback, provider-key lookup, Keychain lookup or credential
persistence is added. The caller supplies the existing session. Legacy commands
and their transport configuration are unchanged.

Rename trims the title and requires 1–200 characters. Its response contains
recording metadata without transcript text. Delete is an explicit permanent
mutation, following the existing CLI's direct `delete <id>` convention.
It returns `{state: "pending"}` when durable deletion was accepted but audio
cleanup is unfinished, or `{state: "removed"}` when cleanup completed.
Neither state triggers another request. A pending result is not proof of a
completed audio purge; the caller may explicitly repeat the deletion later.

A full page returns `nextCursor: {before, beforeId}`; supply both with `--before`
and `--before-id`. A cursor permits another request without promising another
row. There is no offset, inferred total, extra count request or automatic
pagination. Limits are 1–100, default 25.

```sh
recordings-mcp --hosted --stdio --api-base "$MY_RECORDINGS_API_BASE" --credential-env MY_RECORDINGS_SESSION
```

This explicit mode exposes `recordings_hosted_list`, `recordings_hosted_get` and
`recordings_hosted_paste_history` for these reads; each accepts `includeText: true`.
The read-only `recordings_hosted_providers` tool accepts no arguments.
`recordings_hosted_rename` accepts `{id, title}` and
`recordings_hosted_delete` accepts `{id}`. Both are marked as destructive mutations
because rename replaces metadata and delete removes data. Rename is not marked
idempotent because the service can update its modification timestamp on each
request. Delete is resumable and marked idempotent. Their results match the CLI and SDK.
Stdio is required so the selected session cannot be shared through the legacy
MCP HTTP listener. Legacy MCP mode is unchanged.

```sh
recordings-serve --hosted --api-base "$MY_RECORDINGS_API_BASE" --port 8874
```

The proxy binds to `127.0.0.1` by default; only `127.0.0.1` and `::1`
are accepted. It supports `GET /v1/recordings`, `GET /v1/recordings/<id>` and
`GET /v1/paste-history` and `GET /v1/providers`.
Both list routes accept `limit`, `before`, `beforeId` and `includeText=true|false`; get
accepts only `includeText`. The providers route accepts no query parameters.
`PATCH /v1/recordings/<id>` accepts only a JSON `{title}` body and returns
metadata. The body has an 8 KiB limit and a five-second read deadline.
`DELETE /v1/recordings/<id>` accepts no body. It preserves the hosted service's
`202 {audioCleanup: {state: "pending"}}` or empty `204` response. Both mutation
routes reject query parameters. Every request supplies its own
`Authorization: Bearer <session>` header. Process credentials are never used,
and a request cannot choose the upstream authority. Cookies, browser Origin
headers, other mutation routes and unknown query fields are refused. Responses are
not cached. `/health` describes the proxy process only. Legacy serve mode and
its database/auth configuration are unchanged.

The `./sdk` entry adds the hosted exports while retaining its generated legacy
client. Its generator updates only `v1.generated.ts`:

```ts
import { HostedRecordingsClient, HostedLibrary } from "@hasna/recordings/sdk";
const library = new HostedLibrary(new HostedRecordingsClient({
  apiBase: configuration.completeV1Base,
  credentialProvider: ({ apiBase, signal }) => session.accessTokenFor(apiBase, signal),
}));
const page = await library.list({ limit: 25 });
const detail = await library.get(recordingId, { includeText: true });
const renamed = await library.rename(recordingId, "New title");
const deletion = await library.delete(recordingId); // pending or removed, never retried automatically
```

The existing hosted transport supplies validation, prefix preservation,
credential/origin isolation, redirect refusal, cancellation, deadlines and
response-size bounds. SDK callers can configure those bounds. Wrapper failures
expose fixed codes/messages without response bodies, credentials or arbitrary
causes. This addition does not implement sign-in, refresh, recording uploads, microphone
control, audio transfer or transcription; those hosted parity gates remain
separate.

### Hosted paste history

```sh
recordings hosted --api-base "$MY_RECORDINGS_API_BASE" --credential-env MY_RECORDINGS_SESSION paste-history --limit 25
```

`HostedPasteHistory.list()` and the matching CLI, MCP and HTTP operation return
`{receipts, nextCursor}`. Each receipt includes `id`, nullable `recordingId`,
`occurredAt`, optional `destinationAppId` and `destinationAppName`, `status` and
`evidenceSource`. Status remains `attempted`, `confirmed` or `failed`; evidence
remains `client_reported`. A confirmed client report does not mean the server
observed delivery to the target app.

Private pasted text is omitted unless `--include-text`, MCP `includeText: true`,
or HTTP `includeText=true` is supplied. Explicit inclusion preserves an empty
string when retained text is empty. Unknown upstream fields are omitted.
Destination metadata can itself be private; avoid logging responses. The API
currently returns text before projection, so omission minimizes output rather
than providing server-side redaction.

Pagination uses `occurredAt` plus the receipt ID. Supply the returned `before`
and `beforeId` together; CLI uses `--before` and `--before-id`. Limits are 1–100,
default 25. A full page permits another request without promising more rows.
No offset, total, extra request, automatic pagination or retry is introduced.
The existing selected-authority, per-request credentials, cancellation, deadline,
redirect-refusal and fixed-error behavior is shared with Library reads.

```ts
import { HostedPasteHistory, HostedRecordingsClient } from "@hasna/recordings/sdk";
const history = new HostedPasteHistory(new HostedRecordingsClient({
  apiBase: configuration.completeV1Base,
  credentialProvider: ({ apiBase, signal }) => session.accessTokenFor(apiBase, signal),
}));
const page = await history.list({ limit: 25 });
```

The same class and its option, receipt and page types are exported from
`@hasna/recordings/hosted`. This read operation neither creates/deletes receipts
nor controls an app or attempts a paste.

### Transcription provider catalog

`HostedRecordingsClient.providers()` reads the selected API's `/providers`
catalog. It shares the authenticated transport above and returns only public
provider capabilities: `id`, `models`, `formats`, `execution`, `interim`,
`cancellation`, `languageSelection`, `requiresAccount` and `ready`. New servers
also provide optional `defaultProvider`, provider `name`, `defaultModel`,
`modelDetails: [{id, name, task: 'transcription'}]` and
`transcriptionMode: 'realtime' | 'segmented'`. Missing legacy fields remain
absent; clients must not infer the first provider/model as the default.
Unknown fields are omitted at every catalog level. Readiness is a server
report, not a live transcription test. The client makes no provider request.
Catalogs require nonempty lists of at most 16 providers, 64 models per provider
and 16 formats, unique provider and model IDs, defaults that belong to the
advertised lists, and complete model details when supplied. Discovery model IDs
are ASCII identifiers of 1–100 characters: an alphanumeric first character,
then alphanumerics or `._:/@+-`. Labels are at most 120 UTF-16 code units and
cannot contain Unicode control/format characters or consist only of whitespace.
Cancellation must be supported, and formats must include 24 kHz mono PCM16.
Invalid catalogs fail instead of presenting ambiguous choices.
Although the service exposes discovery publicly, these hosted client surfaces
require the caller's configured bearer, consistently with the other hosted reads.

```sh
recordings hosted --api-base "$MY_RECORDINGS_API_BASE" --credential-env MY_RECORDINGS_SESSION providers
```

The same read is available as MCP `recordings_hosted_providers` and proxy
`GET /v1/providers`, with no filters, provider endpoint, credential or model
overrides. `HostedProvidersResponse`, `HostedTranscriptionProvider` and
`HostedTranscriptionModel` types are exported from both `./sdk` and `./hosted`.

The shared `./contracts/stream-v1` contract adds optional `provider` to
`session.start`, alongside existing optional `model`. Provider IDs are lowercase
slugs of at most 64 characters; models remain bounded to 100 characters and can
include qualified names such as `vendor/model`. The server resolves omitted
defaults and validates configured provider/model membership. Send a provider
only when `/version` advertises `PROVIDER_SELECTION_CAPABILITY`
(`provider-selection`). It is optional and does not change the four required
capabilities, so older servers remain compatible. This client still does not
open streaming sessions or implement provider execution.
