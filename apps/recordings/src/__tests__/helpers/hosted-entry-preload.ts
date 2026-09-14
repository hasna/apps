/** Confine real entry-point checks to fixed fictional HTTP replies and an owned receipt. */
import { mock } from "bun:test";
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
globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const read = init?.method === "GET" && ["https://fictional.example.test/api/v1/recordings?limit=1", "https://fictional.example.test/api/v1/recordings/" + row.id, "https://fictional.example.test/api/v1/paste-history?limit=1", "https://fictional.example.test/api/v1/providers"].includes(url);
  const paste = { id: row.id, recordingId: row.id, text: "Hidden fictional paste.", status: "confirmed" };
  const pasteMutation = url === "https://fictional.example.test/api/v1/paste-history" && init?.method === "POST" &&
    init.body === JSON.stringify(paste);
  const mutation = (url === "https://fictional.example.test/api/v1/recordings/" + row.id &&
    ((init?.method === "PATCH" && init.body === JSON.stringify({ title: "Renamed" })) || (init?.method === "DELETE" && init.body === undefined))) ||
    (url === "https://fictional.example.test/api/v1/recordings" && init?.method === "POST" && init.body === JSON.stringify({
      id: row.id, title: "Saved", transcript: "Hidden fictional transcript.", durationMs: 1000,
    })) || pasteMutation;
  if ((!read && !mutation) || !init || new Headers(init.headers).get("authorization") !== "Bearer fictional-entry-session" ||
      init.redirect !== "manual" || init.credentials !== "omit") return refuse();
  counts.requests++; writeBoundary();
  if (mutation) {
    if (pasteMutation) return Response.json({ receipt: { ...paste, occurredAt: row.createdAt, createdAt: row.createdAt,
      updatedAt: row.updatedAt, evidenceSource: "client_reported" } }, { status: 201 });
    return init.method === "DELETE" ? Response.json({ audioCleanup: { state: "pending" } }, { status: 202 })
      : Response.json({ recording: { ...row, title: init.method === "POST" ? "Saved" : "Renamed" } }, { status: init.method === "POST" ? 201 : 200 });
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
