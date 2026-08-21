import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");

describe("events CLI", () => {
  test("advertises events and webhooks commands in help", () => {
    const eventsDir = mkdtempSync(join(tmpdir(), "files-events-cli-"));
    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "run", cliPath, "--help"],
        env: {
          ...process.env,
          HASNA_EVENTS_DIR: eventsDir,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = new TextDecoder().decode(result.stdout);
      expect(result.exitCode).toBe(0);
      expect(stdout).toContain("events");
      // The `webhooks` command was deliberately removed from @hasna/events
      // (its own commander.test.ts asserts the name is absent); the files CLI
      // help advertises the events and channels commands instead.
      expect(stdout).toContain("channels");
    } finally {
      rmSync(eventsDir, { recursive: true, force: true });
    }
  });
});
