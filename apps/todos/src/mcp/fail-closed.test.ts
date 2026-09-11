/**
 * The stdio MCP server fails closed (hasna/apps#1720 validation, round 1).
 *
 * Three defects measured on the pristine tree, each pinned here:
 *
 *   1. `todos-mcp` called `startRuntimeShadowDrain(getDatabase())` before any
 *      authority decision, so a server with NO credential answered
 *      `initialize`, served tools, and created `~/.hasna/todos/todos.db`
 *      (+ -wal/-shm, migrations, a machine heartbeat) under whatever HOME it
 *      was given.
 *   2. On the HOSTED route the `todos://` resources and the local-only tool
 *      families read the local SQLite with no gate: `resources/read
 *      todos://projects` answered `[]` while the fleet held thousands of
 *      projects, and `machines_list` served the local station row.
 *   3. `REMOTE_API_*` refusals reached the client as `UNKNOWN_ERROR`.
 *
 * Every run here is hermetic, built by OMISSION the way `cli/fail-closed.test.ts`
 * builds its env: a HOME and HASNA_HOME the test owns (the disk credential tier
 * and the store are both anchored there), the Keychain tier pointed at an
 * account no item uses, and no inherited fleet variable at all. The frames go
 * over raw stdio JSON-RPC rather than the SDK client, because the assertion in
 * the negative case is precisely that `initialize` is NEVER answered — a client
 * would hang waiting for it.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TODOS_TEST_KEYCHAIN_ACCOUNT } from "../testing.js";

setDefaultTimeout(120_000);

const ROOT = join(import.meta.dir, "..", "..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  }
});

interface HermeticRun {
  root: string;
  home: string;
  hasnaHome: string;
  env: Record<string, string>;
}

/**
 * An environment built by omission: nothing from the ambient shell reaches the
 * child, so neither the developer's real API pair nor a global HASNA_PROFILE
 * nor a stray HASNA_TODOS_LOCAL can turn a run green or red for the wrong
 * reason.
 */
function hermetic(label: string, overrides: Record<string, string> = {}): HermeticRun {
  const root = mkdtempSync(join(tmpdir(), `todos-mcp-fail-closed-${label}-`));
  tempRoots.push(root);
  const home = join(root, "home");
  const hasnaHome = join(root, "hasna-home");
  mkdirSync(home, { recursive: true });
  return {
    root,
    home,
    hasnaHome,
    env: {
      HOME: home,
      HASNA_HOME: hasnaHome,
      PATH: process.env["PATH"] ?? "",
      HASNA_STATION: TODOS_TEST_KEYCHAIN_ACCOUNT,
      ...overrides,
    },
  };
}

/** Recursively list every *.db / *.sqlite / *.sqlite3 file under a root (missing root: none). */
function sqliteFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
    else if (/\.(?:db|sqlite3?)(?:-wal|-shm)?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** A loopback port nothing listens on, so a hosted request is refused at once. */
function closedLoopbackPort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  return port;
}

type JsonRpcFrame = { id?: number; result?: unknown; error?: { code: number; message: string }; raw?: string };

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fail-closed-test", version: "0" } },
};
const INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };

interface DriveResult {
  exitCode: number | null;
  responses: JsonRpcFrame[];
  stderr: string;
}

/**
 * Spawn the server, send `initialize` + the given requests (ids 2..n), and
 * collect what comes back. `expectExit` waits for the process to end on its
 * own; otherwise the run ends once every request id has been answered (or the
 * deadline passes), and the server is killed.
 */
async function driveMcp(
  env: Record<string, string>,
  requests: Array<Record<string, unknown>>,
  options: { expectExit?: boolean; timeoutMs?: number } = {},
): Promise<DriveResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const proc = Bun.spawn(["bun", "run", "src/mcp/index.ts"], {
    cwd: ROOT,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const frames = [INITIALIZE, INITIALIZED, ...requests.map((request, index) => ({ jsonrpc: "2.0", id: index + 2, ...request }))];
  proc.stdin.write(frames.map((frame) => `${JSON.stringify(frame)}\n`).join(""));
  proc.stdin.flush();

  const wanted = new Set<number>([1, ...requests.map((_, index) => index + 2)]);
  const responses: JsonRpcFrame[] = [];
  const decoder = new TextDecoder();
  let buffer = "";
  const ingest = (chunk: Uint8Array) => {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        responses.push(JSON.parse(line) as JsonRpcFrame);
      } catch {
        responses.push({ raw: line });
      }
    }
  };
  const answered = () => [...wanted].every((id) => responses.some((frame) => frame.id === id));

  const reader = proc.stdout.getReader();
  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      ingest(value);
      if (!options.expectExit && answered()) return;
    }
  })();

  const deadline = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
  if (options.expectExit) {
    const outcome = await Promise.race([proc.exited.then(() => "exited" as const), deadline]);
    if (outcome === "timeout") proc.kill();
  } else {
    await Promise.race([pump, proc.exited, deadline]);
    proc.kill();
  }
  const exitCode = await proc.exited;
  await pump.catch(() => {});
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, responses, stderr };
}

