import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("events CLI", () => {
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
