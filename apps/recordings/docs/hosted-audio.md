# Hosted recording audio

The hosted SDK exposes audio through the same /v1 authority and bearer
credential as metadata operations:

- GET /recordings/:id/audio/metadata returns either an available object with
  state, format, byteLength, pcmBytes, durationMs, sha256, storedAt, and
  expiresAt, or an unavailable object with reason not_stored_or_expired.
- PUT /recordings/:id/audio accepts a raw audio/wav body. The client sends
  Content-Length, x-audio-sha256, and x-audio-retention-consent: true; the
  caller must explicitly set retainAudio: true.
- GET /recordings/:id/audio returns a bounded raw stream with status 200 or 206.
  A range request uses one bytes=... range. The response includes
  Content-Length, Accept-Ranges: bytes, x-audio-sha256, and, for 206,
  Content-Range.

Audio is canonical mono PCM16 WAV at 24 kHz. The maximum PCM payload is
86,400,000 bytes (30 minutes), plus the 44-byte WAV header. The SDK does not
JSON encode or base64 encode audio and does not retry requests. Download
consumers own the destination stream and should verify the returned digest
while writing.

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

Metadata and download are authenticated reads. Uploads are authenticated
writes and are surfaced only where the adapter's explicit write gate is
enabled.
