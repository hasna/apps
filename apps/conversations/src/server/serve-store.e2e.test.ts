// The dashboard server must answer from the CONFIGURED store, not from the on-box
// SQLite file it happens to sit next to.
//
// The measured P0 (task d211f560): `src/server/serve.ts` imported the sync local
// helpers directly and never called `getStore()`, so every /api endpoint was
// local-SQLite-only BY CONSTRUCTION. On the owner's Mac that rendered 358 channels
// and 4550 messages out of the hosted service's 1124 / 72652 — no error, no flag,
// no way to tell from the UI that 68% of the channels were missing.
//
// A test that only asserts "the endpoint returns 200" would not have caught that,
// because the broken version returned 200 too. So every case here asserts on a
// COUNT that differs between the two stores, and each endpoint class is exercised
// in BOTH directions:
//
//   hosted-configured  → the stub cloud's numbers, never the local ones
//   credential removed → a refusal, never the local numbers under a 200
//
// The second direction is the one that matters most: silent fall-back is the exact
// defect the owner was living with, so serving local data when cloud was asked for
// has to be an ERROR rather than a quieter kind of success.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { LOCAL } from "./serve-store.probe.js";

const PROBE = join(import.meta.dir, "serve-store.probe.ts");

/**
 * Stub-cloud fixture sizes. Every value is distinct from every LOCAL value and
 * from every other CLOUD value, so a wrong answer cannot coincide with a right
 * one and two classes cannot be confused for each other.
 */
const CLOUD = {
  sessions: 5,
  messages: 6,
  projects: 7,
  channels: 8,
  agents: 9,
  hot: 11,
  related: 12,
  reactions: 13,
  locks: 14,
  pinned: 15,
  network: 16,
  exported: 17,
};

/** Not a credential: a deliberately invalid stub the local server never checks. */
const FAKE_KEY = ["hasna", "conversations", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

let sandboxHome: string;
let cloud: ReturnType<typeof Bun.serve>;
let cloudUrl: string;

const rows = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `${prefix}-${i}` }));

/** Every store env var, so a case's env is what the case says it is. */
const CLEARED: Record<string, undefined> = {
  HASNA_CONVERSATIONS_API_URL: undefined,
  HASNA_CONVERSATIONS_API_KEY: undefined,
  HASNA_CONVERSATIONS_STORAGE_MODE: undefined,
  HASNA_CONVERSATIONS_MODE: undefined,
  HASNA_CONVERSATIONS_DB_PATH: undefined,
  CONVERSATIONS_API_URL: undefined,
  CONVERSATIONS_API_KEY: undefined,
  CONVERSATIONS_STORAGE_MODE: undefined,
  CONVERSATIONS_MODE: undefined,
  CONVERSATIONS_DB_PATH: undefined,
  // A login shim that re-injects the cleared variables would make three
  // "different" conditions byte-identical and every negative result vacuous.
  // Measured on this fleet 2026-07-31; neutralised rather than assumed absent.
  BASH_ENV: undefined,
  ENV: undefined,
};

async function probe(mode: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", PROBE, mode],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "", HOME: sandboxHome, ...CLEARED, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "{}";
  let result: Record<string, any> = {};
  try {
    result = JSON.parse(line);
  } catch {
    /* assertions below surface stderr */
  }
  return { exitCode, stdout, stderr, result };
}

beforeAll(async () => {
  sandboxHome = mkdtempSync(join(tmpdir(), "conversations-serve-store-"));

  cloud = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url);
      const p = url.pathname.replace(/^\/v1/, "");

      // Writes. Each one echoes a row tagged `cloud-written-*`, so a mutation that
      // silently landed in the local SQLite store cannot produce this response.
      if (request.method === "POST") {
        if (p === "/messages") return Response.json({ message: { id: 901, content: "cloud-written-message" } });
        if (p === "/channels") return Response.json({ channel: { id: 902, name: "cloud-written-channel" } });
        if (p === "/projects") return Response.json({ project: { id: 903, name: "cloud-written-project" } });
      }
      if (p === "/messages") {
        if (url.searchParams.get("count")) return Response.json({ count: CLOUD.messages });
        return Response.json({ messages: rows(CLOUD.messages, "cloud-message") });
      }
      if (p === "/messages/export") {
        // serve.ts JSON.parses the export payload, so it must be parseable JSON.
        return Response.json({ export: JSON.stringify(rows(CLOUD.exported, "cloud-export")) });
      }
      if (p === "/messages/pinned") return Response.json({ messages: rows(CLOUD.pinned, "cloud-pinned") });
      if (/^\/messages\/\d+\/reactions$/.test(p)) {
        return Response.json({ reactions: rows(CLOUD.reactions, "cloud-reaction") });
      }
      if (p === "/sessions") return Response.json({ sessions: rows(CLOUD.sessions, "cloud-session") });
      if (p === "/channels") return Response.json({ channels: rows(CLOUD.channels, "cloud-channel") });
      if (p === "/projects") return Response.json({ projects: rows(CLOUD.projects, "cloud-project") });
      if (p === "/agents") return Response.json({ agents: rows(CLOUD.agents, "cloud-agent") });
      if (p === "/hot") return Response.json({ sessions: rows(CLOUD.hot, "cloud-hot") });
      if (p === "/graph/related") return Response.json({ related: rows(CLOUD.related, "cloud-related") });
      if (p.startsWith("/graph/network/")) {
        return Response.json({ network: { nodes: rows(CLOUD.network, "cloud-node") } });
      }
      if (p === "/graph/stats") return Response.json({ nodes: rows(CLOUD.network, "cloud-node") });
      if (p === "/locks") return Response.json({ locks: rows(CLOUD.locks, "cloud-lock") });

      return new Response("not found", { status: 404 });
    },
  });
  cloudUrl = `http://127.0.0.1:${cloud.port}`;

  const seeded = await probe("seed", { HASNA_CONVERSATIONS_STORAGE_MODE: "local" });
  expect(seeded.exitCode, `seed failed: ${seeded.stderr}`).toBe(0);
});