function toolText(frame: JsonRpcFrame | undefined): { text: string; isError: boolean } {
  const result = frame?.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
  return { text: result?.content?.[0]?.text ?? "", isError: result?.isError === true };
}

describe("todos-mcp fails closed with no credential", () => {
  test("exits non-zero before answering initialize, names the tiers, and creates no local store", async () => {
    const run = hermetic("negative");

    const result = await driveMcp(run.env, [{ method: "tools/list" }], { expectExit: true, timeoutMs: 20_000 });

    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).not.toBeNull();
    // NOTHING came back over stdio: no initialize result, no tools, no frame at all.
    expect(result.responses).toEqual([]);
    // The FIRST stderr line names where the credential should live and the only way to go local.
    const firstLine = result.stderr.split("\n").find((line) => line.trim().length > 0) ?? "";
    expect(firstLine).toMatch(/^REMOTE_API_CONFIG_MISSING:/);
    expect(firstLine).toContain("hasna.credentials.todos.api-key");
    expect(firstLine).toContain("~/.hasna/todos/config/credentials");
    expect(firstLine).toContain("HASNA_TODOS_API_KEY");
    expect(firstLine).toContain("HASNA_TODOS_LOCAL=1");
    expect(firstLine).toMatch(/fail\w*\s*closed/i);
    // No local-fallback event, no local store under either root.
    expect(result.stderr).not.toContain("local-fallback");
    expect(sqliteFilesUnder(run.root)).toEqual([]);
    expect(existsSync(join(run.home, ".hasna", "todos"))).toBe(false);
    expect(existsSync(join(run.hasnaHome, "todos"))).toBe(false);
  });

  test("a profile that names no credential fails before serving instead of falling through", async () => {
    const run = hermetic("profile", { HASNA_PROFILE: "no-such-profile" });
    const result = await driveMcp(run.env, [], { expectExit: true, timeoutMs: 20_000 });
    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).not.toBeNull();
    expect(result.responses).toEqual([]);
    const firstLine = result.stderr.split("\n").find((line) => line.trim().length > 0) ?? "";
    expect(firstLine).toMatch(/^REMOTE_API_CREDENTIAL_INVALID:/);
    expect(firstLine).toContain("no-such-profile");
    expect(firstLine).toContain("HASNA_PROFILE");
    expect(sqliteFilesUnder(run.root)).toEqual([]);
  });

  test("a vault pointer that cannot be completed is TERMINAL for every request, and opens no store", async () => {
    // The pointer tier is a deliberate selection the resolver completes at
    // REQUEST time (same as the CLI: stage A admits it, the first read fails
    // terminal). The server therefore comes up on the HOSTED route, and every
    // tool call refuses under REMOTE_API_CREDENTIAL_INVALID — never
    // UNREACHABLE, never a local read, never a fallback to another tier.
    const run = hermetic("pointer", { HASNA_TODOS_API_KEY_REF: "no/such/vault/item" });
    const result = await driveMcp(
      run.env,
      [{ method: "tools/call", params: { name: "get_status", arguments: {} } }],
      { timeoutMs: 60_000 },
    );
    const byId = new Map(result.responses.map((frame) => [frame.id, frame]));
    expect((byId.get(1)?.result as { serverInfo?: { name?: string } } | undefined)?.serverInfo?.name).toBe("todos");
    const status = toolText(byId.get(2));
    expect(status.isError).toBe(true);
    const parsed = JSON.parse(status.text) as { code: string; message: string };
    expect(parsed.code).toBe("REMOTE_API_CREDENTIAL_INVALID");
    expect(parsed.message).toContain("HASNA_TODOS_API_KEY_REF");
    expect(parsed.message).toContain("no/such/vault/item");
    expect(parsed.message).toContain("TERMINAL");
    expect(sqliteFilesUnder(run.root)).toEqual([]);
    expect(result.stderr).not.toContain("LOCAL mode");
  });
});

