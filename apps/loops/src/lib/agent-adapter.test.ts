import { chmodSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { executeLoop } from "./executor.js";
import { Store } from "./store.js";

describe("agent adapters", () => {
  test("runs opencode through a machine-readable fake binary contract", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-agent-"));
    const fake = join(binDir, "opencode");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n");
    chmodSync(fake, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "opencode",
          prompt: "say ok",
          cwd: ".",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("run");
      expect(result.stdout).toContain("--format");
      expect(result.stdout).toContain("json");
      expect(result.stdout).toContain("--pure");
      expect(result.stdout).toContain("say ok");
    } finally {
      store.close();
    }
  });

  test("runs codex through exec json adapter", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-codex-"));
    const fake = join(binDir, "codex");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n");
    chmodSync(fake, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "codex-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "codex",
          prompt: "say ok",
          cwd: ".",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("exec");
      expect(result.stdout).toContain("--json");
      expect(result.stdout).toContain("--ephemeral");
      expect(result.stdout).toContain("--ignore-rules");
      expect(result.stdout).toContain("say ok");
    } finally {
      store.close();
    }
  });

  test("runs codewith with global approval policy before exec", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-codewith-"));
    const fake = join(binDir, "codewith");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n");
    chmodSync(fake, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "codewith-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "codewith",
          prompt: "say ok",
          cwd: ".",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      });
      expect(result.status).toBe("succeeded");
      const args = result.stdout.trim().split(/\r?\n/);
      expect(args.slice(0, 3)).toEqual(["--ask-for-approval", "never", "exec"]);
      expect(args).toContain("--json");
      expect(args).toContain("--ephemeral");
      expect(args).toContain("--skip-git-repo-check");
      expect(args.indexOf("--ask-for-approval")).toBeLessThan(args.indexOf("exec"));
      expect(args).toContain("say ok");
    } finally {
      store.close();
    }
  });
});
