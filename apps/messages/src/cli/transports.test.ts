/**
 * The transport matrix gate (fleet storage doctrine, owner directive
 * 2026-08-15): EVERY `messages` command works in ANY transport — the hosted
 * API transport (`--url` + `--api-key` against a messages-serve HTTP server)
 * AND the local transport (HASNA_MESSAGES_LOCAL=1 over the on-box SQLite
 * store). Command registration must be unconditional: nothing may be
 * registered, described or errored differently per transport, and no command
 * may be "local only" or "hosted only".
 *
 * Both legs are hermetic. The hosted leg runs the real HTTP server
 * (buildHandler over a temp SQLite store, loopback bind) and drives the real
 * CLI through `--url`/`--api-key` — the same wire path a fleet API URL
 * exercises. The local leg runs the same CLI through the explicit opt-in.
 * `messages serve` boots through the CLI command and answers /health. The
 * spawned env is stripped of every station/fleet variable and HOME is forced,
 * so a machine credential can never flip a leg onto the network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { MessagesService } from "../service";
import { SqliteMessagesStore } from "../server/sqlite-store";
import { buildHandler } from "../server/serve-entry";
import { createAuthGate } from "../server/auth";

const ROOT = path.resolve(import.meta.dir, "..", "..");
const RUNNER = process.execPath;

let tmpDir: string;
let fakeHome: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "messages-transports-test-"));
  fakeHome = path.join(tmpDir, "fake-home");
  fs.mkdirSync(fakeHome, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Hermetic spawn env: strip station/fleet variables, force a fake HOME. */
function cliEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("HASNA_MESSAGES_") || key.startsWith("MESSAGES_")) continue;
    if (key === "HASNA_PROFILE" || key === "HASNA_HOME" || key === "HASNA_CONFIG_HOME") continue;
    if (key === "CONVERSATIONS_AGENT_ID") continue;
    env[key] = value;
  }
  return { ...env, HOME: fakeHome, ...extra };
}

/**
 * Run one CLI invocation and await it. ASYNC on purpose: the hosted leg talks
 * to an in-process Bun.serve handler, so the test's event loop must stay free
 * while the CLI waits for its HTTP response — a blocking spawnSync would
 * deadlock the very server the CLI is talking to.
 */
async function runCli(args: string[], extraEnv: Record<string, string> = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const proc = Bun.spawn([RUNNER, "run", "src/cli/index.ts", ...args], {
    cwd: ROOT,
    env: cliEnv(extraEnv),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const status = await proc.exited;
  expect(status, `messages ${args.join(" ")}\nstderr: ${stderr}`).toBe(0);
  return { status, stdout, stderr };
}

/** In-process messages-serve: the hosted API transport, fully hermetic. An
 * empty key builds the trusted-loopback open gate. */
function startServer(key: string): { baseUrl: string; close: () => void } {
  const db = new Database(":memory:");
  const store = new SqliteMessagesStore(db);
  const service = new MessagesService(store);
  const auth = createAuthGate({ env: { HASNA_MESSAGES_API_KEY: key }, queryClient: null, warn: () => {} });
  const handler = buildHandler({ service, backend: "sqlite", auth });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => handler(req) });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    close: () => {
      server.stop(true);
      store.close();
    },
  };
}

/**
 * One full command sweep — the shared body every transport must pass. Every
 * data command: register, agents, whoami, send, receive, delivery, threads,
 * thread, unread, read, close, reopen, status.
 */
