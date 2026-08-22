import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMutationApprovalToken, mutationArgsSha256 } from "../src/commands/mutation-approval.js";

const mutationSecret = "events-cli-test-secret";

function mutationEnv(dir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HASNA_EVENTS_DIR: join(dir, "events"),
    HASNA_STATIONS_MUTATION_TOKEN: mutationSecret,
    HASNA_STATIONS_ALLOW_MUTATIONS: "0",
    HASNA_STATIONS_MUTATION_APPROVAL: "0",
  };
}

function eventStoreDir(dir: string): string {
  return join(dir, "events");
}

function eventStoreResourceId(kind: string, dir: string, ...parts: Array<string | number | boolean | undefined | null>): string {
  const values = [mutationArgsSha256({ event_store_dir: eventStoreDir(dir) }), ...parts]
    .map((part) => String(part ?? "*").trim())
    .filter(Boolean)
    .join(":");
  return `${kind}:${values}`;
}

function withEventStoreScope(dir: string, args: Record<string, unknown>): Record<string, unknown> {
  return { event_store_dir: eventStoreDir(dir), ...args };
}

function approvalToken(operation: string, resourceId: string, args: unknown): string {
  return createMutationApprovalToken({
    surface: "cli",
    operation,
    transport: "cli",
    callerId: "cli",
    runId: "cli",
    resourceId,
    args,
  }, { secret: mutationSecret });
}

function runtimeTmuxApproval(dir: string, target: string, tmuxCommand: string, options: {
  once?: boolean;
  intervalMs?: number;
  maxChecks?: number;
} = {}): string {
  const once = options.once === true;
  const eventTypes = once ? ["stations.tmux.pane_missing"] : ["stations.tmux.pane_died"];
  const intervalMs = once ? undefined : options.intervalMs ?? 5000;
  return approvalToken("stations_runtime_tmux_watch_deliver", eventStoreResourceId("runtime-tmux-watch", dir, target.trim(), eventTypes.join(",")), withEventStoreScope(dir, {
    target: target.trim(),
    event_types: eventTypes,
    interval_ms: intervalMs,
    max_checks: once ? 1 : options.maxChecks,
    once,
    emit_initial_missing: once,
    deliver: true,
    tmux_command: tmuxCommand,
  }));
}

