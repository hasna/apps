import { expect, test } from "bun:test";
import {
  HostedRecordingsClient,
  RecordingsSDKError,
  type HostedAudioMetadata,
} from "../hosted/index.js";
import {
  MAX_AUDIO_BYTES,
  WAV_HEADER_BYTES,
  audioMetadataParser,
} from "../contracts/audio-v1.js";

const base = "https://fictional.example.test/recordings/v1/";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const at = "2026-09-07T10:00:00Z";
const pcm = new Uint8Array(4_800);
const wav = (() => {
  const bytes = new Uint8Array(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  bytes.set(new TextEncoder().encode("fmt "), 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, pcm.byteLength, true);
  bytes.set(pcm, WAV_HEADER_BYTES);
  return bytes;
})();
const available: HostedAudioMetadata = {
  state: "available",
  format: { encoding: "pcm_s16le", sampleRate: 24_000, channels: 1, bitsPerSample: 16 },
  byteLength: wav.byteLength,
  pcmBytes: pcm.byteLength,
  durationMs: 100,
  sha256: sha,
  storedAt: at,
  expiresAt: "2026-09-14T10:00:00Z",
};
const unavailable: HostedAudioMetadata = { state: "unavailable", reason: "not_stored_or_expired" };
const fakeFetch = (body: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  (async (url, init) => body(String(url), init ?? {})) as typeof fetch;

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
}

test("audio metadata parser accepts available and unavailable wire states and rejects mismatched descriptors", () => {
  expect(audioMetadataParser.parse(available)).toEqual(available);
  expect(audioMetadataParser.parse(unavailable)).toEqual(unavailable);
  expect(audioMetadataParser.parse({
    ...available,
    byteLength: WAV_HEADER_BYTES + 2,
    pcmBytes: 2,
    durationMs: 2 / 48,
  })).toMatchObject({ byteLength: 46, pcmBytes: 2, durationMs: 2 / 48 });
  expect(audioMetadataParser.safeParse({ ...available, pcmBytes: 2 }).success).toBe(false);
  const additive = audioMetadataParser.parse({ ...available, futureDescriptorField: "ignored", format: { ...available.format, futureFormatField: "ignored" } });
  expect(Object.hasOwn(additive, "futureDescriptorField")).toBe(false);
  expect(Object.hasOwn(additive.format, "futureFormatField")).toBe(false);
  expect(audioMetadataParser.safeParse({ ...available, byteLength: 47, pcmBytes: 3 }).success).toBe(false);
  expect(audioMetadataParser.safeParse({ ...available, expiresAt: at }).success).toBe(false);
  expect(audioMetadataParser.safeParse({ ...available, format: { ...available.format, sampleRate: 16_000 } }).success).toBe(false);
  expect(audioMetadataParser.safeParse({ ...unavailable, reason: "deleted" }).success).toBe(false);
});

test("upload uses one authenticated raw WAV PUT with exact consent, length and digest headers", async () => {
  let calls = 0;
  const body = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
  const client = new HostedRecordingsClient({
    apiBase: base,
    credentialProvider: () => "fictional-access",
    fetch: fakeFetch(async (url, init) => {
      calls++;
      expect(url).toBe(base.slice(0, -1) + "/recordings/" + id + "/audio");
      expect(init.method).toBe("PUT");
      expect(init.redirect).toBe("manual");
      expect(init.credentials).toBe("omit");
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer fictional-access");
      expect(headers.get("content-type")).toBe("audio/wav");
      expect(headers.get("content-length")).toBe(String(wav.byteLength));
      expect(headers.get("x-audio-sha256")).toBe(sha);
      expect(headers.get("x-audio-retention-consent")).toBe("true");
      expect(headers.has("content-encoding")).toBe(false);
      expect(await new Response(init.body).arrayBuffer()).toEqual(body);
      return Response.json(available);
    }),
  });
  expect(await client.uploadAudio(id, { body, byteLength: wav.byteLength, sha256: sha, retainAudio: true })).toEqual(available);
  expect(calls).toBe(1);
});

test("upload validates size, parity, digest, consent and body before credentials or fetch", async () => {
  let calls = 0;
  let credentials = 0;
  const client = new HostedRecordingsClient({
    apiBase: base,
    credentialProvider: () => { credentials++; return "fictional-access"; },
    fetch: fakeFetch(() => { calls++; return Response.json(available); }),
  });
  const body = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
  const cases = [
    { body, byteLength: WAV_HEADER_BYTES, sha256: sha, retainAudio: true as const },
    { body, byteLength: wav.byteLength + 1, sha256: sha, retainAudio: true as const },
    { body, byteLength: wav.byteLength, sha256: "bad", retainAudio: true as const },
    { body, byteLength: wav.byteLength, sha256: sha, retainAudio: false as never },
    { body: "private audio" as never, byteLength: wav.byteLength, sha256: sha, retainAudio: true as const },
    { body, byteLength: MAX_AUDIO_BYTES + 1, sha256: sha, retainAudio: true as const },
  ];
  for (const value of cases) await expect(client.uploadAudio(id, value)).rejects.toMatchObject({ code: "invalid_input" });
  await expect(client.uploadAudio("../private", { body, byteLength: wav.byteLength, sha256: sha, retainAudio: true })).rejects.toMatchObject({ code: "invalid_input" });
  expect(credentials).toBe(0);
  expect(calls).toBe(0);
});

test("metadata and download preserve the raw stream and validate full-file and range response headers", async () => {
  let calls = 0;
  const client = new HostedRecordingsClient({
    apiBase: base,
    credentialProvider: () => "fictional-access",
    fetch: fakeFetch((url, init) => {
      calls++;
      const requestURL = new URL(url);
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer fictional-access");
      if (requestURL.pathname.endsWith("/metadata")) return Response.json(available);
      expect(headers.get("range")).toBe("bytes=44-99");
      return new Response(wav.slice(44, 100), {
        status: 206,
        headers: {
          "content-type": "audio/wav",
          "content-length": "56",
          "accept-ranges": "bytes",
          "content-range": "bytes 44-99/4844",
          "x-audio-sha256": sha,
        },
      });
    }),
  });
  expect(await client.getAudioMetadata(id)).toEqual(available);
  const response = await client.downloadAudio(id, "bytes=44-99");
  expect(response.status).toBe(206);
  expect(response.byteLength).toBe(56);
  expect(response.sha256).toBe(sha);
  expect(response.range).toEqual({ start: 44, end: 99, total: 4_844 });
  expect(await new Response(response.body).arrayBuffer()).toEqual(wav.slice(44, 100).buffer);
  expect(calls).toBe(2);
});

test("download refuses malformed content type, digest, lengths, ranges and unsupported status without consuming body", async () => {
  const responses = [
    new Response(wav, { headers: { "content-type": "application/json", "content-length": String(wav.byteLength), "accept-ranges": "bytes", "x-audio-sha256": sha } }),
    new Response(wav, { headers: { "content-type": "audio/wav", "content-length": String(wav.byteLength), "accept-ranges": "bytes", "x-audio-sha256": "bad" } }),
    new Response(wav, { headers: { "content-type": "audio/wav", "content-length": String(wav.byteLength + 1), "accept-ranges": "bytes", "x-audio-sha256": sha } }),
    new Response(wav.slice(44, 100), { status: 206, headers: { "content-type": "audio/wav", "content-length": "56", "accept-ranges": "bytes", "content-range": "bytes 44-100/4844", "x-audio-sha256": sha } }),
    new Response(wav.slice(44, 100), { status: 206, headers: { "content-type": "audio/wav", "content-length": "56", "accept-ranges": "bytes", "content-range": "bytes 44-99/4845", "x-audio-sha256": sha } }),
    new Response(wav, { status: 302, headers: { location: "https://other.example.test/v1/recordings/" + id + "/audio" } }),
  ];
  for (const [index, response] of responses.entries()) {
    const client = new HostedRecordingsClient({
      apiBase: base,
      credentialProvider: () => "fictional-access",
      fetch: fakeFetch(() => response),
    });
    if (index === 2) {
      const downloaded = await client.downloadAudio(id);
      await expect(new Response(downloaded.body).arrayBuffer()).rejects.toBeInstanceOf(RecordingsSDKError);
    } else {
      await expect(client.downloadAudio(id)).rejects.toBeInstanceOf(RecordingsSDKError);
    }
  }
  const client = new HostedRecordingsClient({
    apiBase: base,
    credentialProvider: () => "fictional-access",
    fetch: fakeFetch(() => new Response(wav, {
      headers: { "content-type": "audio/wav", "content-length": String(wav.byteLength), "accept-ranges": "bytes", "x-audio-sha256": sha },
    })),
  });
  await expect(client.downloadAudio(id, "bytes=0-1,2-3")).rejects.toMatchObject({ code: "invalid_input" });
  const rangeClient = new HostedRecordingsClient({
    apiBase: base,
    credentialProvider: () => "fictional-access",
    fetch: fakeFetch(() => new Response(null, { status: 416 })),
  });
  await expect(rangeClient.downloadAudio(id, "bytes=999999-")).rejects.toMatchObject({ code: "range_not_satisfiable", status: 416 });
});

test("audio transport retains caller cancellation through response body consumption and never retries", async () => {
  let calls = 0;
  let cancelled = 0;
  const gate = new Promise<Response>(() => {});
  const client = new HostedRecordingsClient({
    apiBase: base,
    timeoutMs: 30,
    credentialProvider: () => "fictional-access",
    fetch: fakeFetch(() => { calls++; return gate; }),
  });
  await expect(client.downloadAudio(id)).rejects.toMatchObject({ code: "timeout" });
  expect(calls).toBe(1);

  const controller = new AbortController();
  const stalled = new Response(new ReadableStream({
    start(streamController) { streamController.enqueue(wav); },
    cancel() { cancelled++; },
  }), {
    headers: { "content-type": "audio/wav", "content-length": String(wav.byteLength), "accept-ranges": "bytes", "x-audio-sha256": sha },
  });
  const request = new HostedRecordingsClient({
    apiBase: base,
    credentialProvider: () => "fictional-access",
    fetch: fakeFetch(() => stalled),
  }).downloadAudio(id, { signal: controller.signal });
  const response = await request;
  controller.abort();
  await expect(new Response(response.body).arrayBuffer()).rejects.toMatchObject({ name: "RecordingsSDKError", code: "aborted" });
  expect(cancelled).toBeGreaterThanOrEqual(1);
});

test("upload and client methods keep private body data out of SDK errors", async () => {
  const privateMarker = "FICTIONAL_PRIVATE_AUDIO_MARKER";
  const client = new HostedRecordingsClient({
    apiBase: base,
    credentialProvider: () => "fictional-access",
    fetch: fakeFetch(() => new Response(privateMarker, { status: 500 })),
  });
  let error: unknown;
  try {
    await client.uploadAudio(id, { body: wav, byteLength: wav.byteLength, sha256: sha, retainAudio: true });
  } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(RecordingsSDKError);
  expect(String(error)).not.toContain(privateMarker);
  expect(JSON.stringify(error)).not.toContain(privateMarker);
});
