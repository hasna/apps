import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
    const dir = mkdtempSync(join(tmpdir(), "machines-runtime-cli-"));
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
          HASNA_MACHINES_TMUX_BIN: fakeTmux,
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
      expect(result.emitted.event.type).toBe("machines.tmux.pane_missing");
      expect(result.emitted.event.data.target).toBe("%11");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
