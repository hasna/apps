import { chmodSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { Store } from "./store.js";
import { executeLoop } from "./executor.js";

describe("executeLoop", () => {
  test("runs deterministic command targets", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "echo",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "command", command: "printf hello", shell: true, timeoutMs: 5_000 },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run);
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("hello");
    } finally {
      store.close();
    }
  });

  test("resolves agent binaries from common user bin directories with a minimal PATH", async () => {
    const oldHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "loops-home-"));
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "claude");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n");
    chmodSync(fake, 0o755);
    process.env.HOME = home;

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "claude-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "claude",
          prompt: "say ok",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { PATH: "/usr/bin:/bin", HOME: home },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("say ok");
    } finally {
      store.close();
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
    }
  });
});
