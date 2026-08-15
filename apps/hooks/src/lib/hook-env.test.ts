/**
 * Regression tests for P1-1 hook env isolation.
 *
 * A hook child must never receive credential-bearing variables, even when the
 * parent passes process.env wholesale. The sanitizer keeps the non-secret
 * session allowlist and projects non-secret HOOKS_* config, and strips every
 * deny-listed NAME — the deny list is name-based by design (a value-shape
 * test would have to miss something for a credential to leak).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runHook } from "../index.js";
import { executeVerifiedScript } from "./run.js";
import { buildHookEnv, isDeniedEnvName } from "./hook-env.js";
import { closeDb } from "../db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-env-test-"));
const HOOKS_DIR = join(TEST_DIR, "hooks");

/**
 * Sentinel builders — the CI secrets gate scans ADDED LINES for real token
 * shapes, so fixtures build the shape at runtime by concatenation (P2-6).
 */
const sentinel = {
  skAnt: (body: string) => `sk-${"ant-"}-${body}`,
  ghp: (body: string) => `gh${"p_"}${body}`,
};

function installCustomHook(name: string, script: string, scriptPath = "script.ts"): string {
  const dir = join(HOOKS_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ name, version: "1.0.0", events: ["PostToolUse"], script: scriptPath }),
  );
  const scriptFile = join(dir, scriptPath);
  writeFileSync(scriptFile, script);
  return scriptFile;
}

const ENV_DUMP_SCRIPT = `const input = JSON.parse(await Bun.stdin.text());
console.log(JSON.stringify({ env: process.env, want: input.want }));
`;

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("buildHookEnv sanitizer", () => {
  test("keeps the documented allowlist and drops everything credential-shaped", () => {
    const source: Record<string, string | undefined> = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/hasna",
      LANG: "en_US.UTF-8",
      TZ: "Europe/Bucharest",
      SHELL: "/bin/bash",
      TERM: "xterm-256color",
      USER: "hasna",
      PWD: "/home/hasna/work",
      OPENAI_API_KEY: "sk-should-never-leak",
      ANTHROPIC_API_KEY: sentinel.skAnt("should-never-leak"),
      GITHUB_TOKEN: sentinel.ghp("should-never-leak"),
      AWS_SECRET_ACCESS_KEY: "aws-should-never-leak",
      AZURE_CLIENT_SECRET: "azure-should-never-leak",
      GCP_PROJECT: "gcp-should-never-leak",
      VAULT_TOKEN: "vault-should-never-leak",
      DATABASE_URL: "postgres://u:p@h/db",
      PRISMA_DATABASE_URL: "postgres://u:p@h/db2",
      MEMENTOS_API_URL: "https://mementos.example.com",
      DB_URL: "https://db.example.com:5432",
      MY_API_KEY: "custom-key",
      DB_PASSWORD: "pw",
      HASNA_HOOKS_API_KEY: "hooks-key",
      HOOKS_API_KEY: "hooks-key-bare",
      HASNA_TODOS_API_KEY: "todos-key",
      HASNA_HOOKS_DATA_DIR: TEST_DIR,
      CUSTOM_NON_SECRET_VAR: "keep-me",
    };
    const env = buildHookEnv(source);
    for (const denied of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GITHUB_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "AZURE_CLIENT_SECRET",
      "GCP_PROJECT",
      "VAULT_TOKEN",
      "DATABASE_URL",
      "PRISMA_DATABASE_URL",
      "MEMENTOS_API_URL",
      "DB_URL",
      "MY_API_KEY",
      "DB_PASSWORD",
      "HASNA_HOOKS_API_KEY",
      "HOOKS_API_KEY",
      "HASNA_TODOS_API_KEY",
      "HASNA_HOOKS_DATA_DIR",
    ]) {
      expect(env[denied], `expected ${denied} to be stripped`).toBeUndefined();
    }
    // allowlist survives
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/home/hasna");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.TZ).toBe("Europe/Bucharest");
    expect(env.SHELL).toBe("/bin/bash");
    expect(env.TERM).toBe("xterm-256color");
    expect(env.USER).toBe("hasna");
    expect(env.PWD).toBe("/home/hasna/work");
    // non-secret extras survive
    expect(env.CUSTOM_NON_SECRET_VAR).toBe("keep-me");
    // HASNA_HOOKS_* config is projected to the bare alias
    expect(env.HOOKS_DATA_DIR).toBe(TEST_DIR);
  });

  test("a caller's extra env cannot reintroduce a denied name", () => {
    const env = buildHookEnv({}, { GITHUB_TOKEN: sentinel.ghp("reintroduced"), PATH: "/opt/bin" });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/opt/bin");
  });

  test("isDeniedEnvName covers the documented prefix/suffix/contains sets", () => {
    expect(isDeniedEnvName("AWS_ACCESS_KEY_ID")).toBe(true);
    expect(isDeniedEnvName("MY_TOKEN")).toBe(true);
    expect(isDeniedEnvName("super_secret")).toBe(true);
    expect(isDeniedEnvName("PASSWORD")).toBe(true);
    expect(isDeniedEnvName("DB_PASSWORD")).toBe(true);
    expect(isDeniedEnvName("POSTGRES_PASSWORD")).toBe(true);
    expect(isDeniedEnvName("FOO_DATABASE_URL")).toBe(true);
    expect(isDeniedEnvName("HASNA_SOMETHING")).toBe(true);
    expect(isDeniedEnvName("MYSQL_ROOT_PASSWORD")).toBe(true);
    expect(isDeniedEnvName("REDIS_URL")).toBe(true);
    // P3-11: URL/URI-bearing names and MEMENTOS_* are denied classes too.
    expect(isDeniedEnvName("MEMENTOS_API_URL")).toBe(true);
    expect(isDeniedEnvName("MEMENTOS_DB_PATH")).toBe(true);
    expect(isDeniedEnvName("DB_URL")).toBe(true);
    expect(isDeniedEnvName("SERVICE_URI")).toBe(true);
    expect(isDeniedEnvName("PATH")).toBe(false);
    expect(isDeniedEnvName("HOOKS_DATA_DIR")).toBe(false);
    expect(isDeniedEnvName("LANG")).toBe(false);
    expect(isDeniedEnvName("TERM")).toBe(false);
  });
});