describe("todos-mcp on the hosted route never opens the local store", () => {
  test("local-only resources and tools refuse with REMOTE_COMMAND_UNSUPPORTED; API-routed tools and hosted refusals keep their code", async () => {
    const port = closedLoopbackPort();
    const run = hermetic("hosted", {
      HASNA_TODOS_API_URL: `http://127.0.0.1:${port}/todos`,
      HASNA_TODOS_API_KEY: "fixture-hosted-credential",
      // `full` registers the machines/dispatch/templates families the finding named.
      TODOS_PROFILE: "full",
    });

    const result = await driveMcp(
      run.env,
      [
        { method: "resources/read", params: { uri: "todos://projects" } },
        { method: "tools/call", params: { name: "machines_list", arguments: {} } },
        { method: "tools/call", params: { name: "list_templates", arguments: {} } },
        { method: "tools/call", params: { name: "list_handoffs", arguments: {} } },
        { method: "tools/call", params: { name: "list_dispatches", arguments: {} } },
        { method: "tools/call", params: { name: "list_tasks", arguments: {} } },
      ],
      { timeoutMs: 60_000 },
    );

    const byId = new Map(result.responses.map((frame) => [frame.id, frame]));
    // The hosted server DID come up: initialize was answered.
    expect((byId.get(1)?.result as { serverInfo?: { name?: string } } | undefined)?.serverInfo?.name).toBe("todos");

    // A `todos://` resource on the hosted route is a JSON-RPC error naming the opt-in — never `[]`.
    const resource = byId.get(2);
    expect(resource?.result).toBeUndefined();
    expect(resource?.error?.message).toContain("REMOTE_COMMAND_UNSUPPORTED");
    expect(resource?.error?.message).toContain("HASNA_TODOS_LOCAL=1");

    // Each still-local-only tool family (handoffs = id 5, dispatches = id 6):
    // isError with the same stable code, passed through by formatError. The
    // machine families are API-routed on the merged tree (hasna/apps#1966), and
    // `list_templates` (id 4) joined them in the PORT-TO-API slice — all three
    // are asserted with the hosted tools below. Handoffs and dispatches stay
    // here because neither has a /v1 route: handoffs is an unported resource
    // family and the dispatch CLI is abandoned.
    for (const id of [5, 6]) {
      const { text, isError } = toolText(byId.get(id));
      expect(isError).toBe(true);
      const parsed = JSON.parse(text) as { code: string; message: string };
      expect(parsed.code).toBe("REMOTE_COMMAND_UNSUPPORTED");
      expect(parsed.message).toContain("HASNA_TODOS_LOCAL=1");
      expect(parsed.message).toContain(`127.0.0.1:${port}`);
    }

    // API-routed tools (machines_list since hasna/apps#1966, list_templates
    // since the PORT-TO-API slice, and list_tasks) reached for the authority
    // (refused at the closed port) and their REMOTE_API_* refusal reaches the
    // client under its own code. A tool moving from the set above into this one
    // is the whole point of the port: the refusal it gives now is "the
    // authority is unreachable", not "this command does not exist here".
    for (const id of [3, 4, 7]) {
      const hosted = toolText(byId.get(id));
      expect(hosted.isError).toBe(true);
      const hostedError = JSON.parse(hosted.text) as { code: string; message: string };
      expect(hostedError.code).toMatch(/^REMOTE_API_/);
      expect(hostedError.code).not.toBe("UNKNOWN_ERROR");
      expect(hostedError.message).toContain("local SQLite fallback is disabled");
    }

    // And through all of it: no SQLite file under either root, no fallback event.
    expect(sqliteFilesUnder(run.root)).toEqual([]);
    expect(result.stderr).not.toContain("local-fallback");
    expect(result.stderr).not.toContain("LOCAL mode");
  });
});

describe("todos-mcp under the explicit local opt-in", () => {
  test("serves the on-box store, says so on stderr, and puts it under HASNA_HOME", async () => {
    const run = hermetic("local", { HASNA_TODOS_LOCAL: "1", TODOS_AUTO_PROJECT: "false" });

    const result = await driveMcp(
      run.env,
      [
        { method: "resources/read", params: { uri: "todos://projects" } },
        // A core (default-profile) tool that reads the store.
        { method: "tools/call", params: { name: "get_status", arguments: {} } },
      ],
      { timeoutMs: 30_000 },
    );

    const byId = new Map(result.responses.map((frame) => [frame.id, frame]));
    expect((byId.get(1)?.result as { serverInfo?: { name?: string } } | undefined)?.serverInfo?.name).toBe("todos");
    // The resource answers from the (empty) local store instead of refusing.
    const contents = (byId.get(2)?.result as { contents?: Array<{ text?: string }> } | undefined)?.contents;
    expect(contents?.[0]?.text).toBe("[]");
    const status = toolText(byId.get(3));
    expect(status.isError).toBe(false);
    expect(JSON.parse(status.text)).toMatchObject({ total: 0 });
    // One line, on stderr, saying it is local and how to go hosted.
    const notice = result.stderr.split("\n").find((line) => line.includes("LOCAL mode")) ?? "";
    expect(notice).toContain("HASNA_TODOS_LOCAL");
    expect(notice).toContain("hasna.credentials.todos.api-key");
    // The store honours HASNA_HOME as the ~/.hasna root: created there, and nowhere under HOME.
    expect(existsSync(join(run.hasnaHome, "todos", "todos.db"))).toBe(true);
    expect(existsSync(join(run.home, ".hasna"))).toBe(false);
  });
});