async function sweep(prefix: string, opts: { args: string[]; env?: Record<string, string>; expectLocal: boolean }): Promise<void> {
  const a = `${prefix}-a`;
  const b = `${prefix}-b`;
  let tid = "";

  const register = JSON.parse(
    (await runCli(["register", "--name", a, "--display-name", `Matrix ${a}`, ...opts.args], opts.env)).stdout,
  ) as { agent: { name: string } };
  expect(register.agent.name).toBe(a);
  await runCli(["register", "--name", b, ...opts.args], opts.env);

  const who = JSON.parse((await runCli(["whoami", "--agent", a, ...opts.args, "--json"], opts.env)).stdout) as {
    name: string;
    transport: string;
    api_url: string | null;
  };
  expect(who.name).toBe(a);
  expect(who.transport).toBe(opts.expectLocal ? "local" : "http");

  const agents = JSON.parse((await runCli(["agents", ...opts.args, "--json"], opts.env)).stdout) as Array<{ name: string }>;
  expect(agents.map((x) => x.name)).toContain(a);

  const sent = JSON.parse(
    (await runCli(["send", "--from", a, "--to", b, "--content", "matrix hello", ...opts.args], opts.env)).stdout,
  ) as { message: { id: string; thread_id: string; seq: number } };
  tid = sent.message.thread_id;
  expect(tid).toBeTruthy();
  expect(sent.message.seq).toBe(1);

  // Reply chains the same thread (replies are first-class).
  const replied = JSON.parse(
    (await runCli(["send", "--from", b, "--to", a, "--content", "matrix reply", ...opts.args], opts.env)).stdout,
  ) as { message: { seq: number } };
  expect(replied.message.seq).toBe(2);

  const threads = JSON.parse((await runCli(["threads", "--agent", a, ...opts.args, "--json"], opts.env)).stdout) as Array<{
    id: string;
    message_count: number;
  }>;
  expect(threads.map((t) => t.id)).toContain(tid);
  expect(threads.find((t) => t.id === tid)!.message_count).toBe(2);

  const expanded = JSON.parse(
    (await runCli(["thread", "--id", tid, "--agent", a, ...opts.args, "--json"], opts.env)).stdout,
  ) as { thread: { id: string }; messages: Array<{ message: { seq: number } }> };
  expect(expanded.thread.id).toBe(tid);
  expect(expanded.messages.map((m) => m.message.seq)).toEqual([1, 2]);

  const unread = JSON.parse((await runCli(["unread", "--agent", b, ...opts.args, "--json"], opts.env)).stdout) as {
    total: number;
  };
  expect(unread.total).toBeGreaterThan(0);

  const received = JSON.parse((await runCli(["receive", "--agent", b, ...opts.args, "--json"], opts.env)).stdout) as Array<{
    delivery: { state: string };
  }>;
  expect(received).toHaveLength(1);
  expect(received[0]!.delivery.state).toBe("delivered");

  const deliveries = JSON.parse((await runCli(["delivery", "--id", tid, ...opts.args, "--json"], opts.env)).stdout) as Array<{
    deliveries: Array<{ state: string }>;
  }>;
  expect(deliveries.flatMap((d) => d.deliveries.map((x) => x.state))).toContain("delivered");

  const read = JSON.parse((await runCli(["read", "--id", tid, "--agent", b, ...opts.args, "--json"], opts.env)).stdout) as {
    ok: boolean;
  };
  expect(read.ok).toBe(true);

  await runCli(["close", "--id", tid, "--agent", a, ...opts.args], opts.env);
  const open = JSON.parse((await runCli(["threads", "--agent", a, ...opts.args, "--json"], opts.env)).stdout) as Array<{
    id: string;
  }>;
  expect(open.map((t) => t.id)).not.toContain(tid);
  const all = JSON.parse(
    (await runCli(["threads", "--agent", a, "--all", ...opts.args, "--json"], opts.env)).stdout,
  ) as Array<{ id: string; closed: boolean }>;
  expect(all.find((t) => t.id === tid)!.closed).toBe(true);
  await runCli(["reopen", "--id", tid, "--agent", a, ...opts.args], opts.env);
  const reopened = JSON.parse((await runCli(["threads", "--agent", a, ...opts.args, "--json"], opts.env)).stdout) as Array<{
    id: string;
  }>;
  expect(reopened.map((t) => t.id)).toContain(tid);
}

