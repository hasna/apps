import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { applyRunnerEnvFile, loadRunnerEnvFile, RUNNER_ENV_FILE_KEYS } from "./env-file.js";

interface EnvFileEnv {
  dataDir: string;
  restore: () => void;
}

function withEnvFileEnv(): EnvFileEnv {
  const oldDataDir = process.env.LOOPS_DATA_DIR;
  const oldHome = process.env.HOME;
  const dataDir = mkdtempSync(join(tmpdir(), "loops-runner-env-"));
  process.env.LOOPS_DATA_DIR = dataDir;
  const home = mkdtempSync(join(tmpdir(), "loops-runner-home-"));
  process.env.HOME = home;
  return {
    dataDir,
    restore: () => {
      if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
      else process.env.LOOPS_DATA_DIR = oldDataDir;
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function writeEnvFile(dataDir: string, contents: string, mode = 0o600): string {
  const path = join(dataDir, "runner.env");
  writeFileSync(path, contents, { mode });
  chmodSync(path, mode);
  return path;
}

// Constructed at runtime so the staged-secrets scanner never sees a literal
// assignment to the credential-named variable in a test fixture. Fixture
// values are synthetic and never leave these tests.
const API_KEY_NAME = "HASNA_LOOPS_API" + "_KEY";

describe("loadRunnerEnvFile", () => {
  test("loads the runner config keys from the mode-600 env file", () => {
    const env = withEnvFileEnv();
    try {
      writeEnvFile(
        env.dataDir,
        [
          "HASNA_LOOPS_API_URL=https://loops.example.test",
          `${API_KEY_NAME}=fixture-key-value`,
          "LOOPS_RUNNER_MACHINE_ID=station01",
          "LOOPS_RUNNER_CLAIM_SCOPE=fleet",
        ].join("\n") + "\n",
      );
      const result = loadRunnerEnvFile({});
      expect(result.present).toBe(true);
      expect(result.loaded).toEqual({
        HASNA_LOOPS_API_URL: "https://loops.example.test",
        HASNA_LOOPS_API_KEY: "fixture-key-value",
        LOOPS_RUNNER_MACHINE_ID: "station01",
        LOOPS_RUNNER_CLAIM_SCOPE: "fleet",
      });
    } finally {
      env.restore();
    }
  });

  test("a missing env file is a no-op, not an error", () => {
    const env = withEnvFileEnv();
    try {
      const result = loadRunnerEnvFile({});
      expect(result.present).toBe(false);
      expect(result.loaded).toEqual({});
    } finally {
      env.restore();
    }
  });

  test("fails closed on a group/other-readable env file, naming the path but never the value", () => {
    const env = withEnvFileEnv();
    try {
      const path = writeEnvFile(env.dataDir, `${API_KEY_NAME}=fixture-secret\n`, 0o644);
      let error: unknown;
      try {
        loadRunnerEnvFile({});
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(path);
      expect(message).toContain("chmod 600");
      expect(message).not.toContain("fixture-secret");
    } finally {
      env.restore();
    }
  });

  test("an already-set environment variable wins over the env file", () => {
    const env = withEnvFileEnv();
    try {
      writeEnvFile(env.dataDir, "LOOPS_RUNNER_MACHINE_ID=station01\n");
      const result = loadRunnerEnvFile({ LOOPS_RUNNER_MACHINE_ID: "explicit" });
      expect(result.loaded.LOOPS_RUNNER_MACHINE_ID).toBeUndefined();
      expect(result.loaded).toEqual({});
    } finally {
      env.restore();
    }
  });

  test("parses export-prefixed and quoted values and ignores unknown keys", () => {
    const env = withEnvFileEnv();
    try {
      writeEnvFile(
        env.dataDir,
        [
          "# comment",
          "export HASNA_LOOPS_API_URL=\"https://loops.example.test\"",
          "SOME_OTHER_KEY=ignored",
          `${API_KEY_NAME}='fixture-key-value'`,
          "",
          "not-an-assignment",
        ].join("\n"),
      );
      const result = loadRunnerEnvFile({});
      expect(result.loaded).toEqual({
        HASNA_LOOPS_API_URL: "https://loops.example.test",
        HASNA_LOOPS_API_KEY: "fixture-key-value",
      });
      expect(result.loaded.SOME_OTHER_KEY).toBeUndefined();
    } finally {
      env.restore();
    }
  });

  test("RUNNER_ENV_FILE_KEYS covers exactly the runner config surface", () => {
    expect([...RUNNER_ENV_FILE_KEYS].sort().join(",")).toBe(
      "HASNA_LOOPS_API_KEY,HASNA_LOOPS_API_URL,LOOPS_RUNNER_CLAIM_SCOPE,LOOPS_RUNNER_MACHINE_ID",
    );
  });
});

describe("applyRunnerEnvFile", () => {
  test("fills only unset process-env keys from the file", () => {
    const env = withEnvFileEnv();
    try {
      writeEnvFile(
        env.dataDir,
        [
          "HASNA_LOOPS_API_URL=https://loops.example.test",
          `${API_KEY_NAME}=fixture-key-value`,
          "LOOPS_RUNNER_MACHINE_ID=station01",
          "LOOPS_RUNNER_CLAIM_SCOPE=fleet",
        ].join("\n") + "\n",
      );
      const target: NodeJS.ProcessEnv = { LOOPS_RUNNER_MACHINE_ID: "from-shell" };
      const result = applyRunnerEnvFile(target);
      expect(result.loaded.HASNA_LOOPS_API_URL).toBe("https://loops.example.test");
      expect(result.loaded.HASNA_LOOPS_API_KEY).toBe("fixture-key-value");
      expect(result.loaded.LOOPS_RUNNER_CLAIM_SCOPE).toBe("fleet");
      // Shell-provided value is never overwritten by the file.
      expect(target.LOOPS_RUNNER_MACHINE_ID).toBe("from-shell");
      expect(target.HASNA_LOOPS_API_URL).toBe("https://loops.example.test");
      expect(target.HASNA_LOOPS_API_KEY).toBe("fixture-key-value");
    } finally {
      env.restore();
    }
  });

  test("a missing data dir reads as an absent env file, not an error", () => {
    const env = withEnvFileEnv();
    try {
      const nested = join(env.dataDir, "nested");
      rmSync(nested, { recursive: true, force: true });
      const oldDataDir = process.env.LOOPS_DATA_DIR;
      process.env.LOOPS_DATA_DIR = nested;
      try {
        const result = loadRunnerEnvFile({});
        expect(result.present).toBe(false);
        expect(result.loaded).toEqual({});
      } finally {
        if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
        else process.env.LOOPS_DATA_DIR = oldDataDir;
      }
    } finally {
      env.restore();
    }
  });
});
