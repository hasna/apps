/** Confine real hosted entry-point checks to fixed fictional HTTP replies and an owned receipt. */
import { mock } from "bun:test";
import { createHash } from "node:crypto";
import * as childProcess from "node:child_process";
import * as config from "../../lib/config.js";
import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import vectors from "../../../contracts/v1/fixtures.json";

const home = process.env.HOME ?? "", info = lstatSync(home);
if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(home) !== home ||
    info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700 ||
    !basename(home).startsWith("recordings-hosted-entry-") || !home.startsWith(realpathSync(tmpdir()) + "/")) {
  throw new Error("Hosted entry fixture requires an owned private HOME");
}
const counts = { denied: 0, requests: 0 };
const writeBoundary = () => writeFileSync(join(home, "boundary.json"), JSON.stringify(counts), { mode: 0o600 });
process.on("exit", writeBoundary);
writeBoundary();
const refuse = () => { counts.denied++; throw new Error("Hosted entry fixture blocked unrelated access"); };
mock.module("node:child_process", () => ({ ...childProcess, spawnSync: refuse, spawn: refuse,
  exec: refuse, execSync: refuse, execFile: refuse, execFileSync: refuse, fork: refuse }));
mock.module(join(import.meta.dir, "../../lib/config.ts"), () => ({ ...config, loadConfig: refuse, ensureDataDir: refuse }));
Bun.spawn = refuse as typeof Bun.spawn; Bun.spawnSync = refuse as typeof Bun.spawnSync;
Bun.serve = refuse as typeof Bun.serve;

const row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Fictional", transcript: "Hidden fictional transcript.",
  durationMs: 1000, createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-01T12:00:00Z" };
function audioFixture(): Uint8Array {
  const pcm = new Uint8Array(4_802);
  const bytes = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0); view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WAVE"), 8); bytes.set(new TextEncoder().encode("fmt "), 12);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36); view.setUint32(40, pcm.byteLength, true); bytes.set(pcm, 44);
  return bytes;
}
const audio = audioFixture();
const audioSha256 = createHash("sha256").update(audio).digest("hex");
const audioMetadata = { state: "available", format: { encoding: "pcm_s16le", sampleRate: 24_000, channels: 1, bitsPerSample: 16 },
  byteLength: audio.byteLength, pcmBytes: 4_802, durationMs: 4_802 / 48, sha256: audioSha256,
  storedAt: "2026-01-01T12:00:00Z", expiresAt: "2026-01-08T12:00:00Z" };
const audioUrl = "https://fictional.example.test/api/v1/recordings/" + row.id + "/audio";
const metadataUrl = audioUrl + "/metadata";

globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input), method = init?.method ?? "GET", headers = new Headers(init?.headers);
  const read = method === "GET" && ["https://fictional.example.test/api/v1/recordings?limit=1", "https://fictional.example.test/api/v1/recordings/" + row.id, "https://fictional.example.test/api/v1/paste-history?limit=1", "https://fictional.example.test/api/v1/providers"].includes(url);
  const paste = { id: row.id, recordingId: row.id, text: "Hidden fictional paste.", status: "confirmed" };
  const pasteMutation = url === "https://fictional.example.test/api/v1/paste-history" && method === "POST" &&
    init?.body === JSON.stringify(paste);
  const mutation = (url === "https://fictional.example.test/api/v1/recordings/" + row.id &&
    ((method === "PATCH" && init?.body === JSON.stringify({ title: "Renamed" })) || (method === "DELETE" && init?.body === undefined))) ||
    (url === "https://fictional.example.test/api/v1/recordings" && method === "POST" && init?.body === JSON.stringify({
      id: row.id, title: "Saved", transcript: "Hidden fictional transcript.", durationMs: 1000,
    })) || pasteMutation;
  const audioMetadataRead = url === metadataUrl && method === "GET";
  const audioDownload = url === audioUrl && method === "GET";
  const audioUpload = url === audioUrl && method === "PUT";
  if ((!read && !mutation && !audioMetadataRead && !audioDownload && !audioUpload) || !init ||
      headers.get("authorization") !== "Bearer fictional-entry-session" || init.redirect !== "manual" || init.credentials !== "omit") return refuse();
  counts.requests++; writeBoundary();
  if (audioMetadataRead) return Response.json(audioMetadata);
  if (audioUpload) {
    if (headers.get("content-type") !== "audio/wav" || headers.get("content-length") !== String(audio.byteLength) ||
        headers.get("x-audio-retention-consent") !== "true" || headers.get("x-audio-sha256") !== audioSha256 || !init.body ||
        !Buffer.from(await new Response(init.body).arrayBuffer()).equals(Buffer.from(audio))) return refuse();
    return Response.json(audioMetadata);
  }
  if (audioDownload) return new Response(audio.buffer as ArrayBuffer, { headers: { "content-type": "audio/wav", "content-length": String(audio.byteLength),
    "accept-ranges": "bytes", "x-audio-sha256": audioSha256 } });
  if (mutation) {
    if (pasteMutation) return Response.json({ receipt: { ...paste, occurredAt: row.createdAt, createdAt: row.createdAt,
      updatedAt: row.updatedAt, evidenceSource: "client_reported" } }, { status: 201 });
    return method === "DELETE" ? Response.json({ audioCleanup: { state: "pending" } }, { status: 202 })
      : Response.json({ recording: { ...row, title: method === "POST" ? "Saved" : "Renamed" } }, { status: method === "POST" ? 201 : 200 });
  }
  if (url.endsWith("/recordings/" + row.id)) return Response.json({ recording: row });
  if (url.endsWith("/providers")) {
    const catalog = vectors.cases.find(value => value.name === "provider catalog with explicit defaults")!.value;
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return refuse();
    return Response.json({ ...catalog, serverConfiguration: "Hidden fictional provider configuration" });
  }
  return url.includes("/paste-history?") ? Response.json({ receipts: [{ id: row.id, recordingId: row.id,
    text: "Hidden fictional paste.", destinationAppId: "test.fictional.editor", destinationAppName: "Fictional editor",
    status: "confirmed", occurredAt: row.createdAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
    evidenceSource: "client_reported", futurePrivateField: "Hidden future detail" }] }) : Response.json({ recordings: [row] });
}, { preconnect: refuse }) as typeof fetch;