describe("every messages command works in EVERY transport", () => {
  test("hosted API transport: --url + --api-key against a running messages-serve", async () => {
    const KEY = "transport-matrix-key";
    const server = startServer(KEY);
    try {
      const transportArgs = ["--url", server.baseUrl, "--api-key", KEY];
      await sweep("ht", { args: transportArgs, expectLocal: false });

      const status = JSON.parse((await runCli(["status", "--json", ...transportArgs])).stdout) as {
        transport: string;
        api_url: string;
        api_key_present: boolean;
        authority_pinned: boolean;
      };
      expect(status.transport).toBe("http");
      expect(status.api_url).toBe(`${server.baseUrl}/v1`);
      expect(status.api_key_present).toBe(true);
      expect(status.authority_pinned).toBe(true);

      // Wrong key: the client really sends the key and the gate really rejects
      // (exit 1, actionable error — never a silent success).
      await runCliExpectFailure(["agents", "--url", server.baseUrl, "--api-key", "wrong"]);
    } finally {
      server.close();
    }
  });

  test("trusted loopback: --url without --api-key against an open messages-serve", async () => {
    const server = startServer("");
    try {
      // Open mode: /v1/* answers without any client credential — the
      // trusted-localhost transport (#1794: a pinned authority attaches no
      // ambient credential, which is exactly what this leg needs).
      const agents = JSON.parse((await runCli(["agents", "--url", server.baseUrl, "--json"])).stdout) as unknown[];
      expect(agents).toEqual([]);
    } finally {
      server.close();
    }
  });

  test("local transport: HASNA_MESSAGES_LOCAL=1 over the on-box SQLite store", async () => {
    await sweep("lc", { args: [], env: { HASNA_MESSAGES_LOCAL: "1" }, expectLocal: true });

    const status = JSON.parse((await runCli(["status", "--json"], { HASNA_MESSAGES_LOCAL: "1" })).stdout) as {
      transport: string;
      api_url: null;
      api_key_present: boolean;
    };
    expect(status.transport).toBe("local");
    expect(status.api_url).toBeNull();
    expect(status.api_key_present).toBe(false);
  });

  test("the CLI resolves ~/.hasna/messages/config/credentials with NO env (station credential file)", async () => {
    // The canonical station credential file: two lines (URL + key), 0600,
    // under $HOME/.hasna/messages/config. A CLI run with a stripped env must
    // pick it up and reach the hosted API — the file IS the configuration,
    // exactly like the station file at /home/hasna/.hasna/messages/config/
    // credentials (sourced fleet env: gone).
    const KEY = "file-driven-key";
    const server = startServer(KEY);
    const home = path.join(tmpDir, "file-home");
    const credDir = path.join(home, ".hasna", "messages", "config");
    const credFile = path.join(credDir, "credentials");
    fs.mkdirSync(credDir, { recursive: true });
    fs.writeFileSync(credFile, `HASNA_MESSAGES_API_URL=${server.baseUrl}\nHASNA_MESSAGES_API_KEY=${KEY}\n`, {
      mode: 0o600,
    });
    try {
      const agents = JSON.parse((await runCli(["agents", "--json"], { HOME: home })).stdout) as unknown[];
      expect(agents).toEqual([]);
      const status = JSON.parse((await runCli(["status", "--json"], { HOME: home })).stdout) as {
        transport: string;
        api_key_tier: string | null;
        api_url: string;
      };
      expect(status.transport).toBe("http");
      expect(status.api_key_tier).toBe("disk");
      expect(status.api_url).toBe(`${server.baseUrl}/v1`);
    } finally {
      server.close();
    }
  });

  test("messages serve boots through the CLI and answers /health", async () => {
    const serveHome = path.join(tmpDir, "serve-home");
    const outFile = path.join(tmpDir, "serve.out");
    const errFile = path.join(tmpDir, "serve.err");
    fs.mkdirSync(serveHome, { recursive: true });
    // Port 0 lets Bun assign a free port; the served line announces the real
    // one. (Reserving a port with a probe server and reusing it races the
    // kernel's release — observed on bun 1.3.14.) Stdio goes to files because
    // a pipe reader on the long-lived child wedges the spawn in bun test.
    const proc = Bun.spawn([RUNNER, "run", "src/cli/index.ts", "serve"], {
      cwd: ROOT,
      env: cliEnv({ HASNA_MESSAGES_PORT: "0", HASNA_MESSAGES_HOME: serveHome }),
      stdout: Bun.file(outFile),
      stderr: Bun.file(errFile),
    });
    let announcedPort: number | null = null;
    for (let i = 0; i < 100 && announcedPort === null; i++) {
      if (fs.existsSync(outFile)) {
        const out = fs.readFileSync(outFile, "utf8");
        const match = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) announcedPort = Number(match[1]);
      }
      if (announcedPort === null) await Bun.sleep(100);
    }
    const stderr = fs.existsSync(errFile) ? fs.readFileSync(errFile, "utf8") : "";
    expect(announcedPort, `messages serve never announced a port\nstderr: ${stderr}`).not.toBeNull();
    try {
      let healthy = false;
      for (let i = 0; i < 50 && !healthy; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${announcedPort}/health`);
          if (res.status === 200) healthy = true;
        } catch {
          // not up yet
        }
        if (!healthy) await Bun.sleep(100);
      }
      expect(healthy).toBe(true);
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 15_000);
});

describe("no command is registered transport-conditionally", () => {
  test("`messages --help` lists every command unconditionally", async () => {
    const proc = Bun.spawn([RUNNER, "run", "src/cli/index.ts", "--help"], {
      cwd: ROOT,
      env: cliEnv({}),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [help, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const status = await proc.exited;
    expect(status, `stderr: ${stderr}`).toBe(0);
    // Every verb of the surface — nothing may be hidden behind a transport.
    for (const cmd of [
      "register",
      "agents",
      "whoami",
      "send",
      "receive",
      "delivery",
      "threads",
      "thread",
      "unread",
      "read",
      "close",
      "reopen",
      "status",
      "serve",
    ]) {
      expect(help, `command ${cmd} must be registered`).toContain(cmd);
    }
    // No transport-gating vocabulary anywhere on the help surface.
    expect(help).not.toContain("not available");
    expect(help).not.toContain("local only");
    expect(help).not.toContain("hosted only");
  });
});

/** Run a CLI invocation that is EXPECTED to fail; returns the exit code. */
async function runCliExpectFailure(args: string[], extraEnv: Record<string, string> = {}): Promise<number | null> {
  const proc = Bun.spawn([RUNNER, "run", "src/cli/index.ts", ...args], {
    cwd: ROOT,
    env: cliEnv(extraEnv),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const status = await proc.exited;
  expect(status, `expected failure, got 0\nstderr: ${stderr}`).not.toBe(0);
  return status;
}