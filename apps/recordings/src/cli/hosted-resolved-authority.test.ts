/**
 * `recordings hosted list|get` must reach the hosted `/v1` Library through the
 * ONE fleet resolver, with no `--api-base` / `--credential-env` handed in by
 * the operator, and must fail closed when nothing resolves.
 *
 * The route is served by a real in-process listener on 127.0.0.1 (not a fetch
 * stub), so the assertion is on the wire: method, path and bearer header.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHostedCLI } from "./hosted.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const at = "2026-01-02T03:04:05Z";
const credential = "fictional-station-credential";
const row = {
  id, title: "Fictional meeting", transcript: "Private fictional transcript.",
  durationMs: 1250, createdAt: at, updatedAt: at,
};
const projected = { id, title: row.title, durationMs: row.durationMs, createdAt: at };

const requests: Array<{ method: string; path: string; authorized: boolean }> = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    const authorized = request.headers.get("authorization") === `Bearer ${credential}`;
    requests.push({ method: request.method, path: url.pathname, authorized });
    if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (url.pathname === "/v1/recordings") return Response.json({ recordings: [row] });
    if (url.pathname === `/v1/recordings/${id}`) return Response.json({ recording: row });
    return Response.json({ error: "not_found" }, { status: 404 });
  },
});
afterAll(() => { server.stop(true); });

/** A scrubbed home: no station identity, so only the env tier can answer. */
function scrubbedHome(): string {
  return mkdtempSync(join(tmpdir(), "recordings-hosted-home-"));
}
function dbFiles(home: string): string[] {
  return (readdirSync(home, { recursive: true }) as string[]).filter(name => /\.db($|-)/.test(String(name)));
}

test("hosted list|get resolve the fleet authority and hit the hosted /v1 route", async () => {
  const home = scrubbedHome();
  const env: Record<string, string | undefined> = {
    HOME: home,
    HASNA_STATION: "no-such-station",
    HASNA_RECORDINGS_API_URL: `http://127.0.0.1:${server.port}`,
    HASNA_RECORDINGS_API_KEY: credential,
  };
  const written: string[] = [];
  const write = (value: string) => { written.push(value); };

  // `list` — no --api-base, no --credential-env.
  expect(await runHostedCLI(["list", "--limit", "1"], { env, write })).toBe(0);
  expect(JSON.parse(written.pop()!)).toEqual({
    recordings: [projected], nextCursor: { before: at, beforeId: id },
  });

  // `get` — same resolution, same credential.
  expect(await runHostedCLI(["get", id], { env, write })).toBe(0);
  expect(JSON.parse(written.pop()!)).toEqual({ recording: projected });

  expect(requests.map(entry => `${entry.method} ${entry.path}`))
    .toEqual(["GET /v1/recordings", `GET /v1/recordings/${id}`]);
  expect(requests.every(entry => entry.authorized)).toBe(true);
  // The hosted path never opens a local dataset.
  expect(dbFiles(home)).toEqual([]);
});

test("hosted list fails closed when the chain resolves no hosted credential", async () => {
  const home = scrubbedHome();
  const before = requests.length;
  const written: string[] = [];
  const status = await runHostedCLI(["list"], {
    env: { HOME: home, HASNA_STATION: "no-such-station" },
    write: (value: string) => { written.push(value); },
  });
  expect(status).toBe(1);
  expect(requests).toHaveLength(before);
  expect(written.join("")).not.toContain(credential);
  expect(dbFiles(home)).toEqual([]);
});

test("an explicit --api-base still requires its named credential variable", async () => {
  const written: string[] = [];
  const status = await runHostedCLI(["--api-base", "https://fictional.example.test/v1/", "list"], {
    env: { HASNA_STATION: "no-such-station" },
    write: (value: string) => { written.push(value); },
  });
  expect(status).toBe(1);
  expect(JSON.parse(written.join("")).error.code).toBe("invalid_configuration");
});
