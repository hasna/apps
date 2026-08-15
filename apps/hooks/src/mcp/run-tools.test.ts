/**
 * Regression: MCP run tools (QA-4 bug 4d4c8f0b).
 *
 * (a) hooks_run must reach custom/registry hooks — not just the bundled
 *     catalog gate.
 * (b) the hook's manifest timeout_ms must be honored when the caller does
 *     not pass one (previously the default 10000 was always used).
 * (c) kill-on-timeout must kill the whole process group — no orphaned
 *     children (the sleep that survived with PPID=1).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHooksServer } from "./server.js";
import { closeDb } from "../db/index.js";
import { setPinnedHook, sha256Of } from "../lib/store.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-mcp-runtools-"));

beforeAll(() => {
  closeDb();
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = join(TEST_DIR, "hooks.db");
  process.env.HASNA_HOOKS_LOCK_PATH = join(TEST_DIR, "hooks.lock");
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  delete process.env.HASNA_HOOKS_LOCK_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function customHook(name: string, manifest: Record<string, unknown>, script: string): void {
  const dir = join(TEST_DIR, "hooks", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ events: ["PreToolUse"], script: "script.sh", ...manifest }));
  writeFileSync(join(dir, "script.sh"), script, { mode: 0o755 });
  // Trust it: the pin makes the run path the code under test.
  const content = require("fs").readFileSync(join(dir, "script.sh"));
  setPinnedHook(name, {
    version: (manifest.version as string) ?? "1.0.0",
    sha256: sha256Of(content),
    source: "custom",
  });
}

function parseResult(result: any): any {
  return JSON.parse((result.content as any)[0].text);
}

async function withClient(fn: (client: Client) => Promise<void>): Promise<void> {
  const server = createHooksServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("MCP run tools (QA-4 bug 4d4c8f0b)", () => {
  test("(a) hooks_run reaches a custom hook that is not in the bundled catalog", async () => {
    customHook("qa4-custom", { name: "qa4-custom", version: "1.0.0" }, "#!/bin/bash\necho '{\"continue\":true,\"from\":\"custom\"}'\n");
    await withClient(async (client) => {
      const data = parseResult(await client.callTool({ name: "hooks_run", arguments: { name: "qa4-custom", input: { tool_name: "Bash" } } }));
      expect(data.hook).toBe("qa4-custom");
      expect(data.output.from).toBe("custom");
      expect(data.exitCode).toBe(0);
    });
  });

  test("(b) manifest timeout_ms is honored when the caller passes none", async () => {
    // Script sleeps 1.5s but its manifest timeout is 300ms: without honoring
    // the manifest timeout the run would complete; with it, it times out.
    customHook(
      "qa4-slow",
      { name: "qa4-slow", version: "1.0.0", timeout_ms: 300 },
      "#!/bin/bash\nsleep 1.5\necho '{\"continue\":true}'\n",
    );
    const started = Date.now();
    await withClient(async (client) => {
      const data = parseResult(await client.callTool({ name: "hooks_run", arguments: { name: "qa4-slow", input: {} } }));
      expect(data.timedOut).toBe(true);
      expect(data.timeout_ms).toBe(300);
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1500); // did not wait out the sleep
  });

  test("hooks_run writes a hook_events row per execution (bug ef58dcb7)", async () => {
    customHook("qa4-logged", { name: "qa4-logged", version: "1.0.0" }, "#!/bin/bash\necho '{\"continue\":true}'\n");
    const { getDb } = await import("../db/index.js");
    await withClient(async (client) => {
      const data = parseResult(await client.callTool({ name: "hooks_run", arguments: { name: "qa4-logged", input: { hook_event_name: "PreToolUse", tool_name: "Bash" } } }));
      expect(data.exitCode).toBe(0);
    });
    const rows = getDb().query("SELECT * FROM hook_events WHERE hook_name = 'qa4-logged'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe("PreToolUse");
    expect(JSON.parse(rows[0].metadata).version).toBe("1.0.0");
  });

  test("timeout_ms: 0 / negative / over-max are rejected, never treated as 'no timeout'", async () => {
    customHook("qa4-bound", { name: "qa4-bound", version: "1.0.0" }, "#!/bin/bash\nsleep 30\necho '{}'\n");
    await withClient(async (client) => {
      for (const bad of [0, -1, 999999999]) {
        const result = await client.callTool({ name: "hooks_run", arguments: { name: "qa4-bound", input: {}, timeout_ms: bad } });
        // Zod schema validation failure surfaces as a tool error.
        expect(result.isError ?? false, `timeout_ms=${bad} should be rejected`).toBe(true);
      }
    });
  });

  test("(c) timeout kills the whole process group — no orphaned child", async () => {
    // Foreground work exceeds the manifest timeout; a grandchild is
    // backgrounded in a subshell so it survives the direct child alone.
    // The script records its own PID and process group so the test can
    // assert on the exact processes, not a name pattern (the old behavior
    // left `sleep 30` alive with PPID 1).
    const pidFile = join(TEST_DIR, "orphan-pids.txt");
    customHook(
      "qa4-orphan",
      { name: "qa4-orphan", version: "1.0.0", timeout_ms: 200 },
      `#!/bin/bash\n(sleep 30 &)\necho "hookpid=\$\$ pgid=\$(ps -o pgid= -p \$\$ | tr -d ' ')" > ${pidFile}\nsleep 0.5\necho '{"continue":true}'\n`,
    );
    await withClient(async (client) => {
      const data = parseResult(await client.callTool({ name: "hooks_run", arguments: { name: "qa4-orphan", input: {} } }));
      expect(data.timedOut).toBe(true);
    });
    const recorded = readFileSync(pidFile, "utf-8").trim();
    const pidMatch = /hookpid=(\d+) pgid=(\d+)/.exec(recorded);
    expect(pidMatch).not.toBeNull();
    const hookPid = Number(pidMatch![1]);
    const pgid = Number(pidMatch![2]);
    expect(pgid).toBe(hookPid); // detached spawn: the hook leads its own group

    // Give the kill a moment to settle, then assert the exact hook process
    // and its group are gone (the old direct-child-kill left the backgrounded
    // sleep alive with PPID 1).
    await new Promise((r) => setTimeout(r, 600));
    const probe = require("child_process").spawnSync("bash", [
      "-c",
      `kill -0 ${hookPid} 2>/dev/null; echo hook_alive=$?; ps -eo pid,pgid,comm | awk -v g=${pgid} '$2 == g {print $1, $3}' | head -5; echo end`,
    ]);
    const probeOut = probe.stdout.toString();
    expect(probeOut).toContain("hook_alive=1"); // kill -0 fails: process gone
    const groupSurvivors = probeOut.split("\n").filter((line: string) => /^\d+ \d+ sleep$/.test(line.trim()));
    expect(groupSurvivors).toHaveLength(0);
  });
});
