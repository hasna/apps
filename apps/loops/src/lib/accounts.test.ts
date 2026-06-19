import { chmodSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { Store } from "./store.js";
import { executeLoop } from "./executor.js";

describe("account profile routing", () => {
  test("injects OpenAccounts env before spawning an agent and strips inherited auth env", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-accounts-"));
    const binDir = join(root, "bin");
    const profileDir = join(root, "claude-profile");
    mkdirSync(binDir);
    mkdirSync(profileDir);

    const accounts = join(binDir, "accounts");
    await Bun.write(
      accounts,
      `#!/usr/bin/env bash
if [[ "$1" != "env" || "$2" != "work" || "$3" != "--tool" || "$4" != "claude" ]]; then
  echo "unexpected accounts args: $*" >&2
  exit 2
fi
printf 'export ANTHROPIC_API_KEY="ignored"\\n'
printf 'export CLAUDE_CONFIG_DIR="%s"\\n' "${profileDir}"
printf 'export TELEGRAM_STATE_DIR="%s/channels/telegram"\\n' "${profileDir}"
`,
    );
    chmodSync(accounts, 0o755);

    const claude = join(binDir, "claude");
    await Bun.write(
      claude,
      `#!/usr/bin/env bash
if [[ "$CLAUDE_CONFIG_DIR" != "${profileDir}" ]]; then
  echo "bad CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR" >&2
  exit 3
fi
if [[ "\${ANTHROPIC_API_KEY:-}" != "ignored" || -n "\${OPENAI_API_KEY:-}" ]]; then
  echo "inherited auth env leaked" >&2
  exit 4
fi
printf '%s\\n' "$@"
printf 'stdin:'
cat
`,
    );
    chmodSync(claude, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "claude-account",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "claude",
          prompt: "say ok",
          account: { profile: "work", tool: "claude" },
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          ANTHROPIC_API_KEY: "leak",
          OPENAI_API_KEY: "leak",
        },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("stdin:say ok");
      expect(result.stdout.trim().split(/\r?\n/)).not.toContain("say ok");
    } finally {
      store.close();
    }
  });

  test("fails account preflight before spawning the provider", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-accounts-fail-"));
    const binDir = join(root, "bin");
    const marker = join(root, "provider-spawned");
    mkdirSync(binDir);

    const accounts = join(binDir, "accounts");
    await Bun.write(
      accounts,
      `#!/usr/bin/env bash
echo "missing profile" >&2
exit 7
`,
    );
    chmodSync(accounts, 0o755);

    const claude = join(binDir, "claude");
    await Bun.write(
      claude,
      `#!/usr/bin/env bash
touch "${marker}"
exit 99
`,
    );
    chmodSync(claude, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "missing-account",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "claude",
          prompt: "must not be sent",
          account: { profile: "missing", tool: "claude" },
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      await expect(
        executeLoop(loop, claim!.run, {
          env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
        }),
      ).rejects.toThrow("accounts env failed");
      expect(existsSync(marker)).toBe(false);
    } finally {
      store.close();
    }
  });
});
