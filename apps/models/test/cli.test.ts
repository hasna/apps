import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ModelsStore } from "../src/storage.js";
import type { InstalledArtifact } from "../src/types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
const testEnv = () => ({
  ...process.env,
  HASNA_MODELS_HOME: mkdtempSync(join(tmpdir(), "models-cli-")),
  NO_COLOR: "1",
});

function testArtifact(overrides: Partial<InstalledArtifact> = {}): InstalledArtifact {
  return {
    id: "install-id",
    provider: "huggingface",
    entityKind: "model",
    repoId: "owner/repo",
    revision: "main",
    installPath: "/tmp/models/owner-repo",
    bytes: 42,
    files: ["config.json"],
    status: "installed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("CLI --version matches package metadata", () => {
  const result = spawnSync(process.execPath, [
    "src/cli/index.ts",
    "--version",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: testEnv(),
  });

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(packageJson.version);
  expect(result.stderr).toBe("");
});

test("subcommand --json returns machine-readable action errors", () => {
  const result = spawnSync(process.execPath, [
    "src/cli/index.ts",
    "info",
    "not-a-namespaced-ref",
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: testEnv(),
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toBe("");

  const body = JSON.parse(result.stdout) as { ok: boolean; error: string };
  expect(body.ok).toBe(false);
  expect(body.error).toContain("Expected a namespaced repo id");
});

test("numeric CLI options reject trailing junk", () => {
  const result = spawnSync(process.execPath, [
    "src/cli/index.ts",
    "list",
    "--catalog",
    "--limit",
    "2abc",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: testEnv(),
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Expected a positive integer");
});

test("where accepts canonical provider refs for installed artifacts", () => {
  const home = mkdtempSync(join(tmpdir(), "models-cli-"));
  const dbPath = join(home, "models.db");
  const store = new ModelsStore(dbPath);
  store.recordInstall(testArtifact({
    id: "owner-repo-v2",
    revision: "v2",
    installPath: "/tmp/models/owner-repo-v2",
  }));
  store.close();

  const result = spawnSync(process.execPath, [
    "src/cli/index.ts",
    "where",
    "hf:owner/repo@v2",
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HASNA_MODELS_HOME: home,
      HASNA_MODELS_DB: dbPath,
      NO_COLOR: "1",
    },
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");

  const body = JSON.parse(result.stdout) as InstalledArtifact;
  expect(body.id).toBe("owner-repo-v2");
  expect(body.installPath).toBe("/tmp/models/owner-repo-v2");
});

test("capabilities CLI seeds fixtures and resolves aliases", () => {
  const home = mkdtempSync(join(tmpdir(), "models-cli-capabilities-"));
  const dbPath = join(home, "models.db");
  const env = {
    ...process.env,
    HASNA_MODELS_HOME: home,
    HASNA_MODELS_DB: dbPath,
    NO_COLOR: "1",
  };

  const seed = spawnSync(process.execPath, [
    "src/cli/index.ts",
    "capabilities",
    "seed-fixtures",
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  expect(seed.status).toBe(0);
  const seeded = JSON.parse(seed.stdout) as { count: number; stats: { capabilities: number } };
  expect(seeded.count).toBeGreaterThanOrEqual(5);
  expect(seeded.stats.capabilities).toBe(seeded.count);

  const get = spawnSync(process.execPath, [
    "src/cli/index.ts",
    "capabilities",
    "get",
    "ollama:llama3.1:8b",
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  expect(get.status).toBe(0);
  const capability = JSON.parse(get.stdout) as { runtime: { kind: string }; providerHealth: { status: string } };
  expect(capability.runtime.kind).toBe("ollama");
  expect(capability.providerHealth.status).toBe("unknown");
});