async function runStationsCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const child = Bun.spawn({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("events CLI surface", () => {
  test("exposes shared webhooks and events commands", async () => {
    const child = Bun.spawn({
      cmd: ["bun", "run", "src/cli/index.ts", "--help"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("webhooks");
    expect(stdout).toContain("events");
    expect(stdout).toContain("runtime");
  });

  test("runtime tmux one-shot emits a shared event without touching real tmux", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-runtime-cli-"));
    try {
      const fakeTmux = join(dir, "tmux");
      writeFileSync(fakeTmux, "#!/bin/sh\nprintf '%s\\n' \"can't find pane\" >&2\nexit 1\n", { mode: 0o700 });
      const child = Bun.spawn({
        cmd: [
          "bun",
          "run",
          "src/cli/index.ts",
          "runtime",
          "tmux-watch",
          "%11",
          "--once",
          "--no-deliver",
          "--json",
        ],
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HASNA_EVENTS_DIR: join(dir, "events"),
          HASNA_STATIONS_TMUX_BIN: fakeTmux,
        },
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.status).toBe("missing");
      expect(result.emitted.event.type).toBe("stations.tmux.pane_missing");
      expect(result.emitted.event.data.target).toBe("%11");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runtime tmux delivery requires scoped approval but no-deliver remains usable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-runtime-cli-"));
    try {
      const fakeTmux = join(dir, "tmux");
      const proof = join(dir, "runtime-proof.txt");
      writeFileSync(fakeTmux, "#!/bin/sh\nprintf '%s\\n' \"can't find pane\" >&2\nexit 1\n", { mode: 0o700 });
      mkdirSync(eventStoreDir(dir), { recursive: true });
      writeFileSync(join(eventStoreDir(dir), "channels.json"), `${JSON.stringify([
        {
          id: "runtime-command",
          enabled: true,
          transport: "command",
          command: { command: "sh", args: ["-c", "printf runtime > \"$1\"", "sh", proof] },
          filters: [{ source: "stations", type: "stations.tmux.pane_missing" }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ], null, 2)}\n`);

      const env = {
        ...mutationEnv(dir),
        HASNA_STATIONS_TMUX_BIN: fakeTmux,
      };
      const withoutToken = await runStationsCli(["runtime", "tmux-watch", "%11", "--once", "--json"], env);
      expect(withoutToken.exitCode).not.toBe(0);
      expect(withoutToken.stderr).toContain("requires operator approval");
      expect(existsSync(proof)).toBe(false);
      expect(existsSync(join(eventStoreDir(dir), "events.json"))).toBe(false);

      const wrongStoreToken = runtimeTmuxApproval(join(dir, "other-store-root"), "%11", fakeTmux, { once: true });
      const wrongStore = await runStationsCli(["runtime", "tmux-watch", "%11", "--once", "--json", "--approval-token", wrongStoreToken], env);
      expect(wrongStore.exitCode).not.toBe(0);
      expect(wrongStore.stderr).toContain("requires operator approval");
      expect(existsSync(proof)).toBe(false);
      expect(existsSync(join(eventStoreDir(dir), "events.json"))).toBe(false);

      const noDeliver = await runStationsCli(["runtime", "tmux-watch", "%11", "--once", "--no-deliver", "--json"], env);
      expect(noDeliver.stderr).toBe("");
      expect(noDeliver.exitCode).toBe(0);
      expect(JSON.parse(noDeliver.stdout).emitted.event.type).toBe("stations.tmux.pane_missing");
      expect(existsSync(proof)).toBe(false);
      const recordedEvents = JSON.parse(readFileSync(join(eventStoreDir(dir), "events.json"), "utf8"));
      expect(recordedEvents.at(-1).type).toBe("stations.tmux.pane_missing");

      const token = runtimeTmuxApproval(dir, "%11", fakeTmux, { once: true });
      const tampered = await runStationsCli(["runtime", "tmux-watch", "%22", "--once", "--json", "--approval-token", token], env);
      expect(tampered.exitCode).not.toBe(0);
      expect(tampered.stderr).toContain("requires operator approval");
      expect(existsSync(proof)).toBe(false);

      const delivered = await runStationsCli(["runtime", "tmux-watch", "%11", "--once", "--json", "--approval-token", token], env);
      expect(delivered.stderr).toBe("");
      expect(delivered.exitCode).toBe(0);
      expect(JSON.parse(delivered.stdout).emitted.event.type).toBe("stations.tmux.pane_missing");
      expect(readFileSync(proof, "utf8")).toBe("runtime");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runtime tmux watch mode uses pane_died approval scope", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-runtime-cli-"));
    try {
      const fakeTmux = join(dir, "tmux");
      const countFile = join(dir, "tmux-count");
      const proof = join(dir, "runtime-died-proof.txt");
      writeFileSync(fakeTmux, `#!/bin/sh
count_file=${JSON.stringify(countFile)}
count=$(cat "$count_file" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s' "$count" > "$count_file"
if [ "$count" -eq 1 ]; then
  printf '%%11\\n'
  exit 0
fi
printf '%s\\n' "can't find pane" >&2
exit 1
`, { mode: 0o700 });
      mkdirSync(eventStoreDir(dir), { recursive: true });
      writeFileSync(join(eventStoreDir(dir), "channels.json"), `${JSON.stringify([
        {
          id: "runtime-died-command",
          enabled: true,
          transport: "command",
          command: { command: "sh", args: ["-c", "printf died > \"$1\"", "sh", proof] },
          filters: [{ source: "stations", type: "stations.tmux.pane_died" }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ], null, 2)}\n`);
      const env = {
        ...mutationEnv(dir),
        HASNA_STATIONS_TMUX_BIN: fakeTmux,
      };

      const onceToken = runtimeTmuxApproval(dir, "%11", fakeTmux, { once: true });
      const wrongEventScope = await runStationsCli(["runtime", "tmux-watch", "%11", "--max-checks", "2", "--interval-ms", "0", "--json", "--approval-token", onceToken], env);
      expect(wrongEventScope.exitCode).not.toBe(0);
      expect(wrongEventScope.stderr).toContain("requires operator approval");
      expect(existsSync(proof)).toBe(false);

      const watchToken = runtimeTmuxApproval(dir, "%11", fakeTmux, { intervalMs: 0, maxChecks: 2 });
      const delivered = await runStationsCli(["runtime", "tmux-watch", "%11", "--max-checks", "2", "--interval-ms", "0", "--json", "--approval-token", watchToken], env);
      expect(delivered.stderr).toBe("");
      expect(delivered.exitCode).toBe(0);
      const result = JSON.parse(delivered.stdout);
      expect(result.status).toBe("died");
      expect(result.emitted.event.type).toBe("stations.tmux.pane_died");
      expect(readFileSync(proof, "utf8")).toBe("died");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runtime tmux validates blank targets before approval", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-runtime-cli-"));
    try {
      const result = await runStationsCli(["runtime", "tmux-watch", "", "--once", "--json"], mutationEnv(dir));
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("tmux pane target is required");
      expect(result.stderr).not.toContain("requires operator approval");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runtime tmux hook plan requires explicit mutation mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-runtime-hook-plan-"));
    try {
      const env = mutationEnv(dir);
      const denied = await runStationsCli(["runtime", "tmux-hook-plan", "--json"], env);
      expect(denied.exitCode).not.toBe(0);
      expect(denied.stderr).toContain("requires --approval-token or explicit --trusted-local-mutation");

      const trusted = await runStationsCli(["runtime", "tmux-hook-plan", "--trusted-local-mutation", "--json"], env);
      expect(trusted.stderr).toBe("");
      expect(trusted.exitCode).toBe(0);
      expect(JSON.parse(trusted.stdout).trustedLocalMutation).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runtime tmux hook plan rejects dependency-owned events bins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-runtime-hook-plan-"));
    try {
      const env = mutationEnv(dir);
      for (const command of ["events", "hasna-events", "/tmp/node_modules/.bin/events", "/tmp/node_modules/.bin/hasna-events"]) {
        const result = await runStationsCli(["runtime", "tmux-hook-plan", "--trusted-local-mutation", "--stations-command", command, "--json"], env);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("must invoke the stations CLI");
      }

      const allowed = await runStationsCli(["runtime", "tmux-hook-plan", "--trusted-local-mutation", "--stations-command", "/opt/bin/stations", "--json"], env);
      expect(allowed.stderr).toBe("");
      expect(allowed.exitCode).toBe(0);
      expect(JSON.parse(allowed.stdout).shellCommand).toContain("/opt/bin/stations");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("webhooks add requires scoped approval and binds target arguments", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-events-cli-"));
    const env = mutationEnv(dir);
    try {
      const withoutToken = await runStationsCli(["webhooks", "add", "https://example.com/hook", "--id", "ops", "--json"], env);
      expect(withoutToken.exitCode).not.toBe(0);
      expect(withoutToken.stderr).toContain("requires operator approval");

      const args = {
        channel_id: "ops",
        target: "https://example.com/hook",
        transport: "webhook",
        name: undefined,
        event_type: undefined,
        source: undefined,
        subject: undefined,
        severity: undefined,
        secret: undefined,
        headers: undefined,
        args: [],
        timeout_ms: undefined,
        retry_attempts: undefined,
        retry_backoff_ms: undefined,
        redact: [],
        enabled: true,
      };
      const token = approvalToken("stations_webhooks_add", eventStoreResourceId("webhook", dir, "ops"), withEventStoreScope(dir, args));
      const tampered = await runStationsCli(["webhooks", "add", "https://evil.example/hook", "--id", "ops", "--json", "--approval-token", token], env);
      expect(tampered.exitCode).not.toBe(0);
      expect(tampered.stderr).toContain("requires operator approval");

      const added = await runStationsCli(["webhooks", "add", "https://example.com/hook", "--id", "ops", "--json", "--approval-token", token], env);
      expect(added.stderr).toBe("");
      expect(added.exitCode).toBe(0);
      expect(JSON.parse(added.stdout).id).toBe("ops");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("events and webhooks list stay read-only without approval", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-events-cli-"));
    const env = mutationEnv(dir);
    try {
      const webhooks = await runStationsCli(["webhooks", "list", "--json"], env);
      expect(webhooks.stderr).toBe("");
      expect(webhooks.exitCode).toBe(0);
      expect(JSON.parse(webhooks.stdout)).toEqual([]);

      const events = await runStationsCli(["events", "list", "--json"], env);
      expect(events.stderr).toBe("");
      expect(events.exitCode).toBe(0);
      expect(JSON.parse(events.stdout)).toEqual([]);
      expect(existsSync(eventStoreDir(dir))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("webhooks test and remove require scoped approval", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-events-cli-"));
    const env = mutationEnv(dir);
    try {
      const addArgs = {
        channel_id: "cmd",
        target: "/bin/echo",
        transport: "command",
        name: undefined,
        event_type: undefined,
        source: undefined,
        subject: undefined,
        severity: undefined,
        secret: undefined,
        headers: undefined,
        args: ["ok"],
        timeout_ms: undefined,
        retry_attempts: undefined,
        retry_backoff_ms: undefined,
        redact: [],
        enabled: true,
      };
      const addToken = approvalToken("stations_webhooks_add", eventStoreResourceId("webhook", dir, "cmd"), withEventStoreScope(dir, addArgs));
      const added = await runStationsCli(["webhooks", "add", "/bin/echo", "--transport", "command", "--arg", "ok", "--id", "cmd", "--json", "--approval-token", addToken], env);
      expect(added.stderr).toBe("");
      expect(added.exitCode).toBe(0);

      const testWithoutToken = await runStationsCli(["webhooks", "test", "cmd", "--message", "approved", "--json"], env);
      expect(testWithoutToken.exitCode).not.toBe(0);
      expect(testWithoutToken.stderr).toContain("requires operator approval");

      const testArgs = {
        channel_id: "cmd",
        event_type: "events.test",
        subject: "cmd",
        message: "approved",
        data: { test: true },
      };
      const testToken = approvalToken("stations_webhooks_test", eventStoreResourceId("webhook-test", dir, "cmd", "events.test"), withEventStoreScope(dir, testArgs));
      const tamperedTest = await runStationsCli(["webhooks", "test", "cmd", "--message", "tampered", "--json", "--approval-token", testToken], env);
      expect(tamperedTest.exitCode).not.toBe(0);
      expect(tamperedTest.stderr).toContain("requires operator approval");
      const tested = await runStationsCli(["webhooks", "test", "cmd", "--message", "approved", "--json", "--approval-token", testToken], env);
      expect(tested.stderr).toBe("");
      expect(tested.exitCode).toBe(0);
      expect(JSON.parse(tested.stdout).channelId).toBe("cmd");

      const removeWithoutToken = await runStationsCli(["webhooks", "remove", "cmd", "--json"], env);
      expect(removeWithoutToken.exitCode).not.toBe(0);
      expect(removeWithoutToken.stderr).toContain("requires operator approval");
      const removeToken = approvalToken("stations_webhooks_remove", eventStoreResourceId("webhook", dir, "cmd"), withEventStoreScope(dir, { channel_id: "cmd" }));
      const removed = await runStationsCli(["webhooks", "remove", "cmd", "--json", "--approval-token", removeToken], env);
      expect(removed.stderr).toBe("");
      expect(removed.exitCode).toBe(0);
      expect(JSON.parse(removed.stdout).removed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("events emit requires scoped approval and binds payload arguments", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-events-cli-"));
    const env = mutationEnv(dir);
    try {
      const withoutToken = await runStationsCli(["events", "emit", "stations.test", "--message", "hello", "--no-deliver", "--json"], env);
      expect(withoutToken.exitCode).not.toBe(0);
      expect(withoutToken.stderr).toContain("requires operator approval");

      const args = {
        event_type: "stations.test",
        source: "stations",
        subject: undefined,
        severity: "info",
        message: "hello",
        data: {},
        metadata: {},
        dedupe_key: undefined,
        deliver: false,
        dedupe: true,
      };
      const token = approvalToken("stations_events_emit", eventStoreResourceId("event", dir, "stations.test", undefined, undefined), withEventStoreScope(dir, args));
      const tampered = await runStationsCli(["events", "emit", "stations.test", "--message", "changed", "--no-deliver", "--json", "--approval-token", token], env);
      expect(tampered.exitCode).not.toBe(0);
      expect(tampered.stderr).toContain("requires operator approval");

      const otherDir = mkdtempSync(join(tmpdir(), "stations-events-cli-other-"));
      try {
        const otherEnv = mutationEnv(otherDir);
        const otherStore = await runStationsCli(["events", "emit", "stations.test", "--message", "hello", "--no-deliver", "--json", "--approval-token", token], otherEnv);
        expect(otherStore.exitCode).not.toBe(0);
        expect(otherStore.stderr).toContain("requires operator approval");
        expect(existsSync(eventStoreDir(otherDir))).toBe(false);
      } finally {
        rmSync(otherDir, { recursive: true, force: true });
      }

      const emitted = await runStationsCli(["events", "emit", "stations.test", "--message", "hello", "--no-deliver", "--json", "--approval-token", token], env);
      expect(emitted.stderr).toBe("");
      expect(emitted.exitCode).toBe(0);
      expect(JSON.parse(emitted.stdout).event.type).toBe("stations.test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("events replay allows dry-run but gates non-dry-run replay", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-events-cli-"));
    const env = mutationEnv(dir);
    try {
      const emitToken = approvalToken("stations_events_emit", eventStoreResourceId("event", dir, "stations.replay", undefined, undefined), withEventStoreScope(dir, {
        event_type: "stations.replay",
        source: "stations",
        subject: undefined,
        severity: "info",
        message: "stored",
        data: {},
        metadata: {},
        dedupe_key: undefined,
        deliver: false,
        dedupe: true,
      }));
      const emitted = await runStationsCli(["events", "emit", "stations.replay", "--message", "stored", "--no-deliver", "--json", "--approval-token", emitToken], env);
      expect(emitted.exitCode).toBe(0);

      const dryRun = await runStationsCli(["events", "replay", "--dry-run", "--json"], env);
      expect(dryRun.stderr).toBe("");
      expect(dryRun.exitCode).toBe(0);
      expect(JSON.parse(dryRun.stdout).events.length).toBe(1);

      const withoutToken = await runStationsCli(["events", "replay", "--json"], env);
      expect(withoutToken.exitCode).not.toBe(0);
      expect(withoutToken.stderr).toContain("requires operator approval");

      const replayToken = approvalToken("stations_events_replay", eventStoreResourceId("event-replay", dir, undefined, "stations", "stations.replay"), withEventStoreScope(dir, {
        event_id: undefined,
        source: "stations",
        event_type: "stations.replay",
        dry_run: false,
      }));
      const tampered = await runStationsCli(["events", "replay", "--source", "other", "--type", "stations.replay", "--json", "--approval-token", replayToken], env);
      expect(tampered.exitCode).not.toBe(0);
      expect(tampered.stderr).toContain("requires operator approval");

      const replayed = await runStationsCli(["events", "replay", "--source", "stations", "--type", "stations.replay", "--json", "--approval-token", replayToken], env);
      expect(replayed.stderr).toBe("");
      expect(replayed.exitCode).toBe(0);
      expect(JSON.parse(replayed.stdout).events.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("storage commands hand off approved CLI mutations to the storage layer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-storage-cli-"));
    const env = {
      ...mutationEnv(dir),
      HASNA_STATIONS_DATABASE_URL: "",
      STATIONS_DATABASE_URL: "",
    };
    try {
      const tables = ["agent_heartbeats"];
      const withoutToken = await runStationsCli(["storage", "push", "--tables", "agent_heartbeats", "--json"], env);
      expect(withoutToken.exitCode).not.toBe(0);
      expect(withoutToken.stderr).toContain("requires operator approval");

      const token = approvalToken("storage_push", "storage-push:agent_heartbeats", { tables });
      const approved = await runStationsCli(["storage", "push", "--tables", "agent_heartbeats", "--json", "--approval-token", token], env);
      expect(approved.exitCode).not.toBe(0);
      expect(approved.stderr).toContain("Missing HASNA_STATIONS_DATABASE_URL");
      expect(approved.stderr).not.toContain("sdk.stations_storage_push requires");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
