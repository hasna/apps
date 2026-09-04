/**
 * CLI surface smoke test — the CLI is an interface layer over the domain.
 * Exercises send + threads end-to-end against the local SQLite store via the
 * CLI's own module, with local mode chosen EXPLICITLY (HASNA_MESSAGES_LOCAL=1
 * + HASNA_MESSAGES_SQLITE_PATH pointed at a temp file) — plus the fail-closed
 * contract: without the fleet API env AND without the local opt-in the CLI
 * exits non-zero, names HASNA_MESSAGES_API_URL, and creates no local db.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

let tmpDir: string;
let sqlitePath: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "messages-cli-test-"));
  sqlitePath = path.join(tmpDir, "messages.db");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Hermetic spawn env: strip every inherited HASNA_MESSAGES_ or MESSAGES_
 * prefixed key (a shell or wrapper that exported the fleet env must not flip
 * these tests onto the network or past the fail-closed gate), then apply the
 * extras. */
function cliEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("HASNA_MESSAGES_") || key.startsWith("MESSAGES_")) continue;
    // The conversations identity is an accepted --agent default (#1602), so a
    // shell that exported it must not satisfy the fail-closed tests below.
    if (key === "CONVERSATIONS_AGENT_ID") continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

function runCli(args: string[], extraEnv: Record<string, string> = {}): { stdout: string; stderr: string; status: number } {
  const res = spawnSync("bun", ["run", "src/cli/index.ts", ...args], {
    cwd: path.resolve(import.meta.dir, "..", ".."),
    // Local-mode tests below opt in explicitly; a fail-closed test can
    // override HASNA_MESSAGES_LOCAL back to "" to clear the opt-in.
    env: cliEnv({ HASNA_MESSAGES_SQLITE_PATH: sqlitePath, HASNA_MESSAGES_LOCAL: "1", ...extraEnv }),
    encoding: "utf8",
  });
  return { stdout: res.stdout, stderr: res.stderr ?? "", status: res.status ?? -1 };
}

