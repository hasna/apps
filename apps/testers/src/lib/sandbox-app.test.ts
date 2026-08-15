import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSandboxAppUploadExcludes,
  launchSandboxApp,
  parseDurationSeconds,
  parseSandboxAppEnvAssignments,
  SANDBOX_APP_DEFAULT_UPLOAD_EXCLUDES,
  wrapE2BProviderImageSupport,
  type SandboxAppRuntime,
} from "./sandbox-app.js";

const cleanupPaths: string[] = [];
const originalTestersDir = process.env.HASNA_TESTERS_DIR;
const originalSecret = process.env.SECRET_TOKEN;

afterEach(() => {
  if (originalTestersDir === undefined) delete process.env.HASNA_TESTERS_DIR;
  else process.env.HASNA_TESTERS_DIR = originalTestersDir;
  if (originalSecret === undefined) delete process.env.SECRET_TOKEN;
  else process.env.SECRET_TOKEN = originalSecret;
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function makeRepo(packageJson: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "testers-sandbox-app-"));
  cleanupPaths.push(dir);
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
      },
      dependencies: {
        next: "16.0.0",
      },
      ...packageJson,
    }),
  );
  return dir;
}

describe("sandbox app launcher", () => {
  test("exports reusable upload exclude rules with optional build output", () => {
    expect(SANDBOX_APP_DEFAULT_UPLOAD_EXCLUDES).toEqual(
      expect.arrayContaining([".env.*", ".npmrc", "*.pem", ".git"]),
    );
    expect(buildSandboxAppUploadExcludes()).toEqual(
      SANDBOX_APP_DEFAULT_UPLOAD_EXCLUDES,
    );
    expect(
      buildSandboxAppUploadExcludes({ includeBuildOutput: true }),
    ).not.toContain(".next");
    expect(
      buildSandboxAppUploadExcludes({ exclude: ["local-only"] }),
    ).toContain("local-only");
  });

  test("builds a redaction-safe dry-run plan with ordered phases", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, "packages", "web"), { recursive: true });
    writeFileSync(
      join(repo, "packages", "web", "package.json"),
      JSON.stringify({
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
        },
        dependencies: { next: "16.0.0" },
      }),
    );

    const result = await launchSandboxApp({
      sourceDir: repo,
      workingDir: "packages/web",
      mode: "prod",
      port: 3325,
      env: { APP_URL: "http://localhost:3325" },
      urlEnvNames: ["APP_URL"],
      dbCommands: ["pnpm run db:migrate:run", "pnpm run db:seed"],
      postgres: {
        enabled: true,
        database: "app_test",
        user: "testers",
        password: "testers",
        port: 5432,
      },
      dryRun: true,
      now: () => new Date("2026-06-15T00:00:00.000Z"),
    });

    expect(result.dryRun).toBe(true);
    expect(result.publicUrl).toBe("http://<sandbox-public-url>");
    expect(result.workingDir).toBe("packages/web");
    expect(result.port).toBe(3325);
    expect(result.envKeys).toContain("DATABASE_URL");
    expect(result.envKeys).toContain("DATABASE_DIRECT_URL");
    expect(result.urlEnvNames).toEqual(["APP_URL"]);
    expect(result.exclude).toEqual(
      expect.arrayContaining([".env.*", ".npmrc", "*.pem", ".git"]),
    );
    expect(
      result.phases.find((phase) => phase.name === "postgres")?.command,
    ).toContain("run_as_postgres");
    expect(
      result.phases.find((phase) => phase.name === "postgres")?.command,
    ).toContain("pg_auth_members");
    expect(
      result.phases.find((phase) => phase.name === "postgres")?.command,
    ).toContain("parent.rolname = migration_role");
    expect(
      result.phases.find((phase) => phase.name === "postgres")?.command,
    ).toContain("NOT child.rolcanlogin");
    expect(
      result.phases.find((phase) => phase.name === "postgres")?.command,
    ).toContain("GRANT %I TO %I");
    expect(
      result.phases.find((phase) => phase.name === "postgres")?.command,
    ).not.toMatch(/\nsudo -u postgres (psql|createdb)/);
    expect(
      result.phases.find((phase) => phase.name === "postgres")?.command,
    ).not.toContain("psql -p '5432' -c \"");
    expect(result.phases.map((phase) => phase.name)).toEqual([
      "bootstrap",
      "postgres",
      "install",
      "db:1",
      "postgres:grants:1",
      "db:2",
      "postgres:grants:2",
      "build",
      "start",
      "wait",
      "public-wait",
    ]);
  });

  test("bootstraps bun when pnpm package scripts depend on bun", async () => {
    const repo = makeRepo({
      scripts: {
        dev: "next dev",
        start: "next start",
        "db:seed": "bun run scripts/seed.ts",
      },
      dependencies: { next: "16.0.0" },
    });

    const result = await launchSandboxApp({
      sourceDir: repo,
      mode: "dev",
      dbCommands: ["pnpm run db:seed"],
      dryRun: true,
    });

    const bootstrap = result.phases.find((phase) => phase.name === "bootstrap");
    expect(bootstrap?.command).toContain("https://bun.sh/install");
  });

  test("infers Next dev-origin public host env values", async () => {
    const repo = makeRepo();

    const result = await launchSandboxApp({
      sourceDir: repo,
      env: {
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      },
      dryRun: true,
    });

    expect(result.urlEnvNames).toEqual(["NEXT_PUBLIC_APP_URL"]);
    expect(result.hostEnvNames).toEqual(["NEXT_ALLOWED_DEV_ORIGINS"]);
    expect(result.envKeys).toEqual(
      expect.arrayContaining([
        "NEXT_ALLOWED_DEV_ORIGINS",
        "NEXT_PUBLIC_APP_URL",
        "TESTERS_INTERNAL_URL",
        "TESTERS_PUBLIC_HOST",
        "TESTERS_PUBLIC_URL",
      ]),
    );
  });

  test("packageManager metadata wins over extra lockfiles", async () => {
    const repo = makeRepo({ packageManager: "pnpm@10.16.1" });
    writeFileSync(join(repo, "bun.lock"), "");

    const result = await launchSandboxApp({
      sourceDir: repo,
      mode: "dev",
      dryRun: true,
    });

    expect(
      result.phases.find((phase) => phase.name === "install")?.command,
    ).toBe("pnpm install");
  });

  test("adds a host arg to custom dev scripts that only set the port", async () => {
    const repo = makeRepo({
      scripts: {
        dev: "node scripts/run-next-dev.mjs -- --turbopack --port 3325",
        start: "next start --port 3325",
      },
      dependencies: { next: "16.0.0" },
    });

    const result = await launchSandboxApp({
      sourceDir: repo,
      mode: "dev",
      port: 3325,
      dryRun: true,
    });

    const start = result.phases.find(
      (phase) => phase.name === "start",
    )?.command;
    expect(start).toContain("pnpm run dev");
    expect(start).toContain("--hostname");
    expect(start).toContain("0.0.0.0");
    expect(start).not.toContain("'--port' '3325'");
  });

  test("adds a port arg to custom dev scripts that only set the host", async () => {
    const repo = makeRepo({
      scripts: {
        dev: "next dev --hostname 0.0.0.0",
      },
      dependencies: { next: "16.0.0" },
    });

    const result = await launchSandboxApp({
      sourceDir: repo,
      mode: "dev",
      port: 3325,
      dryRun: true,
    });

    const start = result.phases.find(
      (phase) => phase.name === "start",
    )?.command;
    expect(start).not.toContain("'--hostname' '0.0.0.0'");
    expect(start).toContain("'--port' '3325'");
  });

  test("verifies the public sandbox URL after internal readiness", async () => {
    const repo = makeRepo();

    const result = await launchSandboxApp({
      sourceDir: repo,
      mode: "dev",
      port: 3325,
      waitUrl: "/api/health",
      dryRun: true,
    });

    const publicWait = result.phases.find(
      (phase) => phase.name === "public-wait",
    );
    expect(publicWait?.command).toContain(
      "http://<sandbox-public-url>/api/health",
    );
    expect(publicWait?.command).toContain("REQUIRED_SUCCESSES=3");
    expect(publicWait?.timeoutMs).toBe(90_000);
  });

  test("uses the Next standalone server for production standalone builds", async () => {
    const repo = makeRepo({
      scripts: {
        build: "next build",
        start: "next start",
      },
      dependencies: { next: "16.0.0" },
    });
    writeFileSync(
      join(repo, "next.config.mjs"),
      "export default { output: 'standalone' };\n",
    );

    const result = await launchSandboxApp({
      sourceDir: repo,
      mode: "prod",
      port: 3325,
      dryRun: true,
    });

    const start = result.phases.find(
      (phase) => phase.name === "start",
    )?.command;
    expect(start).toContain("node .next/standalone/server.js");
    expect(start).toContain("HOSTNAME=0.0.0.0");
    expect(start).toContain("PORT='3325'");
    expect(start).not.toContain("pnpm run start");
  });

  test("refuses literal values for secret-like env keys by default", () => {
    expect(() =>
      parseSandboxAppEnvAssignments(["API_KEY=literal-secret"]),
    ).toThrow(/Refusing literal value/);
    expect(parseSandboxAppEnvAssignments(["API_KEY=$API_KEY"], [])).toEqual({
      API_KEY: "$API_KEY",
    });
    expect(
      parseSandboxAppEnvAssignments(["API_KEY=literal-secret"], [], {
        allowLiteralSecretValues: true,
      }),
    ).toEqual({
      API_KEY: "literal-secret",
    });
  });

  test("can include build output while still excluding secret files", async () => {
    const repo = makeRepo();

    const result = await launchSandboxApp({
      sourceDir: repo,
      includeBuildOutput: true,
      dryRun: true,
    });

    expect(result.exclude).not.toContain(".next");
    expect(result.exclude).not.toContain("dist");
    expect(result.exclude).not.toContain("build");
    expect(result.exclude).not.toContain("out");
    expect(result.exclude).toContain(".env");
    expect(result.exclude).toContain(".env.*");
    expect(result.exclude).toContain(".npmrc");
    expect(result.exclude).toContain("*.key");
    expect(result.exclude).toContain("node_modules");
  });

  test("scans required env and generates sandbox-only internal secrets", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(
      join(repo, "src", "env.ts"),
      [
        'export const refresh = requireEnv("JWT_REFRESH_SECRET");',
        'export const appUrl = requireEnv("APP_URL");',
      ].join("\n"),
    );

    const result = await launchSandboxApp({
      sourceDir: repo,
      scanRequiredEnv: true,
      generateMissingSecretEnv: true,
      installCommand: "none",
      buildCommand: "none",
      dryRun: true,
    });

    expect(result.scannedRequiredEnvKeys).toEqual([
      "APP_URL",
      "JWT_REFRESH_SECRET",
    ]);
    expect(result.generatedEnvKeys).toEqual(["JWT_REFRESH_SECRET"]);
    expect(result.urlEnvNames).toContain("APP_URL");
    expect(result.envKeys).toEqual(
      expect.arrayContaining(["APP_URL", "JWT_REFRESH_SECRET"]),
    );
    expect(JSON.stringify(result)).not.toContain("testers-jwt-refresh-secret");
  });

  test("required env scan fails for missing non-secret values", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(
      join(repo, "src", "env.ts"),
      'export const region = requireEnv("PUBLIC_REGION");',
    );

    await expect(
      launchSandboxApp({
        sourceDir: repo,
        scanRequiredEnv: true,
        generateMissingSecretEnv: true,
        installCommand: "none",
        buildCommand: "none",
        dryRun: true,
      }),
    ).rejects.toThrow(/PUBLIC_REGION/);
  });

  test("launches through a runtime, injects public URL env, and stores no env values in result", async () => {
    const repo = makeRepo();
    const stateDir = mkdtempSync(join(tmpdir(), "testers-sandbox-state-"));
    cleanupPaths.push(stateDir);
    process.env.HASNA_TESTERS_DIR = stateDir;
    process.env.SECRET_TOKEN = "resolved-secret";
    const calls: Array<{
      command?: string;
      env?: Record<string, string>;
      upload?: unknown;
    }> = [];

    const runtime: SandboxAppRuntime = {
      async createSandbox() {
        return {
          id: "sb_app",
          provider: "e2b",
          provider_sandbox_id: "provider_sb",
        };
      },
      async uploadDir(_sandboxId, localDir, remoteDir, opts) {
        calls.push({ upload: { localDir, remoteDir, opts } });
        return { bytes: 123 };
      },
      async execCommand(_sandboxId, command, opts) {
        calls.push({ command, env: opts?.env });
        return {
          session: { id: `sess_${calls.length}` },
          result: { exit_code: 0, stdout: "", stderr: "" },
        };
      },
      async getPublicUrl() {
        return "https://public.example.test";
      },
      async keepAlive() {},
      async deleteSandbox() {},
      async stopSandbox() {},
    };

    const result = await launchSandboxApp({
      sourceDir: repo,
      port: 3000,
      env: { SECRET_TOKEN: "$SECRET_TOKEN", APP_URL: "http://localhost:3000" },
      urlEnvNames: ["APP_URL"],
      installCommand: "none",
      buildCommand: "none",
      runtime,
      now: () => new Date("2026-06-15T00:00:00.000Z"),
    });

    expect(result.publicUrl).toBe("https://public.example.test");
    expect(result.publicHost).toBe("public.example.test");
    expect(result.envKeys).toEqual([
      "APP_URL",
      "NEXT_ALLOWED_DEV_ORIGINS",
      "SECRET_TOKEN",
      "TESTERS_INTERNAL_URL",
      "TESTERS_PUBLIC_HOST",
      "TESTERS_PUBLIC_URL",
    ]);
    expect(JSON.stringify(result)).not.toContain("resolved-secret");
    expect(
      calls.some((call) => call.env?.APP_URL === "https://public.example.test"),
    ).toBe(true);
    expect(
      calls.some(
        (call) => call.env?.NEXT_ALLOWED_DEV_ORIGINS === "public.example.test",
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) => call.env?.TESTERS_PUBLIC_HOST === "public.example.test",
      ),
    ).toBe(true);
    expect(
      calls.some((call) => call.env?.SECRET_TOKEN === "resolved-secret"),
    ).toBe(true);
  });

  test("fails before upload when the sandbox has less than the requested memory", async () => {
    const repo = makeRepo();
    let uploaded = false;
    let deleted = false;
    const runtime: SandboxAppRuntime = {
      async createSandbox() {
        return {
          id: "sb_small",
          provider: "e2b",
          provider_sandbox_id: "provider_sb",
        };
      },
      async uploadDir() {
        uploaded = true;
        return { bytes: 123 };
      },
      async execCommand() {
        return {
          session: { id: "sess_memory" },
          result: { exit_code: 0, stdout: "2048\n", stderr: "" },
        };
      },
      async getPublicUrl() {
        return "https://public.example.test";
      },
      async deleteSandbox() {
        deleted = true;
      },
    };

    await expect(
      launchSandboxApp({
        sourceDir: repo,
        installCommand: "none",
        buildCommand: "none",
        minMemoryMb: 4096,
        runtime,
      }),
    ).rejects.toThrow(/requested at least 4096 MB, provider returned 2048 MB/);
    expect(uploaded).toBe(false);
    expect(deleted).toBe(true);
  });

  test("postgres mode overrides external database URLs with sandbox-local URLs", async () => {
    const repo = makeRepo();
    const stateDir = mkdtempSync(join(tmpdir(), "testers-sandbox-state-"));
    cleanupPaths.push(stateDir);
    process.env.HASNA_TESTERS_DIR = stateDir;
    const calls: Array<{ env?: Record<string, string> }> = [];
    const runtime: SandboxAppRuntime = {
      async createSandbox() {
        return {
          id: "sb_app",
          provider: "e2b",
          provider_sandbox_id: "provider_sb",
        };
      },
      async uploadDir() {
        return { bytes: 123 };
      },
      async execCommand(_sandboxId, _command, opts) {
        calls.push({ env: opts?.env });
        return {
          session: { id: `sess_${calls.length}` },
          result: { exit_code: 0, stdout: "", stderr: "" },
        };
      },
      async getPublicUrl() {
        return "https://public.example.test";
      },
      async keepAlive() {},
    };

    await launchSandboxApp({
      sourceDir: repo,
      env: {
        DATABASE_URL: "postgresql://external.example/prod",
        DATABASE_DIRECT_URL: "postgresql://external.example/direct",
      },
      postgres: {
        enabled: true,
        database: "app_test",
        user: "testers",
        password: "testers",
        port: 5432,
      },
      installCommand: "none",
      buildCommand: "none",
      runtime,
    });

    expect(
      calls.some(
        (call) =>
          call.env?.DATABASE_URL ===
          "postgresql://testers:testers@127.0.0.1:5432/app_test",
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.env?.DATABASE_DIRECT_URL ===
          "postgresql://postgres:testers@127.0.0.1:5432/app_test",
      ),
    ).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("external.example");
  });

  test("postgres SQL is shell-quoted when values contain shell metacharacters", async () => {
    const repo = makeRepo();

    const result = await launchSandboxApp({
      sourceDir: repo,
      postgres: {
        enabled: true,
        database: "app-test",
        user: "tester-user",
        password: "pa'`$word",
        port: 5432,
      },
      installCommand: "none",
      buildCommand: "none",
      dryRun: true,
    });

    const postgresCommand =
      result.phases.find((phase) => phase.name === "postgres")?.command ?? "";
    expect(postgresCommand).toContain("psql -v ON_ERROR_STOP=1");
    expect(postgresCommand).toContain('CREATE USER "tester-user"');
    expect(postgresCommand).not.toContain('PASSWORD "');
    expect(postgresCommand).not.toContain('-c "CREATE USER');
    expect(postgresCommand).not.toContain("nspname = '$schema'");
  });

  test("postgres created-role grants can be disabled for strict role modeling", async () => {
    const repo = makeRepo();

    const result = await launchSandboxApp({
      sourceDir: repo,
      postgres: {
        enabled: true,
        database: "app_test",
        user: "testers",
        password: "testers",
        port: 5432,
        grantCreatedRoles: false,
      },
      installCommand: "none",
      buildCommand: "none",
      dryRun: true,
    });

    const postgresCommand =
      result.phases.find((phase) => phase.name === "postgres")?.command ?? "";
    expect(postgresCommand).not.toContain("pg_auth_members");
    expect(postgresCommand).not.toContain("GRANT %I TO %I");
  });

  test("wraps E2B provider create so image selects the requested template", async () => {
    const createCalls: unknown[] = [];
    class FakeProvider {
      name = "e2b";

      async create(opts?: unknown) {
        createCalls.push(["provider", opts]);
        return { id: "default-provider-sandbox", status: "running" };
      }

      async uploadDir() {
        return { bytes: 1 };
      }
    }
    const provider = await wrapE2BProviderImageSupport(
      new FakeProvider(),
      "api-key",
      {
        async create(...args: unknown[]) {
          createCalls.push(["e2b", args]);
          return { sandboxId: "template-sandbox" };
        },
      },
    );

    await expect(provider.create({ timeout: 60 })).resolves.toEqual({
      id: "default-provider-sandbox",
      status: "running",
    });
    await expect(
      provider.create({
        image: "alumia-8g",
        timeout: 120,
        envVars: { FOO: "bar" },
      }),
    ).resolves.toEqual({
      id: "template-sandbox",
      status: "running",
    });
    expect(createCalls).toEqual([
      ["provider", { timeout: 60 }],
      [
        "e2b",
        [
          "alumia-8g",
          { apiKey: "api-key", timeoutMs: 120000, envs: { FOO: "bar" } },
        ],
      ],
    ]);
    await expect(
      (provider as unknown as FakeProvider).uploadDir(),
    ).resolves.toEqual({ bytes: 1 });
  });

  test("parses simple duration values", () => {
    expect(parseDurationSeconds("45m")).toBe(2700);
    expect(parseDurationSeconds("2h")).toBe(7200);
    expect(parseDurationSeconds("1500ms")).toBe(2);
  });
});
