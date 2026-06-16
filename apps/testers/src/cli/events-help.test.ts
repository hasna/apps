import { describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("testers events CLI", () => {
  test("exposes shared events commands", () => {
    const eventsDir = mkdtempSync(join(tmpdir(), "testers-events-"));
    try {
      const proc = spawnSync({
        cmd: ["bun", "run", "src/cli/index.tsx", "events", "--help"],
        env: { ...process.env, HASNA_EVENTS_DIR: eventsDir },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(proc.exitCode).toBe(0);
      expect(proc.stdout.toString()).toContain("Emit, list, and replay Hasna events");
    } finally {
      rmSync(eventsDir, { recursive: true, force: true });
    }
  });
});
