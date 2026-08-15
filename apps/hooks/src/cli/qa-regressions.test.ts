/**
 * Deep-QA regression tests at the CLI level:
 * - P2 #6: install exits non-zero with a clear error when nothing registered
 * - P2 #7: hooks install/update <name>@<version> fetch that exact version
 * - P2 #8: custom install pins the ACTUAL installed version+sha
 * - P2 #9: hooks list shows custom/registry hooks
 * - P3 #10: hooks init --cloudflare writes api_key_ref
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI = join(import.meta.dir, "index.tsx");
const TEST_HOME = mkdtempSync(join(tmpdir(), "hooks-qa6-"));

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = join(TEST_HOME, ".hasna", "hooks");
  process.env.HASNA_HOOKS_DB_PATH = join(TEST_HOME, ".hasna", "hooks", "hooks.db");
  process.env.HASNA_HOOKS_LOCK_PATH = join(TEST_HOME, ".hasna", "hooks", "hooks.lock");
  process.env.HASNA_HOOKS_CONFIG_PATH = join(TEST_HOME, ".hasna", "hooks", "config.json");
  process.env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH = join(TEST_HOME, ".claude", "settings.json");
  process.env.NO_COLOR = "1";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  delete process.env.HASNA_HOOKS_LOCK_PATH;
  delete process.env.HASNA_HOOKS_CONFIG_PATH;
  delete process.env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH;
  delete process.env.HASNA_HOOKS_API_URL;
  delete process.env.NO_COLOR;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function customHookDir(name: string): string {
  return join(TEST_HOME, ".hasna", "hooks", "hooks", name);
}

function writeCustomHook(name: string, version: string, events = ["PreToolUse"]): string {
  const dir = customHookDir(name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ name, version, events, script: "script.sh" }));
  writeFileSync(join(dir, "script.sh"), "#!/bin/bash\necho '{\"continue\":true}'\n", { mode: 0o755 });
  return join(dir, "script.sh");
}

describe("P2 #6 — install fail-closed reporting (QA-3 P2 / QA-1 BUG-C / QA-4 #5)", () => {
  test("install with every hook refused exits non-zero and does not claim registration", async () => {
    const { stdout, exitCode } = await run("install", "gitguard");
    // Sanity: bundled install of a real hook works and exits 0.
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Registered in");

    // A custom manifest with an unsupported event: installHook refuses, and
    // the CLI must exit non-zero WITHOUT printing "Registered in".
    const dir = join(TEST_HOME, "custom-invalid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      name: "qa6-invalid-event",
      version: "1.0.0",
      events: ["PreToolUse:Bash"],
      script: "script.sh",
    }));
    writeFileSync(join(dir, "script.sh"), "#!/bin/bash\necho ok\n", { mode: 0o755 });

    const bad = await run("install", dir);
    expect(bad.exitCode).not.toBe(0);
    expect(bad.stdout).not.toContain("Registered in");
    expect(bad.stdout.toLowerCase()).toContain("nothing was registered");

    // Unknown hook name: also non-zero.
    const unknown = await run("install", "qa6-does-not-exist-xyz");
    expect(unknown.exitCode).not.toBe(0);
  });
});

describe("P2 #7 — pinned version install/update (QA-2)", () => {
  const SCRIPT_V1 = "#!/bin/bash\necho '{\"continue\":true,\"v\":1}'\n";
  const SCRIPT_V2 = "#!/bin/bash\necho '{\"continue\":true,\"v\":2}'\n";

  test("hooks install <name>@<version> fetches that exact version and pins it", async () => {
    const shaV1 = sha(SCRIPT_V1);
    const shaV2 = sha(SCRIPT_V2);
    let current = "1.0.1";
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/lock") {
          const version = current;
          return Response.json({
            hooks: {
              "qa6-pinned": { version, sha256: version === "1.0.1" ? shaV1 : shaV2, source: "remote" },
            },
          });
        }
        const m = url.pathname.match(/^\/api\/v1\/hooks\/qa6-pinned\/(.+)$/);
        if (m) {
          const version = m[1];
          const script = version === "1.0.1" ? SCRIPT_V1 : version === "1.0.2" ? SCRIPT_V2 : "";
          return Response.json({
            manifest: { name: "qa6-pinned", version, events: ["PreToolUse"], script: "script.sh" },
            script,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    process.env.HASNA_HOOKS_API_URL = `http://127.0.0.1:${server.port}`;
    try {
      const res = await run("install", "qa6-pinned@1.0.1");
      expect(res.exitCode, res.stdout + res.stderr).toBe(0);
      const lock = JSON.parse(readFileSync(join(TEST_HOME, ".hasna", "hooks", "hooks.lock"), "utf-8"));
      expect(lock.hooks["qa6-pinned"].version).toBe("1.0.1");
      expect(lock.hooks["qa6-pinned"].sha256).toBe(shaV1);
      const script = readFileSync(join(customHookDir("qa6-pinned"), "script.sh"), "utf-8");
      expect(script).toBe(SCRIPT_V1);

      // Round-trip to 1.0.2 via hooks update <name>@<version>
      current = "1.0.2";
      const up = await run("update", "qa6-pinned@1.0.2");
      expect(up.exitCode, up.stdout + up.stderr).toBe(0);
      const lock2 = JSON.parse(readFileSync(join(TEST_HOME, ".hasna", "hooks", "hooks.lock"), "utf-8"));
      expect(lock2.hooks["qa6-pinned"].version).toBe("1.0.2");
      expect(lock2.hooks["qa6-pinned"].sha256).toBe(shaV2);
      expect(readFileSync(join(customHookDir("qa6-pinned"), "script.sh"), "utf-8")).toBe(SCRIPT_V2);
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      server.stop(true);
    }
  });

  test("hooks install <name>@<missing-version> fails clearly and changes nothing", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ hooks: { "qa6-pinned": { version: "1.0.2", sha256: sha(SCRIPT_V2), source: "remote" } } });
      },
    });
    process.env.HASNA_HOOKS_API_URL = `http://127.0.0.1:${server.port}`;
    const lockPath = join(TEST_HOME, ".hasna", "hooks", "hooks.lock");
    const before = existsSync(lockPath) ? readFileSync(lockPath, "utf-8") : null;
    try {
      const res = await run("install", "qa6-pinned@9.9.9");
      expect(res.exitCode).not.toBe(0);
      expect(res.stdout).toContain("not in the remote registry");
      const after = existsSync(lockPath) ? readFileSync(lockPath, "utf-8") : null;
      expect(after).toBe(before);
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      server.stop(true);
    }
  });
});

describe("P2 #8 — install pins the ACTUAL installed version+sha (QA-1 P3)", () => {
  test("custom install pins version and sha immediately, before any run", async () => {
    const dir = join(TEST_HOME, "qa6-pin-src");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      name: "qa6-pins",
      version: "4.5.6",
      events: ["PreToolUse"],
      script: "hook.sh",
    }));
    writeFileSync(join(dir, "hook.sh"), "#!/bin/bash\necho hi\n", { mode: 0o755 });

    const res = await run("install", dir);
    expect(res.exitCode, res.stdout + res.stderr).toBe(0);
    const lock = JSON.parse(readFileSync(join(TEST_HOME, ".hasna", "hooks", "hooks.lock"), "utf-8"));
    expect(lock.hooks["qa6-pins"]).toBeDefined();
    expect(lock.hooks["qa6-pins"].version).toBe("4.5.6");
    const scriptBytes = readFileSync(join(customHookDir("qa6-pins"), "hook.sh"));
    expect(lock.hooks["qa6-pins"].sha256).toBe(sha(scriptBytes.toString()));
  });
});

describe("P2 #9 — hooks list surfaces custom/registry hooks (QA-4 A1 / bug e8461f89)", () => {
  test("list --json includes store hooks with versions; list -i shows them", async () => {
    writeCustomHook("qa6-listed", "2.0.0");
    const data = await run("list", "--json");
    expect(data.exitCode).toBe(0);
    const parsed = JSON.parse(data.stdout);
    expect(parsed["Custom / Registry"]).toBeDefined();
    const custom = parsed["Custom / Registry"] as any[];
    const entry = custom.find((h: any) => h.name === "qa6-listed");
    expect(entry).toBeDefined();
    expect(entry.version).toBe("2.0.0");
    expect(entry.source).toBe("custom");

    const installed = await run("list", "--installed", "--json");
    const parsedInstalled = JSON.parse(installed.stdout) as Array<{ name: string }>;
    expect(parsedInstalled.some((h) => h.name === "qa6-listed")).toBe(true);
  });
});

describe("P3 #10 — hooks init --cloudflare writes api_key_ref (QA-3 deviation)", () => {
  test("config.json carries api_url + api_key_ref (default vault key name when --api-key omitted)", async () => {
    const res = await run("init", "--cloudflare", "--api-url", "https://registry.example.com");
    expect(res.exitCode).toBe(0);
    const config = JSON.parse(readFileSync(join(TEST_HOME, ".hasna", "hooks", "config.json"), "utf-8"));
    expect(config.api_url).toBe("https://registry.example.com");
    expect(config.api_key_ref).toBe("hasna/hooks/live/api-key");
  });

  test("an explicit --api-key is stored as the reference", async () => {
    const res = await run("init", "--cloudflare", "--api-url", "https://registry.example.com", "--api-key", "someorg/hooks/live/other-key");
    expect(res.exitCode).toBe(0);
    const config = JSON.parse(readFileSync(join(TEST_HOME, ".hasna", "hooks", "config.json"), "utf-8"));
    expect(config.api_key_ref).toBe("someorg/hooks/live/other-key");
  });
});
