import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostedRecordingsClient } from "../hosted/index.js";
import { prepareAudioUpload } from "../hosted/audio-files.js";
import { runHostedCLI } from "../cli/hosted.js";
import { buildHostedServer } from "../mcp/hosted.js";
import { buildHostedFetch } from "../server/hosted.js";

const base = "https://fictional.example.test/recordings/v1/";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const at = "2026-09-07T10:00:00Z";
function wavFixture(): Uint8Array {
  const pcm = new Uint8Array(4_802);
  const bytes = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  bytes.set(new TextEncoder().encode("fmt "), 12);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36); view.setUint32(40, pcm.byteLength, true);
  bytes.set(pcm, 44);
  return bytes;
}
const wav = wavFixture();
const sha = createHash("sha256").update(wav).digest("hex");
const metadata = {
  state: "available" as const,
  format: { encoding: "pcm_s16le" as const, sampleRate: 24_000 as const, channels: 1 as const, bitsPerSample: 16 as const },
  byteLength: wav.byteLength, pcmBytes: 4_802, durationMs: 4_802 / 48,
  sha256: sha, storedAt: at, expiresAt: "2026-09-14T10:00:00Z",
};
const fakeFetch = (body: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  (async (url, init) => body(String(url), init ?? {})) as typeof fetch;
function clientFixture(calls: Array<{ method: string; url: string; body?: Uint8Array }>) {
  return new HostedRecordingsClient({
    apiBase: base,
    credentialProvider: () => "fictional-access",
    fetch: fakeFetch(async (url, init) => {
      const method = String(init.method);
      const headers = new Headers(init.headers);
      calls.push({ method, url, body: init.body ? new Uint8Array(await new Response(init.body).arrayBuffer()) : undefined });
      expect(headers.get("authorization")).toBe("Bearer fictional-access");
      if (url.endsWith("/audio/metadata")) return Response.json(metadata);
      if (method === "PUT") return Response.json(metadata);
      return new Response(wav, { headers: {
        "content-type": "audio/wav", "content-length": String(wav.byteLength),
        "accept-ranges": "bytes", "x-audio-sha256": sha,
      } });
    }),
  });
}

test("CLI metadata/upload/download use explicit files, raw bytes, SHA verification and preserve outputs", async () => {
  const root = mkdtempSync(join(tmpdir(), "recordings-audio-cli-"));
  const source = join(root, "source.wav");
  const destination = join(root, "download.wav");
  const existing = join(root, "existing.wav");
  writeFileSync(source, wav);
  writeFileSync(existing, Buffer.from("preserve"));
  const calls: Array<{ method: string; url: string; body?: Uint8Array }> = [];
  const output: string[] = [];
  try {
    const options = { client: clientFixture(calls), write: (value: string) => output.push(value) };
    const connection = ["--api-base", base, "--credential-env", "SELECTED_SESSION"];
    expect(await runHostedCLI([...connection, "audio-metadata", id], options)).toBe(0);
    expect(JSON.parse(output.pop()!)).toEqual(metadata);
    expect(await runHostedCLI([...connection, "audio-upload", id, "--input", source, "--retain-audio"], options)).toBe(0);
    expect(JSON.parse(output.pop()!)).toEqual(metadata);
    expect(calls.at(-1)?.method).toBe("PUT");
    expect(calls.at(-1)?.body).toEqual(wav);
    expect(await runHostedCLI([...connection, "audio-download", id, "--output", destination], options)).toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({ byteLength: wav.byteLength, sha256: sha, status: 200 });
    expect(new Uint8Array(readFileSync(destination))).toEqual(wav);
    expect(statSync(destination).mode & 0o777).toBe(0o600);
    const before = calls.length;
    expect(await runHostedCLI([...connection, "audio-download", id, "--output", existing], options)).toBe(1);
    expect(calls.length).toBe(before);
    expect(readFileSync(existing, "utf8")).toBe("preserve");
    expect(await runHostedCLI([...connection, "audio-upload", id, "--input", source], options)).toBe(1);
    const linked = join(root, "linked.wav"); symlinkSync(source, linked);
    expect(await runHostedCLI([...connection, "audio-upload", id, "--input", linked, "--retain-audio"], options)).toBe(1);
    const missingParent = join(root, "missing", "download.wav");
    expect(await runHostedCLI([...connection, "audio-download", id, "--output", missingParent], options)).toBe(1);
    expect(calls.length).toBe(before);
    expect(output.join("")).not.toContain("preserve");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("early upload waits for delayed cancellation of an actual fd-backed source and keeps the primary error", async () => {
  const root = mkdtempSync(join(tmpdir(), "recordings-audio-fd-cancel-"));
  const source = join(root, "source.wav");
  writeFileSync(source, wav);
  const prepared = await prepareAudioUpload(source);
  const sourceReader = prepared.body.getReader();
  let cancelStarted = false;
  let cancelFinished = false;
  const delayedBody = new ReadableStream<Uint8Array>({
    async cancel(reason) {
      cancelStarted = true;
      await new Promise(resolve => setTimeout(resolve, 25));
      await sourceReader.cancel(reason);
      sourceReader.releaseLock();
      cancelFinished = true;
    },
  });
  const client = new HostedRecordingsClient({
    apiBase: base,
    credentialProvider: () => "fictional-access",
    fetch: fakeFetch(() => Response.json({ error: "fictional early failure" }, { status: 500 })),
  });
  try {
    await expect(client.uploadAudio(id, { ...prepared, body: delayedBody })).rejects.toMatchObject({ code: "http_error" });
    expect(cancelStarted).toBe(true);
    expect(cancelFinished).toBe(true);
  } finally {
    await sourceReader.cancel().catch(() => {});
    try { sourceReader.releaseLock(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP audio tools require configured directory, write gate, basename paths and retention consent", async () => {
  const root = mkdtempSync(join(tmpdir(), "recordings-audio-mcp-"));
  const source = join(root, "source.wav");
  writeFileSync(source, wav);
  const calls: Array<{ method: string; url: string; body?: Uint8Array }> = [];
  const server = buildHostedServer(clientFixture(calls), { allowWrites: true, audioDirectory: root });
  const client = new Client({ name: "fictional-audio-mcp", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    expect(listed.tools.map(tool => tool.name).sort()).toContain("recordings_hosted_audio_metadata");
    expect(listed.tools.map(tool => tool.name).sort()).toContain("recordings_hosted_audio_upload");
    expect(listed.tools.map(tool => tool.name).sort()).toContain("recordings_hosted_audio_download");
    const metadataResult = await client.callTool({ name: "recordings_hosted_audio_metadata", arguments: { id } });
    expect(metadataResult.isError).not.toBe(true);
    expect(metadataResult.structuredContent).toEqual(metadata);
    const uploadResult = await client.callTool({ name: "recordings_hosted_audio_upload", arguments: { id, fileName: "source.wav", retainAudio: true } });
    expect(uploadResult.isError).not.toBe(true);
    expect(uploadResult.structuredContent).toEqual(metadata);
    const downloadResult = await client.callTool({ name: "recordings_hosted_audio_download", arguments: { id, fileName: "roundtrip.wav" } });
    expect(downloadResult.isError).not.toBe(true);
    expect(downloadResult.structuredContent).toEqual({ fileName: "roundtrip.wav", byteLength: wav.byteLength, sha256: sha, status: 200 });
    expect(new Uint8Array(readFileSync(join(root, "roundtrip.wav")))).toEqual(wav);
    writeFileSync(join(root, "keep.wav"), Buffer.from("keep"));
    const existing = await client.callTool({ name: "recordings_hosted_audio_download", arguments: { id, fileName: "keep.wav" } });
    expect(existing.isError).toBe(true);
    expect(readFileSync(join(root, "keep.wav"), "utf8")).toBe("keep");
    const before = calls.length;
    const traversal = await client.callTool({ name: "recordings_hosted_audio_upload", arguments: { id, fileName: "../source.wav", retainAudio: true } });
    expect(traversal.isError).toBe(true);
    const noConsent = await client.callTool({ name: "recordings_hosted_audio_upload", arguments: { id, fileName: "source.wav" } });
    expect(noConsent.isError).toBe(true);
    expect(calls.length).toBe(before);
  } finally { await client.close(); await server.close(); rmSync(root, { recursive: true, force: true }); }
});

test("MCP audio upload propagates cancellation into the in-flight raw request", async () => {
  const root = mkdtempSync(join(tmpdir(), "recordings-audio-mcp-cancel-"));
  const source = join(root, "source.wav"); writeFileSync(source, wav);
  let entered!: () => void, abortResolve!: () => void;
  const enteredFetch = new Promise<void>(resolve => { entered = resolve; });
  const upstreamAborted = new Promise<void>(resolve => { abortResolve = resolve; });
  const hosted = new HostedRecordingsClient({ apiBase: base, credentialProvider: () => "fictional-access",
    fetch: fakeFetch(async (_url, init) => {
      entered();
      await new Promise<never>((_, reject) => init.signal?.addEventListener("abort", () => { abortResolve(); reject(new Error("fixture cancelled")); }, { once: true }));
      throw new Error("fixture request remained live");
    }) });
  const server = buildHostedServer(hosted, { allowWrites: true, audioDirectory: root });
  const client = new Client({ name: "fictional-audio-mcp-cancel", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  let cancellationResolve!: () => void;
  const cancellationSeen = new Promise<void>(resolve => { cancellationResolve = resolve; });
  const onMessage = serverTransport.onmessage!;
  serverTransport.onmessage = (message, extra) => {
    onMessage(message, extra);
    if ("method" in message && message.method === "notifications/cancelled") queueMicrotask(cancellationResolve);
  };
  const controller = new AbortController();
  try {
    const pending = client.callTool({ name: "recordings_hosted_audio_upload", arguments: { id, fileName: "source.wav", retainAudio: true } }, undefined,
      { signal: controller.signal }).then(() => "completed", () => "cancelled");
    await enteredFetch; controller.abort(); await cancellationSeen;
    expect(await pending).toBe("cancelled");
    const didAbort = await Promise.race([upstreamAborted.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 1000))]);
    expect(didAbort).toBe(true);
  } finally { await client.close(); await server.close(); rmSync(root, { recursive: true, force: true }); }
}, 10000);

test("MCP binary tools stay unavailable without both explicit directory and allow-writes", async () => {
  const client = new Client({ name: "fictional-audio-mcp-gate", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildHostedServer(clientFixture([]), { allowWrites: true });
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toContain("recordings_hosted_audio_metadata");
    expect(names).not.toContain("recordings_hosted_audio_upload");
    expect(names).not.toContain("recordings_hosted_audio_download");
  } finally { await client.close(); await server.close(); }
});

test("HTTP audio routes keep metadata JSON separate from raw transfer, enforce write gate and preserve 416", async () => {
  let calls = 0;
  const upstream = fakeFetch(async (url, init) => {
    calls++;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer fictional-A");
    expect(init.redirect).toBe("manual"); expect(init.credentials).toBe("omit");
    if (url.endsWith("/audio/metadata")) return Response.json(metadata);
    if (init.method === "PUT") {
      expect(headers.get("content-type")).toBe("audio/wav");
      expect(headers.get("content-length")).toBe(String(wav.byteLength));
      expect(headers.get("x-audio-retention-consent")).toBe("true");
      expect(await new Response(init.body).arrayBuffer()).toEqual(wav.buffer);
      return Response.json(metadata);
    }
    if (headers.get("range") === "bytes=999999-") return new Response(null, { status: 416 });
    return new Response(wav, { status: headers.has("range") ? 206 : 200, headers: {
      "content-type": "audio/wav", "content-length": String(wav.byteLength),
      "accept-ranges": "bytes", "x-audio-sha256": sha,
      ...(headers.has("range") ? { "content-range": "bytes 0-4845/4846" } : {}),
    } });
  });
  const readOnly = buildHostedFetch({ apiBase: base, fetch: upstream });
  const writeEnabled = buildHostedFetch({ apiBase: base, allowWrites: true, fetch: upstream });
  const auth = { authorization: "Bearer fictional-A" };
  expect((await readOnly(new Request("http://127.0.0.1/v1/recordings/" + id + "/audio", { method: "PUT",
    headers: { ...auth, "content-type": "audio/wav", "content-length": String(wav.byteLength), "x-audio-sha256": sha,
      "x-audio-retention-consent": "true" }, body: wav }))).status).toBe(405);
  expect(calls).toBe(0);
  const metadataReply = await readOnly(new Request("http://127.0.0.1/v1/recordings/" + id + "/audio/metadata", { headers: auth }));
  expect(metadataReply.status).toBe(200); expect(await metadataReply.json()).toEqual(metadata);
  const uploadReply = await writeEnabled(new Request("http://127.0.0.1/v1/recordings/" + id + "/audio", { method: "PUT",
    headers: { ...auth, "content-type": "audio/wav", "content-length": String(wav.byteLength), "x-audio-sha256": sha,
      "x-audio-retention-consent": "true" }, body: wav }));
  expect(uploadReply.status).toBe(200); expect(await uploadReply.json()).toEqual(metadata);
  const downloadReply = await readOnly(new Request("http://127.0.0.1/v1/recordings/" + id + "/audio", { headers: auth }));
  expect(downloadReply.status).toBe(200); expect(downloadReply.headers.get("x-audio-sha256")).toBe(sha);
  expect(await downloadReply.arrayBuffer()).toEqual(wav.buffer);
  const bad = await writeEnabled(new Request("http://127.0.0.1/v1/recordings/" + id + "/audio", { method: "PUT",
    headers: { ...auth, "content-type": "audio/wav", "content-length": String(wav.byteLength), "x-audio-sha256": sha }, body: wav }));
  expect(bad.status).toBe(400);
  expect((await readOnly(new Request("http://127.0.0.1/v1/providers", { method: "POST", headers: auth, body: wav }))).status).toBe(405);
  const unsatisfiable = await readOnly(new Request("http://127.0.0.1/v1/recordings/" + id + "/audio", {
    headers: { ...auth, range: "bytes=999999-" },
  }));
  expect(unsatisfiable.status).toBe(416);
  expect((await readOnly(new Request("http://127.0.0.1/v1/recordings/" + id + "/audio/nope", { headers: auth }))).status).toBe(404);
});
