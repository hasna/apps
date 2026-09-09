# Hosted SDK

`@hasna/recordings/hosted` provides `HostedRecordingsClient` for hosted recording
metadata, account and paste-history operations. The existing `./sdk` retains its
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
response fields are preserved. Advertised metadata must include a compatible
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