describe("executed hook env isolation (P1-1)", () => {
  test("a real hook child sees no credential variables but keeps PATH and HOME", async () => {
    const scriptPath = installCustomHook(
      "env-isolation-demo",
      `const input = JSON.parse(await Bun.stdin.text());\nconsole.log(JSON.stringify({ env: process.env, want: input.want }));\n`,
    );
    // Seed the PARENT process with credential-shaped variables, exactly the
    // attacker model: the parent holds them, the child must not.
    const seeded: Array<[string, string]> = [
      ["OPENAI_API_KEY", "sk-parent-only"],
      ["GITHUB_TOKEN", sentinel.ghp("parent_only")],
      ["AWS_SECRET_ACCESS_KEY", "aws-parent-only"],
      ["DATABASE_URL", "postgres://u:p@h/db"],
      ["HASNA_HOOKS_API_KEY", "hooks-parent-only"],
    ];
    const previous = new Map<string, string | undefined>();
    for (const [name, value] of seeded) {
      previous.set(name, process.env[name]);
      process.env[name] = value;
    }
    try {
      const result = await executeVerifiedScript({
        name: "env-isolation-demo",
        scriptPath,
        content: await Bun.file(scriptPath).arrayBuffer().then((b) => Buffer.from(b)),
        args: [],
        stdin: JSON.stringify({ want: [] }),
      });
      expect(result.exitCode).toBe(0);
      const { env } = JSON.parse(result.stdout);
      for (const [name] of seeded) {
        expect(env[name], `child must not see ${name}`).toBeUndefined();
      }
      expect(env.PATH).toBeTruthy();
      expect(env.HOME).toBeTruthy();
      expect(env.HOOKS_DATA_DIR).toBe(TEST_DIR);
    } finally {
      for (const [name, value] of seeded) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("runHook passes no parent credentials to the hook child", async () => {
    const scriptPath = installCustomHook(
      "env-isolation-runhook",
      `console.log(JSON.stringify({ env: process.env }));\n`,
    );
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = sentinel.ghp("runhook_parent");
    try {
      const res = await runHook("env-isolation-runhook", { session_id: "s-env" });
      expect(res.exitCode).toBe(0);
      const env = (res.output as any).env ?? {};
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.PATH).toBeTruthy();
    } finally {
      if (previous === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previous;
    }
  });
});
