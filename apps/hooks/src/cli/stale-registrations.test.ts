/**
 * `hooks doctor` stale-registration detection and repair.
 *
 * Regression for the ghost registration that broke every tool call: a settings
 * file carrying {"type":"command","command":"hooks run fast-preview-hook"}
 * where the hook resolves nowhere. `hooks doctor` must report it with the
 * settings file that carries it, and `hooks doctor --fix` must remove exactly
 * that entry — never a registration whose hook resolves — leaving every other
 * key byte-identical.
 */

import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI = join(import.meta.dir, "index.tsx");
const TEST_HOME = mkdtempSync(join(tmpdir(), "hooks-stale-reg-"));
const SETTINGS_PATH = join(TEST_HOME, ".claude", "settings.json");
const GEMINI_SETTINGS_PATH = join(TEST_HOME, ".gemini", "settings.json");
const BACKUP_PATH = `${SETTINGS_PATH}.bak`;

function cliEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: TEST_HOME,
    HASNA_HOOKS_CLAUDE_SETTINGS_PATH: SETTINGS_PATH,
    HASNA_HOOKS_GEMINI_SETTINGS_PATH: GEMINI_SETTINGS_PATH,
    // Explicit local-mode opt-in (fleet fail-closed doctrine): the subprocess
    // CLI exercises the bundled registry + local store on purpose.
    HASNA_HOOKS_LOCAL: "1",
    NO_COLOR: "1",
  };
}

async function run(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: cliEnv(),
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

/** The live shape: unrelated keys, the ghost entry, a resolvable hook, a direct-path wire. */
function writeFixture(): string {
  const fixture = JSON.stringify(
    {
      model: "deepseek-v4.1-flash-expires-on-0910[1m]",
      enabledPlugins: { "superpowers@claude-plugins-official": true },
      tui: "fullscreen",
      skipDangerousModePermissionPrompt: true,
      theme: "light",
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: "hooks run fast-preview-hook" },
              { type: "command", command: "hooks run gitguard" },
              { type: "command", command: "python3 /custom/direct-wire.py" },
            ],
          },
        ],
        Stop: [
          {
            hooks: [{ type: "command", command: "hooks run fast-preview-hook" }],
          },
        ],
      },
    },
    null,
    2,
  ) + "\n";
  mkdirSync(join(TEST_HOME, ".claude"), { recursive: true });
  writeFileSync(SETTINGS_PATH, fixture);
  return fixture;
}

beforeEach(() => {
  rmSync(SETTINGS_PATH, { force: true });
  rmSync(BACKUP_PATH, { force: true });
  rmSync(GEMINI_SETTINGS_PATH, { force: true });
});

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("hooks doctor stale registrations", () => {
  test("doctor reports the stale registration with its settings file and exits nonzero", async () => {
    writeFixture();
    const res = await run("doctor");
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toContain("fast-preview-hook");
    expect(res.stdout).toContain(SETTINGS_PATH);
    expect(res.stdout).toContain("does not resolve");
  });

  test("doctor --json carries the stale entry structurally and exits nonzero", async () => {
    writeFixture();
    const res = await run("doctor", "--json");
    expect(res.exitCode).toBe(1);
    const body = JSON.parse(res.stdout.trim());
    expect(body.healthy).toBe(false);
    expect(body.stale).toEqual([
      {
        file: SETTINGS_PATH,
        event: "PreToolUse",
        hook: "fast-preview-hook",
        command: "hooks run fast-preview-hook",
      },
      {
        file: SETTINGS_PATH,
        event: "Stop",
        hook: "fast-preview-hook",
        command: "hooks run fast-preview-hook",
      },
    ]);
  });

  test("doctor --fix removes exactly the stale entry and leaves everything else intact", async () => {
    const before = writeFixture();
    const res = await run("doctor", "--fix");
    expect(res.exitCode).toBe(0);

    const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    // The ghost is gone from every event it was wired to...
    expect(JSON.stringify(settings)).not.toContain("fast-preview-hook");
    // ...the Stop key is dropped with its last entry...
    expect(settings.hooks.Stop).toBeUndefined();
    // ...and the resolvable registration and the direct-path wire survive.
    expect(settings.hooks.PreToolUse).toEqual([
      {
        hooks: [
          { type: "command", command: "hooks run gitguard" },
          { type: "command", command: "python3 /custom/direct-wire.py" },
        ],
      },
    ]);
    // Unrelated keys are preserved exactly.
    expect(settings.model).toBe("deepseek-v4.1-flash-expires-on-0910[1m]");
    expect(settings.enabledPlugins).toEqual({ "superpowers@claude-plugins-official": true });
    expect(settings.tui).toBe("fullscreen");
    expect(settings.skipDangerousModePermissionPrompt).toBe(true);
    expect(settings.theme).toBe("light");
    // The backup holds the pre-fix bytes verbatim.
    expect(existsSync(BACKUP_PATH)).toBe(true);
    expect(readFileSync(BACKUP_PATH, "utf-8")).toBe(before);
  });

  test("doctor --fix is idempotent: a second run writes nothing", async () => {
    writeFixture();
    await run("doctor", "--fix");
    const afterFirst = readFileSync(SETTINGS_PATH, "utf-8");
    const backupAfterFirst = readFileSync(BACKUP_PATH, "utf-8");

    const res = await run("doctor", "--fix");
    expect(res.exitCode).toBe(0);
    expect(readFileSync(SETTINGS_PATH, "utf-8")).toBe(afterFirst);
    expect(readFileSync(BACKUP_PATH, "utf-8")).toBe(backupAfterFirst);
  });

  test("doctor reports clean after a fix", async () => {
    writeFixture();
    await run("doctor", "--fix");

    const res = await run("doctor");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain("Stale registration");
    expect(res.stdout).toContain("All 1 registered hook(s) healthy");
  });
});