afterAll(() => {
  cloud?.stop(true);
  if (sandboxHome) rmSync(sandboxHome, { recursive: true, force: true });
});

// Which stub-cloud count each endpoint class must return when the store is hosted.
const HOSTED_EXPECTATIONS: Array<[string, number]> = [
  ["status", CLOUD.channels],
  ["messages", CLOUD.messages],
  ["messages.search", CLOUD.messages],
  ["messages.export", CLOUD.exported],
  ["messages.pinned", CLOUD.pinned],
  ["sessions", CLOUD.sessions],
  ["channels", CLOUD.channels],
  ["projects", CLOUD.projects],
  ["presence", CLOUD.agents],
  ["hot", CLOUD.hot],
  ["graph", CLOUD.related],
  ["graph.network", CLOUD.network],
  ["reactions", CLOUD.reactions],
  ["locks", CLOUD.locks],
];

describe("dashboard server — hosted store answers every endpoint class", () => {
  let hosted: Record<string, any>;

  beforeAll(async () => {
    const run = await probe("probe-writes", {
      HASNA_CONVERSATIONS_API_URL: cloudUrl,
      HASNA_CONVERSATIONS_API_KEY: FAKE_KEY,
    });
    expect(run.exitCode, `probe failed: ${run.stderr}`).toBe(0);
    hosted = run.result;
  });

  for (const [endpointClass, expected] of HOSTED_EXPECTATIONS) {
    test(`${endpointClass} returns the hosted count, not the local one`, () => {
      const row = hosted[endpointClass];
      expect(row, `no result for ${endpointClass}`).toBeDefined();
      expect(row.status, `${endpointClass} -> ${JSON.stringify(row)}`).toBe(200);
      expect(row.size).toBe(expected);
      // The whole defect: the local store holds a DIFFERENT dataset, so answering
      // from it is a wrong answer rather than a stylistic difference.
      expect(row.size).not.toBe(LOCAL.channels);
      expect(row.size).not.toBe(LOCAL.projects);
      expect(row.size).not.toBe(LOCAL.messages);
    });
  }

  test("/api/status names the store that answered it", () => {
    expect(hosted.status.mode).toBe("self_hosted");
    expect(hosted.status.apiUrlPresent).toBe(true);
    expect(hosted.status.dbPathPresent).toBe(false);
  });

  // Writes are the half a read-only test cannot speak for: a mutation that landed
  // in the local SQLite store would still return 200 with a plausible row.
  for (const endpointClass of ["write.messages", "write.channels", "write.projects"]) {
    test(`${endpointClass} is accepted by the hosted store`, () => {
      const row = hosted[endpointClass];
      expect(row, `no result for ${endpointClass}`).toBeDefined();
      expect(row.status, `${endpointClass} -> ${JSON.stringify(row)}`).toBe(200);
    });
  }
});

describe("dashboard server — a half-configured client refuses instead of serving local data", () => {
  // THE REGRESSION. Before the fix every one of these returned 200 with the local
  // numbers, which is indistinguishable from working.
  let refused: Record<string, any>;

  beforeAll(async () => {
    const run = await probe("probe-writes", { HASNA_CONVERSATIONS_API_URL: cloudUrl });
    expect(run.exitCode, `probe failed: ${run.stderr}`).toBe(0);
    refused = run.result;
  });

  // Mutations are listed separately because they refuse through a different route:
  // each wraps its store call in the same try/catch it uses for JSON.parse, so
  // without an explicit rethrow a store refusal is reported as 400 — the server
  // blaming the caller for its own misconfiguration. Measured on the built bundle:
  // GET /api/channels answered 503 while POST /api/messages answered 400 carrying
  // the identical message.
  const WRITE_CLASSES = ["write.messages", "write.channels", "write.projects"];

  for (const endpointClass of WRITE_CLASSES) {
    test(`${endpointClass} refuses with 503, not 400`, () => {
      const row = refused[endpointClass];
      expect(row, `no result for ${endpointClass}`).toBeDefined();
      expect(row.status, `${endpointClass} -> ${JSON.stringify(row)}`).toBe(503);
      expect(String(row.error)).toContain("HASNA_CONVERSATIONS_API_KEY");
    });
  }

  for (const [endpointClass] of HOSTED_EXPECTATIONS) {
    test(`${endpointClass} refuses rather than answering from local SQLite`, () => {
      const row = refused[endpointClass];
      expect(row, `no result for ${endpointClass}`).toBeDefined();
      expect(row.status, `${endpointClass} -> ${JSON.stringify(row)}`).toBe(503);
      expect(String(row.error)).toContain("HASNA_CONVERSATIONS_API_KEY");
      // It must not have quietly answered from either dataset.
      expect(row.size).toBeNull();
    });
  }

  test("no credential value ever reaches a refusal message", async () => {
    const run = await probe("probe", { HASNA_CONVERSATIONS_API_KEY: FAKE_KEY });
    expect(JSON.stringify(run.result)).not.toContain(FAKE_KEY);
  });
});

