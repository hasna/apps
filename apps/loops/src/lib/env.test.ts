import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  commandNotFoundMessage,
  commonExecutableDirs,
  executableExists,
  hasnaClientEnv,
  normalizeExecutionPath,
} from "./env.js";

describe("hasnaClientEnv", () => {
  function withClientEnvDir(files: Record<string, string>, run: (dir: string) => void): void {
    const root = mkdtempSync(join(tmpdir(), "loops-client-env-"));
    try {
      const dir = join(root, "cloud");
      mkdirSync(dir, { recursive: true });
      for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
      run(dir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test("reads KEY=value pairs from every *.env file in the directory", () => {
    withClientEnvDir(
      {
        "todos.env": "HASNA_TODOS_API_URL=https://todos.example\nHASNA_TODOS_API_KEY=tk\n",
        "conversations.env": "HASNA_CONVERSATIONS_API_URL=https://conversations.example\n",
      },
      (dir) => {
        expect(hasnaClientEnv({ HASNA_CLIENT_ENV_DIR: dir })).toEqual({
          HASNA_TODOS_API_URL: "https://todos.example",
          HASNA_TODOS_API_KEY: "tk",
          HASNA_CONVERSATIONS_API_URL: "https://conversations.example",
        });
      },
    );
  });

  test("strips an `export ` prefix, surrounding quotes, comments and blank lines", () => {
    withClientEnvDir(
      {
        "knowledge.env": [
          "# a comment",
          "",
          "export HASNA_KNOWLEDGE_API_URL=https://knowledge.example",
          'export HASNA_KNOWLEDGE_API_KEY="quoted-value"',
          "export HASNA_KNOWLEDGE_TENANT='shared'",
          "   ",
          "  # indented comment",
        ].join("\n"),
      },
      (dir) => {
        expect(hasnaClientEnv({ HASNA_CLIENT_ENV_DIR: dir })).toEqual({
          HASNA_KNOWLEDGE_API_URL: "https://knowledge.example",
          HASNA_KNOWLEDGE_API_KEY: "quoted-value",
          HASNA_KNOWLEDGE_TENANT: "shared",
        });
      },
    );
  });

  test("ignores non-.env files and malformed lines instead of throwing", () => {
    withClientEnvDir(
      {
        "load.sh": "HASNA_SHOULD_NOT_LOAD=1\n",
        "todos.env.bak": "HASNA_ALSO_NOT_LOADED=1\n",
        "ok.env": "not a key value line\n=novalue\nHASNA_OK=1\n",
      },
      (dir) => {
        expect(hasnaClientEnv({ HASNA_CLIENT_ENV_DIR: dir })).toEqual({ HASNA_OK: "1" });
      },
    );
  });

  test("applies files in sorted order so a later filename wins a duplicate key", () => {
    withClientEnvDir({ "a.env": "DUP=from-a\n", "b.env": "DUP=from-b\n" }, (dir) => {
      expect(hasnaClientEnv({ HASNA_CLIENT_ENV_DIR: dir }).DUP).toBe("from-b");
    });
  });

  test("returns an empty map when the directory is missing or unreadable", () => {
    expect(hasnaClientEnv({ HASNA_CLIENT_ENV_DIR: join(tmpdir(), "loops-client-env-does-not-exist") })).toEqual({});
  });

  test("defaults to the existing Hasna client env directory under HOME", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-client-env-home-"));
    try {
      const dir = join(root, ".hasna", "cloud");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "todos.env"), "HASNA_TODOS_API_URL=https://from-home\n");
      expect(hasnaClientEnv({ HOME: root }).HASNA_TODOS_API_URL).toBe("https://from-home");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("LOOPS_CLIENT_ENV=0 disables loading entirely", () => {
    withClientEnvDir({ "todos.env": "HASNA_TODOS_API_URL=https://todos.example\n" }, (dir) => {
      expect(hasnaClientEnv({ HASNA_CLIENT_ENV_DIR: dir, LOOPS_CLIENT_ENV: "0" })).toEqual({});
    });
  });
});

describe("env", () => {
  test("commonExecutableDirs derives user bin dirs from HOME and package manager env", () => {
    const dirs = commonExecutableDirs({
      HOME: "/home/example",
      BUN_INSTALL: "/opt/bun",
      PNPM_HOME: "/opt/pnpm",
      NPM_CONFIG_PREFIX: "/opt/npm-global",
    });
    expect(dirs).toContain("/home/example/.local/bin");
    expect(dirs).toContain("/home/example/.bun/bin");
    expect(dirs).toContain("/home/example/.cargo/bin");
    expect(dirs).toContain("/opt/bun/bin");
    expect(dirs).toContain("/opt/pnpm");
    expect(dirs).toContain("/opt/npm-global/bin");
    expect(dirs).toContain("/usr/bin");
    expect(dirs).toContain("/bin");
  });

  test("commonExecutableDirs drops blank and duplicate entries", () => {
    const dirs = commonExecutableDirs({ HOME: "/home/example", PNPM_HOME: "  ", BUN_INSTALL: "/home/example/.bun" });
    expect(dirs.filter((dir) => dir === "/home/example/.bun/bin")).toHaveLength(1);
    expect(dirs.every((dir) => dir.trim().length > 0)).toBe(true);
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  test("normalizeExecutionPath keeps existing PATH order first and dedupes", () => {
    const path = normalizeExecutionPath({
      HOME: "/home/example",
      PATH: ["/custom/bin", "", "/usr/bin", "/custom/bin"].join(delimiter),
    });
    const parts = path.split(delimiter);
    expect(parts[0]).toBe("/custom/bin");
    expect(parts.filter((part) => part === "/custom/bin")).toHaveLength(1);
    expect(parts.filter((part) => part === "/usr/bin")).toHaveLength(1);
    expect(parts).toContain("/home/example/.local/bin");
    expect(parts).not.toContain("");
  });

  test("executableExists resolves bare commands through PATH and honors the execute bit", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-env-exec-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const runnable = join(bin, "openloops-env-runnable");
    writeFileSync(runnable, "#!/bin/sh\nexit 0\n");
    chmodSync(runnable, 0o755);
    const plainFile = join(bin, "openloops-env-plain");
    writeFileSync(plainFile, "not executable\n");
    chmodSync(plainFile, 0o644);
    try {
      const env = { PATH: `${bin}${delimiter}/usr/bin` };
      expect(executableExists("openloops-env-runnable", env)).toBe(true);
      expect(executableExists("openloops-env-plain", env)).toBe(false);
      expect(executableExists("openloops-env-missing", env)).toBe(false);
      expect(executableExists(runnable, { PATH: "" })).toBe(true);
      expect(executableExists(plainFile, { PATH: "" })).toBe(false);
      expect(executableExists("openloops-env-runnable", { PATH: "" })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("commandNotFoundMessage reports the command and effective PATH", () => {
    expect(commandNotFoundMessage("missing-tool", { PATH: "/usr/bin" })).toBe(
      "Executable not found in PATH: missing-tool. Effective PATH=/usr/bin",
    );
    expect(commandNotFoundMessage("missing-tool", { PATH: "" })).toContain("Effective PATH=(empty)");
  });
});
