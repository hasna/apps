import { describe, expect, test } from "bun:test";
import { EventsClient, JsonEventsStore } from "@hasna/events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("events CLI", () => {
  test("documents compact list and detail affordances in help", () => {
    const help = Bun.spawnSync({
      cmd: ["bun", "run", "src/cli.ts", "events", "--help"],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("ui events show <id>");
    expect(help.stdout.toString()).toContain("--cursor <n>");
    expect(help.stdout.toString()).toContain("compact rows");
  });

  test("emits and lists shared events", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-events-"));
    try {
      const env = { ...process.env, HASNA_EVENTS_DIR: dir };
      const emit = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "emit", "ui.smoke", "--data", "{\"token\":\"secret\"}", "--no-deliver", "--json"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(emit.exitCode).toBe(0);
      const emitted = JSON.parse(emit.stdout.toString());
      expect(emitted.event).toMatchObject({
        source: "ui",
        type: "ui.smoke",
        data: { token: "[REDACTED]" },
      });

      const list = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "list", "--json"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(list.exitCode).toBe(0);
      expect(JSON.parse(list.stdout.toString())[0]).toMatchObject({ type: "ui.smoke" });

      const show = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "show", emitted.event.id],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(show.exitCode).toBe(0);
      expect(show.stdout.toString()).toContain("type: ui.smoke");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("caps event list output by default and preserves json detail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-events-compact-"));
    try {
      const env = { ...process.env, HASNA_EVENTS_DIR: dir };
      // Seed in-process (fast + deterministic) rather than spawning 25
      // subprocesses, which pushed this test past the default 5s timeout.
      const client = new EventsClient({ store: new JsonEventsStore(dir) });
      for (let i = 0; i < 25; i++) {
        await client.emit(
          {
            source: "ui",
            type: `ui.noisy.${i}`,
            message: "A long event message that should stay out of the default list output.",
            data: { index: i, token: "secret", body: "x".repeat(160) },
          },
          { deliver: false },
        );
      }

      const compact = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "list"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(compact.exitCode).toBe(0);
      expect(compact.stdout.toString().trim().split("\n")).toHaveLength(20);
      expect(compact.stdout.toString()).not.toContain("A long event message");
      expect(compact.stderr.toString()).toContain("Showing 20 of 25");
      expect(compact.stderr.toString()).toContain("ui events show <id>");

      const verbose = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "list", "--limit", "2", "--verbose"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(verbose.exitCode).toBe(0);
      expect(verbose.stdout.toString().trim().split("\n")).toHaveLength(2);
      expect(verbose.stdout.toString()).toContain("A long event message");

      const json = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "list", "--json"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(json.exitCode).toBe(0);
      const rows = JSON.parse(json.stdout.toString());
      expect(rows).toHaveLength(25);
      expect(rows[0].data.token).toBe("[REDACTED]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("redacts raw stored event secrets in verbose and json output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-events-redact-"));
    try {
      const env = { ...process.env, HASNA_EVENTS_DIR: dir };
      const client = new EventsClient({ store: new JsonEventsStore(dir) });
      const result = await client.emit(
        {
          source: "ui",
          type: "ui.raw-secret",
          data: {
            token: "raw-token",
            nested: { apiKey: "raw-key", authorization: "Bearer raw-auth" },
          },
          metadata: { password: "raw-password" },
        },
        { deliver: false, redactSensitiveData: false },
      );

      const verbose = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "list", "--limit=1", "--verbose"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(verbose.exitCode).toBe(0);
      expect(verbose.stdout.toString()).not.toContain("raw-token");
      expect(verbose.stdout.toString()).not.toContain("raw-key");
      expect(verbose.stdout.toString()).toContain("[REDACTED]");

      const showJson = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "show", result.event.id, "--json"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(showJson.exitCode).toBe(0);
      const shown = JSON.parse(showJson.stdout.toString());
      expect(shown.data.token).toBe("[REDACTED]");
      expect(shown.data.nested.apiKey).toBe("[REDACTED]");
      expect(shown.data.nested.authorization).toBe("[REDACTED]");
      expect(shown.metadata.password).toBe("[REDACTED]");

      const listJson = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "list", "--json"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(listJson.exitCode).toBe(0);
      expect(JSON.parse(listJson.stdout.toString())[0].data.token).toBe("[REDACTED]");

      const replayJson = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "replay", "--id", result.event.id, "--dry-run", "--json"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(replayJson.exitCode).toBe(0);
      const replayed = JSON.parse(replayJson.stdout.toString());
      expect(replayed.events[0].data.token).toBe("[REDACTED]");
      expect(replayed.events[0].data.nested.apiKey).toBe("[REDACTED]");
      expect(replayed.events[0].metadata.password).toBe("[REDACTED]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects missing option values and supports equals syntax", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-events-options-"));
    try {
      const env = { ...process.env, HASNA_EVENTS_DIR: dir };
      const missing = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "list", "--limit"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr.toString()).toContain("--limit requires a value");

      const emptyEquals = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "list", "--limit="],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(emptyEquals.exitCode).toBe(1);
      expect(emptyEquals.stderr.toString()).toContain("--limit requires a value");

      const equals = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "events", "list", "--limit=1"],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(equals.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("adds sanitized webhook channels", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-webhooks-"));
    try {
      const add = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          "src/cli.ts",
          "webhooks",
          "add",
          "https://example.com/hook",
          "--id",
          "ui-hook",
          "--type",
          "ui.*",
          "--secret",
          "super-secret",
          "--json",
        ],
        env: { ...process.env, HASNA_EVENTS_DIR: dir },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(add.exitCode).toBe(0);
      const channel = JSON.parse(add.stdout.toString());
      expect(channel).toMatchObject({ id: "ui-hook", transport: "webhook" });
      expect(channel.webhook.secret).toBe("[REDACTED]");

      const list = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "webhooks", "list", "--limit", "1"],
        env: { ...process.env, HASNA_EVENTS_DIR: dir },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(list.exitCode).toBe(0);
      expect(list.stdout.toString()).toContain("ui-hook");
      expect(list.stderr.toString()).toContain("Use ui webhooks show <id>");

      const inspect = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli.ts", "webhooks", "inspect", "ui-hook", "--verbose"],
        env: { ...process.env, HASNA_EVENTS_DIR: dir },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(inspect.exitCode).toBe(0);
      expect(inspect.stdout.toString()).toContain("secret");
      expect(inspect.stdout.toString()).toContain("[REDACTED]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