// A local-selecting variable BEATS a valid url+key pair (store/index.ts precedence
// rules 1 and 2), and that is correct: an operator asking for local gets local.
//
// It matters here because the macOS shell's guard (PR #51) reads only three of the
// variables this resolver honours, so a stray DB_PATH or an unprefixed mode alias
// makes the shell report `store=hosted` while the child resolves LOCAL. serve.ts
// CANNOT prevent that — from the server's side "DB_PATH is set" is indistinguishable
// from a deliberate local configuration — so what it owes instead is TRUTHFULNESS:
// /api/status must name the store that actually answered, so the condition is
// detectable rather than invisible. These cases pin that, so the shell-side fix has
// something dependable to be verified against.
describe("dashboard server — a local-selecting variable is reported honestly, never as hosted", () => {
  const LOCAL_SELECTORS: Array<[string, (db: string) => Record<string, string>]> = [
    ["HASNA_CONVERSATIONS_DB_PATH", (db) => ({ HASNA_CONVERSATIONS_DB_PATH: db })],
    ["CONVERSATIONS_DB_PATH", (db) => ({ CONVERSATIONS_DB_PATH: db })],
    ["CONVERSATIONS_MODE=local", () => ({ CONVERSATIONS_MODE: "local" })],
    ["HASNA_CONVERSATIONS_MODE=local", () => ({ HASNA_CONVERSATIONS_MODE: "local" })],
    ["CONVERSATIONS_STORAGE_MODE=local", () => ({ CONVERSATIONS_STORAGE_MODE: "local" })],
  ];

  for (const [label, build] of LOCAL_SELECTORS) {
    test(`${label} alongside a valid url+key pair reports mode=local, not self_hosted`, async () => {
      const db = join(sandboxHome, ".hasna", "conversations", "messages.db");
      const run = await probe("probe", {
        HASNA_CONVERSATIONS_API_URL: cloudUrl,
        HASNA_CONVERSATIONS_API_KEY: FAKE_KEY,
        ...build(db),
      });
      expect(run.exitCode, run.stderr).toBe(0);

      // The endpoint must not claim to be hosted while serving the on-box store.
      expect(run.result.status.mode).toBe("local");
      expect(run.result.status.dbPathPresent).toBe(true);
      expect(run.result.status.apiUrlPresent).toBe(false);
      // And it really is the local dataset, not the cloud one.
      expect(run.result.status.size).toBe(LOCAL.channels);
      expect(run.result.channels.size).toBe(LOCAL.channels);
      expect(run.result.channels.size).not.toBe(CLOUD.channels);
    });
  }

  test("the unprefixed url+key aliases DO select cloud, so a guard reading only the prefixed pair is blind to them", async () => {
    const run = await probe("probe", {
      CONVERSATIONS_API_URL: cloudUrl,
      CONVERSATIONS_API_KEY: FAKE_KEY,
    });
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.result.status.mode).toBe("self_hosted");
    expect(run.result.channels.size).toBe(CLOUD.channels);
  });
});

describe("dashboard server — legitimate local use is untouched", () => {
  // The fail-closed behaviour must not break the documented single-operator
  // default, or the fix trades one broken configuration for another.
  let local: Record<string, any>;

  beforeAll(async () => {
    const run = await probe("probe", { HASNA_CONVERSATIONS_STORAGE_MODE: "local" });
    expect(run.exitCode, `probe failed: ${run.stderr}`).toBe(0);
    local = run.result;
  });

  test("channels still answer from the on-box store", () => {
    expect(local.channels.status).toBe(200);
    expect(local.channels.size).toBe(LOCAL.channels);
  });

  test("projects still answer from the on-box store", () => {
    expect(local.projects.status).toBe(200);
    expect(local.projects.size).toBe(LOCAL.projects);
  });

  test("/api/status reports the local store and its db path", () => {
    expect(local.status.mode).toBe("local");
    expect(local.status.dbPathPresent).toBe(true);
    expect(local.status.apiUrlPresent).toBe(false);
    expect(local.status.size).toBe(LOCAL.channels);
  });
});
