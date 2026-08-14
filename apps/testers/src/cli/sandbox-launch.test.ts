import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "testers-cli-sandbox-"));
  cleanupPaths.push(dir);
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(join(dir, "packages", "web"), { recursive: true });
  mkdirSync(join(dir, "packages", "web", "src"), { recursive: true });
  writeFileSync(
    join(dir, "packages", "web", "package.json"),
    JSON.stringify({
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
      },
      dependencies: {
        next: "16.0.0",
      },
    }),
  );
  writeFileSync(
    join(dir, "packages", "web", "src", "env.ts"),
    'export const refreshSecret = requireEnv("JWT_REFRESH_SECRET");\n',
  );
  return dir;
}

describe("testers sandbox launch", () => {
  test("documents the command in help", () => {
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "sandbox", "launch", "--help"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = new TextDecoder().decode(proc.stdout);
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain("Sync an app repo into a remote sandbox");
    expect(stdout).toContain("--db-setup");
    expect(stdout).toContain("--host-env");
    expect(stdout).toContain("--include-build-output");
    expect(stdout).toContain("--min-memory-mb");
    expect(stdout).toContain("--scan-required-env");
    expect(stdout).toContain("--generate-missing-secret-env");
    expect(stdout).toContain("--postgres");
    expect(stdout).toContain("--no-postgres-grant-created-roles");
  });

  test("prints redaction-safe dry-run JSON", () => {
    const repo = makeRepo();
    const proc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "sandbox",
        "launch",
        repo,
        "--working-dir",
        "packages/web",
        "--mode",
        "dev",
        "--port",
        "3325",
        "--db-setup",
        "pnpm run db:migrate:run",
        "--db-setup",
        "pnpm run db:seed",
        "--env",
        "APP_URL=http://localhost:3325",
        "--url-env",
        "APP_URL",
        "--min-memory-mb",
        "8192",
        "--include-build-output",
        "--scan-required-env",
        "--generate-missing-secret-env",
        "--dry-run",
        "--json",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = new TextDecoder().decode(proc.stdout);
    const stderr = new TextDecoder().decode(proc.stderr);
    expect(proc.exitCode).toBe(0);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout) as {
      publicUrl: string;
      phases: Array<{ name: string; command?: string }>;
      envKeys: string[];
      exclude: string[];
      hostEnvNames: string[];
      minMemoryMb: number;
      scannedRequiredEnvKeys: string[];
      generatedEnvKeys: string[];
    };
    expect(result.publicUrl).toBe("http://<sandbox-public-url>");
    expect(result.minMemoryMb).toBe(8192);
    expect(result.exclude).not.toContain(".next");
    expect(result.exclude).toContain(".env");
    expect(result.phases.map((phase) => phase.name)).toEqual([
      "bootstrap",
      "install",
      "db:1",
      "db:2",
      "start",
      "wait",
      "public-wait",
    ]);
    expect(result.phases.some((phase) => "command" in phase)).toBe(false);
    expect(result.hostEnvNames).toEqual(["NEXT_ALLOWED_DEV_ORIGINS"]);
    expect(result.envKeys).toEqual([
      "APP_URL",
      "JWT_REFRESH_SECRET",
      "NEXT_ALLOWED_DEV_ORIGINS",
      "TESTERS_INTERNAL_URL",
      "TESTERS_PUBLIC_HOST",
      "TESTERS_PUBLIC_URL",
    ]);
    expect(result.scannedRequiredEnvKeys).toEqual(["JWT_REFRESH_SECRET"]);
    expect(result.generatedEnvKeys).toEqual(["JWT_REFRESH_SECRET"]);
  });
});
