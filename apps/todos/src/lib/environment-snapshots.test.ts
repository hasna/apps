import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  captureEnvironmentSnapshot,
  compareEnvironmentSnapshots,
  readEnvironmentSnapshot,
  writeEnvironmentSnapshot,
} from "./environment-snapshots.js";
import { validateJsonContract } from "../json-contracts.js";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "todos-env-snapshot-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "fixture",
    version: "1.0.0",
    scripts: {
      test: "bun test",
      deploy: ["SERVICE", "TOKEN=secret-value deploy"].join("_"),
    },
    dependencies: { zod: "^3.0.0" },
    devDependencies: { typescript: "^5.0.0" },
  }, null, 2));
  writeFileSync(join(root, "bun.lock"), "# lock\n");
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "export {}\n");
  return root;
}

describe("environment snapshots", () => {
  test("captures runtime, package, git, config, and redacted environment metadata", () => {
    const root = makeProject();
    const snapshot = captureEnvironmentSnapshot({
      root,
      command: "bun test",
      include_env_values: true,
      now: "2026-01-02T03:04:05.000Z",
      env: {
        PATH: process.env["PATH"] || "",
        NODE_ENV: "test",
        npm_config_user_agent: "bun/1.2.3 npm/? node/v24",
        OPENAI_API_KEY: ["sk", "test-secret-value"].join("-"),
      },
    });

    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.id).toMatch(/^env_[a-f0-9]{24}$/);
    expect(snapshot.captured_at).toBe("2026-01-02T03:04:05.000Z");
    expect(snapshot.runtime.node).toBe(process.version);
    expect(snapshot.package_manager.manager).toBe("bun");
    expect(snapshot.package_manager.manifests[0]?.redacted).toMatchObject({
      name: "fixture",
      dependencies: { zod: "^3.0.0" },
    });
    expect(JSON.stringify(snapshot.package_manager.manifests[0]?.redacted)).toContain("[REDACTED]");
    expect(snapshot.command_env.env?.OPENAI_API_KEY).toBe("[REDACTED]");
    expect(snapshot.command_env.command).toBe("bun test");
    expect(snapshot.config_hashes.map((file) => file.path)).toContain("tsconfig.json");
    expect(validateJsonContract("environment_snapshot", snapshot).ok).toBe(true);
  });

  test("writes snapshots and compares drift deterministically", () => {
    const root = makeProject();
    const first = captureEnvironmentSnapshot({ root, now: "2026-01-02T03:04:05.000Z" });
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: false } }));
    const second = captureEnvironmentSnapshot({ root, now: "2026-01-02T03:04:06.000Z" });
    const out = writeEnvironmentSnapshot(first, join(root, "snapshot.json"));

    expect(JSON.parse(readFileSync(out, "utf8")).id).toBe(first.id);
    expect(readEnvironmentSnapshot(out).id).toBe(first.id);

    const comparison = compareEnvironmentSnapshots(first, second);
    expect(comparison.left_id).toBe(first.id);
    expect(comparison.right_id).toBe(second.id);
    expect(comparison.changed_config_hashes.map((file) => file.path)).toContain("tsconfig.json");
    expect(validateJsonContract("environment_snapshot_comparison", comparison).ok).toBe(true);
  });

  test("CLI captures JSON snapshots without network or hosted services", () => {
    const root = makeProject();
    const output = join(root, "cli-snapshot.json");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "src/cli/index.tsx", "--json", "env-snapshot", "capture", "--root", root, "--output", output, "--command", "bun test"],
      cwd: join(import.meta.dir, "..", ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: localRoutingTestEnv({
        TODOS_DB_PATH: ":memory:",
        OPENAI_API_KEY: ["sk", "test-secret-value"].join("-"),
      }),
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString("utf8"));
    expect(payload.snapshot.id).toMatch(/^env_/);
    expect(payload.output_path).toBe(output);
    expect(readEnvironmentSnapshot(output).command_env.env).toBeNull();
    expect(result.stderr.toString("utf8")).toBe("");
  });
});
