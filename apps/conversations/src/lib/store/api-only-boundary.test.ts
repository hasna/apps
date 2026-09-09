import { test, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getStore, resolveConversationsCloud, conversationsCloudEnv, assertUnambiguousStoreEnv } from "./index.js";

const app = join(import.meta.dir, "../../..");
test("ordinary clients reject both database selectors before any access", () => {
  for (const key of ["HASNA_CONVERSATIONS_DB_PATH", "CONVERSATIONS_DB_PATH"]) {
    const env = { [key]: "/nonexistent/preserved.db" };
    for (const resolve of [getStore, resolveConversationsCloud, conversationsCloudEnv, assertUnambiguousStoreEnv]) {
      expect(() => resolve(env)).toThrow("no longer supported");
    }
  }
});

test("saved API CLI credentials work without copying or recreating databases", async () => {
  const home = mkdtempSync(join(tmpdir(), "conversations-api-client-"));
  const token = randomUUID();
  let requests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    if (req.headers.get("x-api-key") !== token) return Response.json({ error: "unauthorized" }, { status: 401 });
    requests++;
    if (new URL(req.url).pathname === "/v1/agents") return Response.json({ agents: [{ name: "shared-agent", online: false }] });
    return Response.json({ error: "unexpected route" }, { status: 404 });
  }});
  const legacy = join(home, ".hasna/conversations");
  mkdirSync(join(legacy, "config"), { recursive: true, mode: 0o700 });
  const sentinel = Buffer.from("synthetic preserved database");
  for (const suffix of ["", "-wal", "-shm"]) writeFileSync(join(legacy, `messages.db${suffix}`), sentinel);
  writeFileSync(join(legacy, "config/credentials"), `HASNA_CONVERSATIONS_API_URL=${server.url.origin}\nHASNA_CONVERSATIONS_API_KEY=${token}\n`, { mode: 0o600 });
  const env = { HOME: home, PATH: process.env.PATH!, HASNA_STATION: randomUUID(), NO_COLOR: "1" };
  const run = async (extra: Record<string,string> = {}, entry = "src/cli/index.tsx", args = ["agents", "list", "--json"]) => {
    const child = Bun.spawn([process.execPath, entry, ...args], { cwd: app, env: { ...env, ...extra }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), 10000);
    try { const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, code }; }
    finally { clearTimeout(timer); }
  };
  try {
    const success = await run();
    expect(success.code, success.stderr).toBe(0);
    expect(JSON.parse(success.stdout)[0].name).toBe("shared-agent");
    expect(requests).toBeGreaterThan(0);
    const before = requests;
    for (const key of ["HASNA_CONVERSATIONS_DB_PATH", "CONVERSATIONS_DB_PATH"]) {
      for (const entry of ["src/cli/index.tsx", "src/mcp/index.ts"]) {
        const failure = await run({ [key]: join(legacy, "messages.db") }, entry, entry.includes("mcp") ? [] : ["agents", "list"]);
        expect(failure.code).not.toBe(0);
        expect(failure.stderr).toContain("no longer supported");
      }
    }
    expect(requests).toBe(before);
    const files = readdirSync(home, { recursive: true }).map(String).filter(path => /\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/.test(path)).sort();
    expect(files).toEqual([".hasna/conversations/messages.db", ".hasna/conversations/messages.db-shm", ".hasna/conversations/messages.db-wal"]);
    for (const suffix of ["", "-wal", "-shm"]) expect(readFileSync(join(legacy, `messages.db${suffix}`)).equals(sentinel)).toBe(true);
  } finally { server.stop(true); rmSync(home, { recursive: true, force: true }); }
}, 30000);


test("public root convenience functions never open a local database", async () => {
  const home = mkdtempSync(join(tmpdir(), "conversations-root-client-"));
  try {
    const source = `import { listProjectChannelRegistrationPage, listProjectChannelMessagePage, redactMessagesById } from './src/index.ts';
      for (const [fn,arg] of [[listProjectChannelRegistrationPage,{}],[listProjectChannelMessagePage,{}],[redactMessagesById,{ids:[1]}]]) {
        try { await fn(arg); process.exit(2); }
        catch(error) { if (!String(error).includes('No local database is opened')) process.exit(3); }
      }`;
    const child = Bun.spawn([process.execPath, "-e", source], { cwd: app,
      env: { HOME: home, PATH: process.env.PATH!, HASNA_STATION: randomUUID() },
      stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stderr).toBe(0);
    expect(stdout).toBe("");
    expect(readdirSync(home, { recursive: true }).map(String).filter(path => /\.(db|sqlite|sqlite3)(-wal|-shm)?$/.test(path))).toEqual([]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("identity lookup preserves legacy identity but never imports database files", async () => {
  const home = mkdtempSync(join(tmpdir(), "conversations-legacy-client-"));
  const legacy = join(home, ".conversations");
  mkdirSync(legacy);
  const sentinel = Buffer.from("synthetic legacy database preserved");
  for (const suffix of ["", "-wal", "-shm"]) writeFileSync(join(legacy, `messages.db${suffix}`), sentinel);
  writeFileSync(join(legacy, "agent-id"), "legacy-fixture-agent\n");
  try {
    const child = Bun.spawn([process.execPath, "src/cli/index.tsx", "whoami", "--json"], { cwd: app,
      env: { HOME: home, PATH: process.env.PATH!, HASNA_STATION: randomUUID() }, stdout: "pipe", stderr: "pipe" });
    const [, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect([0,1]).toContain(code);
    expect(readFileSync(join(home, ".hasna/conversations/agent-id"), "utf8")).toBe("legacy-fixture-agent\n");
    const files = readdirSync(home, { recursive: true }).map(String).filter(path => /\.(db|sqlite|sqlite3)(-wal|-shm)?$/.test(path)).sort();
    expect(files).toEqual([".conversations/messages.db", ".conversations/messages.db-shm", ".conversations/messages.db-wal"]);
    for (const suffix of ["", "-wal", "-shm"]) expect(readFileSync(join(legacy, `messages.db${suffix}`)).equals(sentinel)).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
