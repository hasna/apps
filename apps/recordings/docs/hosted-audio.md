# Hosted recording audio

Hosted audio uses the same `/v1/` authority and bearer session as hosted
recording metadata. Audio is canonical mono PCM16 WAV at 24 kHz. The maximum
PCM payload is 86,400,000 bytes (30 minutes), plus the 44-byte WAV header.
Audio stays a raw stream: the SDK, CLI, MCP server, and HTTP proxy do not put
audio in JSON or base64, and transfer requests are never retried.
On the supported Bun runtime, uploads disable connection reuse so an early server refusal cannot leave the
next request waiting on that transfer. Cancelling a download aborts its network
request as well as its reader.

The shared client exposes these operations:

- `GET /v1/recordings/:id/audio/metadata` returns either an `available` object
  with `format`, `byteLength`, `pcmBytes`, `durationMs`, `sha256`, `storedAt`,
  and `expiresAt`, or `unavailable` with reason `not_stored_or_expired`.
  SHA-256 values in the public contract are lowercase hexadecimal.
- `PUT /v1/recordings/:id/audio` accepts a raw `audio/wav` body. The client
  sends `Content-Length`, `x-audio-sha256`, and
  `x-audio-retention-consent: true`; callers must explicitly set
  `retainAudio: true`.
- `GET /v1/recordings/:id/audio` returns a bounded raw stream with status 200
  or 206. A range request uses one `bytes=...` range. The response includes
  `x-audio-byte-length`, `Accept-Ranges: bytes`, `x-audio-sha256`, and, for 206,
  `Content-Range`. The byte-length header describes this response body, including
  only the selected span for a range. `Content-Length` is retained when the HTTP
  server supports it for streaming bodies. Clients accept either size header,
  require them to agree when both are present, and verify the exact streamed
  byte count within the configured maximum. This also supports chunked responses
  without buffering the recording or an extra metadata request.

Upload cleanup is awaited through the operation deadline. A caller-provided
`ReadableStream` controls its own `cancel()` callback; JavaScript cannot
force-close a callback that never settles. In that case the SDK returns a
`timeout` after the deadline, while preserving an earlier transport error.

The CLI reads and writes explicit regular files. Upload and download commands
are available under hosted mode:

~~~sh
recordings hosted audio-metadata RECORDING_ID
recordings hosted audio-upload RECORDING_ID --input recording.wav --retain-audio
recordings hosted audio-download RECORDING_ID --output recording-copy.wav
~~~

CLI downloads request the complete file so the destination can be checked
against the returned SHA-256. Existing input and output paths are refused; an
output file is published only after the complete stream and digest have been
verified.

The hosted MCP server always exposes `recordings_hosted_audio_metadata` with
`{id}`. Binary tools are exposed only when startup includes both
`--allow-writes` and an existing real `--audio-directory`:

~~~text
recordings-mcp --hosted --stdio --allow-writes --audio-directory ./audio \
  --api-base https://api.example.test/recordings/v1/ \
  --credential-env RECORDINGS_SESSION
~~~

`recordings_hosted_audio_upload` takes `{id, fileName, retainAudio: true}` and
`recordings_hosted_audio_download` takes `{id, fileName}`. Each file name is a
single basename in the configured directory. Symlinks, traversal, and existing
download destinations are refused. MCP download results contain the basename,
byte length, SHA-256, and status; they do not return an absolute path or audio
bytes.

The HTTP proxy exposes the same metadata and raw audio routes. Its upload
route requires the server's explicit `--allow-writes` startup option. Proxy
requests preserve the caller's bearer session, use manual redirects, and map
an upstream unsatisfiable range to HTTP 416.

~~~ts
const metadata = await client.getAudioMetadata(recordingId);
const upload = await client.uploadAudio(recordingId, {
  body: wavBytes,
  byteLength: wavBytes.byteLength,
  sha256: wholeFileSha256,
  retainAudio: true,
});
const download = await client.downloadAudio(recordingId);
await download.body.pipeTo(destination);
~~~