describe("messages CLI", () => {
  test("send writes a message; threads lists it with an unread count", async () => {
    const send = runCli(["send", "--from", "augustus", "--to", "silvanus", "--content", "cli hello"]);
    expect(send.status).toBe(0);
    const sent = JSON.parse(send.stdout) as { message: { id: string; thread_id: string } };
    expect(sent.message.thread_id).toBeTruthy();

    const threads = runCli(["threads", "--agent", "silvanus"]);
    expect(threads.status).toBe(0);
    const listed = JSON.parse(threads.stdout) as Array<{ id: string; unread_count: number; last_message_preview: string | null }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(sent.message.thread_id);
    expect(listed[0]!.unread_count).toBe(1);
    expect(listed[0]!.last_message_preview).toBe("cli hello");
  });

  test("identity flags default from the station env (#1602)", async () => {
    // No --from / --agent anywhere: the station wrapper's identity is enough.
    const send = runCli(["send", "--to", "flavius", "--content", "env identity"], {
      HASNA_MESSAGES_AGENT_ID: "envsender",
    });
    expect(send.status).toBe(0);
    const sent = JSON.parse(send.stdout) as { message: { from_agent: string; thread_id: string } };
    expect(sent.message.from_agent).toBe("envsender");

    const received = runCli(["receive"], { MESSAGES_AGENT_ID: "flavius" });
    expect(received.status).toBe(0);
    const messages = JSON.parse(received.stdout) as Array<{ content: string }>;
    expect(messages.some((m) => m.content === "env identity")).toBe(true);

    // The conversations identity is accepted as the same actor.
    const whoami = runCli(["whoami"], { CONVERSATIONS_AGENT_ID: "flavius" });
    expect(whoami.status).toBe(0);
    expect((JSON.parse(whoami.stdout) as { name: string }).name).toBe("flavius");

    // An explicit flag still outranks the environment.
    const explicit = runCli(["whoami", "--agent", "explicitus"], { HASNA_MESSAGES_AGENT_ID: "envsender" });
    expect(explicit.status).toBe(0);
    expect((JSON.parse(explicit.stdout) as { name: string }).name).toBe("explicitus");
  });

  test("an unresolvable identity fails closed with an actionable error (#1602)", async () => {
    const res = runCli(["receive"]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("--agent is required");
    expect(res.stderr).toContain("HASNA_MESSAGES_AGENT_ID");
    expect(res.stdout).toBe("");
  });

  test("every data command accepts --json (#1602)", async () => {
    const send = runCli(["send", "--from", "jsoner", "--to", "flavius", "--content", "json flag", "--json"]);
    expect(send.status).toBe(0);
    expect(JSON.parse(send.stdout)).toHaveProperty("message");

    const agents = runCli(["agents", "--json"]);
    expect(agents.status).toBe(0);
    const listed = JSON.parse(agents.stdout) as Array<{ name: string }>;
    expect(listed.some((a) => a.name === "jsoner")).toBe(true);

    for (const args of [["whoami", "--agent", "jsoner", "--json"], ["threads", "--agent", "jsoner", "--json"], ["unread", "--agent", "jsoner", "--json"]]) {
      const res = runCli(args);
      expect(res.status).toBe(0);
      expect(() => JSON.parse(res.stdout)).not.toThrow();
    }
  });

  test("send refuses missing required flags", async () => {
    const res = runCli(["send", "--from", "augustus"]);
    expect(res.status).not.toBe(0);
  });

  test("delivery state machine over the CLI: stored -> delivered via receive -> read", async () => {
    // Distinct agents isolate this test from the shared temp DB.
    const sender = "caius";
    const recipient = "titus";
    const send = runCli(["send", "--from", sender, "--to", recipient, "--content", "delivery probe"]);
    expect(send.status).toBe(0);
    const sent = JSON.parse(send.stdout) as { message: { id: string; thread_id: string } };

    // Before receive: per-recipient state 'stored'.
    const before = JSON.parse(runCli(["delivery", "--id", sent.message.thread_id]).stdout) as Array<{ deliveries: Array<{ recipient: string; state: string }> }>;
    expect(before[0]!.deliveries[0]!.state).toBe("stored");

    // Receive drains -> delivered.
    const received = JSON.parse(runCli(["receive", "--agent", recipient]).stdout) as Array<{ delivery: { state: string } }>;
    expect(received).toHaveLength(1);
    expect(received[0]!.delivery.state).toBe("delivered");

    const after = JSON.parse(runCli(["delivery", "--id", sent.message.thread_id]).stdout) as Array<{ deliveries: Array<{ state: string }> }>;
    expect(after[0]!.deliveries[0]!.state).toBe("delivered");

    // Read -> unread clears.
    expect(JSON.parse(runCli(["read", "--id", sent.message.thread_id, "--agent", recipient]).stdout).ok).toBe(true);
    const unread = JSON.parse(runCli(["unread", "--agent", recipient]).stdout) as { total: number };
    expect(unread.total).toBe(0);
  });

  test("thread close/reopen over the CLI", async () => {
    const send = runCli(["send", "--from", "augustus", "--to", "silvanus", "--content", "close me"]);
    const sent = JSON.parse(send.stdout) as { message: { thread_id: string } };
    expect(runCli(["close", "--id", sent.message.thread_id, "--agent", "silvanus"]).status).toBe(0);
    const open = JSON.parse(runCli(["threads", "--agent", "silvanus"]).stdout) as Array<{ id: string }>;
    expect(open.map((t) => t.id)).not.toContain(sent.message.thread_id);
    expect(runCli(["reopen", "--id", sent.message.thread_id, "--agent", "silvanus"]).status).toBe(0);
    const reopened = JSON.parse(runCli(["threads", "--agent", "silvanus"]).stdout) as Array<{ id: string }>;
    expect(reopened.map((t) => t.id)).toContain(sent.message.thread_id);
  });
});

describe("messages CLI fails closed without the fleet API env", () => {
  test("a verb without HASNA_MESSAGES_API_URL and without the local opt-in exits non-zero, names the required env, and creates no local database", () => {
    const noDbRoot = path.join(tmpDir, "fail-closed-no-db");
    const res = runCli(["send", "--from", "augustus", "--to", "silvanus", "--content", "must not land"], {
      HASNA_MESSAGES_LOCAL: "", // clear the default opt-in from runCli
      HASNA_MESSAGES_SQLITE_PATH: path.join(noDbRoot, "messages.db"),
      HASNA_DATA_HOME: noDbRoot,
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("HASNA_MESSAGES_API_URL");
    expect(res.stderr).toContain("HASNA_MESSAGES_LOCAL=1");
    // No store was ever constructed: no data root, no database file.
    expect(fs.existsSync(noDbRoot)).toBe(false);
  });

  test("the explicit local opt-in (HASNA_MESSAGES_LOCAL=1) still works without the API env", async () => {
    // Earlier tests in this file registered agents into the shared temp db;
    // the point here is that the opt-in lets verbs reach that local store.
    const res = runCli(["agents"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("silvanus");
  });
});
