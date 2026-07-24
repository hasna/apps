import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../../package.json";

const REPO_ROOT = join(import.meta.dir, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runBuilt(
  entry: string,
  home: string,
  args: string[],
  mode: string,
  extraEnv: Record<string, string> = {},
) {
  return Bun.spawnSync(["bun", entry, ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      TMPDIR: home,
      HASNA_TODOS_STORAGE_MODE: mode,
      TODOS_STORAGE_MODE: mode,
      HASNA_TODOS_DB_PATH: join(home, "todos.db"),
      TODOS_DB_PATH: join(home, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("shipped CLI Stage-A bootstrap", () => {
  test("the entrypoint is dependency-light and official builds preserve dynamic chunks", () => {
    const source = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
    expect(source).toContain('await import("./runtime.js")');
    expect(source).not.toContain('from "commander"');
    expect(source).not.toContain("getPackageVersion");
    expect(packageJson.scripts.build).toContain("--splitting");
    expect(packageJson.scripts["build:server"]).toContain("--splitting");
  });

  test("the actual built binary denies hosted data commands before loading the command graph", () => {
    const outputRoot = mkdtempSync(join(REPO_ROOT, ".tmp-todos-built-cli-"));
    const home = mkdtempSync(join(REPO_ROOT, ".tmp-todos-built-cli-home-"));
    const statusHome = mkdtempSync(join(REPO_ROOT, ".tmp-todos-built-status-home-"));
    roots.push(outputRoot, home, statusHome);
    const build = Bun.spawnSync([
      "bun", "build", "src/cli/index.tsx", "--outdir", outputRoot, "--target", "bun", "--splitting",
      "--external", "ink", "--external", "react", "--external", "chalk",
      "--external", "@modelcontextprotocol/sdk",
    ], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
    expect(build.exitCode).toBe(0);
    const entry = join(outputRoot, "index.js");
    expect(existsSync(entry)).toBe(true);
    const entrySource = readFileSync(entry, "utf8");
    const moduleSpecifiers = [
      ...entrySource.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...entrySource.matchAll(/\bimport\s*["']([^"']+)["']/g),
      ...entrySource.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']/g),
    ].map((match) => match[1]!);
    expect(moduleSpecifiers.filter((specifier) => /(?:^|[/@])(?:react|ink)(?:$|[/])/i.test(specifier))).toEqual([]);

    const denied = runBuilt(entry, home, ["--json", "list"], "self_hosted");
    expect(denied.exitCode).not.toBe(0);
    expect(`${denied.stdout.toString()}\n${denied.stderr.toString()}`).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
    expect(existsSync(join(home, "todos.db"))).toBe(false);

    const local = runBuilt(entry, home, ["--version"], "local");
    expect(local.exitCode).toBe(0);
    expect(local.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(local.stderr.toString()).toBe("");
    expect(existsSync(join(home, "todos.db"))).toBe(false);

    for (const mode of ["local", "remote"]) {
      const commandHelp = runBuilt(entry, home, ["help", "list"], mode);
      expect(commandHelp.exitCode).toBe(0);
      expect(commandHelp.stderr.toString()).toBe("");
      expect(commandHelp.stdout.toString()).toContain("Usage: todos list");
      expect(existsSync(join(home, "todos.db"))).toBe(false);
    }

    const localData = runBuilt(entry, home, ["--json", "list"], "local");
    expect(localData.exitCode).toBe(0);
    expect(JSON.parse(localData.stdout.toString())).toEqual([]);
    expect(localData.stderr.toString()).toBe("");
    expect(existsSync(join(home, "todos.db"))).toBe(true);

    const redacted = runBuilt(entry, statusHome, ["--json", "storage", "status"], "remote", {
      TODOS_STORAGE_MODE: "",
      HASNA_TODOS_DATABASE_URL:
        "postgres://fixture-user:fixture-pass@db.example.test/"
        + Array.from(new TextEncoder().encode("FAKE_ONLY_BUILT_DATABASE_PATH_MARKER"))
          .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
          .join("")
        + "?sslmode=require&password=query-secret&access_token=query-token#fragment-secret",
    });
    expect(redacted.exitCode).toBe(0);
    expect(JSON.parse(redacted.stdout.toString())).toMatchObject({
      mode: "remote",
      no_network: true,
    });
    for (const secret of [
      "fixture-user",
      "fixture-pass",
      "query-secret",
      "query-token",
      "fragment-secret",
      "sslmode=require",
      "FAKE_ONLY_BUILT_DATABASE_PATH_MARKER",
    ]) {
      expect(`${redacted.stdout.toString()}\n${redacted.stderr.toString()}`).not.toContain(secret);
    }
    expect(JSON.parse(redacted.stdout.toString()).database.redacted_url).toContain("/[REDACTED_PATH]");

    for (const unsafeUrl of [
      "jdbc:postgresql://opaque-user:opaque-pass@db.example.test/todos?password=opaque-query#opaque-fragment",
      "postgres:opaque-user:opaque-pass@db.example.test/todos?password=opaque-query#opaque-fragment",
      "mysql://unknown-user:unknown-pass@db.example.test/todos?password=unknown-query#unknown-fragment",
      "not-a-url malformed-user:malformed-pass/path?password=malformed-query#malformed-fragment",
    ]) {
      const unsafe = runBuilt(entry, statusHome, ["--json", "storage", "status"], "remote", {
        TODOS_STORAGE_MODE: "",
        HASNA_TODOS_DATABASE_URL: unsafeUrl,
      });
      expect(unsafe.exitCode).toBe(0);
      expect(JSON.parse(unsafe.stdout.toString()).database.redacted_url).toBe("(redacted)");
      for (const marker of [
        "opaque-user", "opaque-pass", "opaque-query", "opaque-fragment",
        "unknown-user", "unknown-pass", "unknown-query", "unknown-fragment",
        "malformed-user", "malformed-pass", "malformed-query", "malformed-fragment",
      ]) {
        expect(`${unsafe.stdout.toString()}\n${unsafe.stderr.toString()}`).not.toContain(marker);
      }
    }

    const marker = "not-a-boolean\r\nBUILT_CONTROL_MARKER\u001b[31m";
    const invalid = runBuilt(entry, statusHome, ["--json", "storage", "status"], "remote", {
      TODOS_STORAGE_MODE: "",
      HASNA_TODOS_DATABASE_URL: "postgres://fixture-user:fixture-pass@db.example.test/todos",
      HASNA_TODOS_DATABASE_SSL: marker,
    });
    expect(invalid.exitCode).toBe(0);
    const invalidPayload = JSON.parse(invalid.stdout.toString());
    expect(invalidPayload.ok).toBe(false);
    expect(invalidPayload.issues.join("\n")).toContain("HASNA_TODOS_DATABASE_SSL");
    expect(`${invalid.stdout.toString()}\n${invalid.stderr.toString()}`).not.toContain("not-a-boolean");
    expect(`${invalid.stdout.toString()}\n${invalid.stderr.toString()}`).not.toContain("BUILT_CONTROL_MARKER");
    expect(`${invalid.stdout.toString()}\n${invalid.stderr.toString()}`).not.toContain("fixture-user");
    expect(`${invalid.stdout.toString()}\n${invalid.stderr.toString()}`).not.toContain("fixture-pass");
    expect(`${invalid.stdout.toString()}\n${invalid.stderr.toString()}`).not.toContain("\u001b");

    const fallbackInvalid = runBuilt(entry, statusHome, ["--json", "storage", "status"], "remote", {
      TODOS_STORAGE_MODE: "",
      HASNA_TODOS_DATABASE_URL: "postgres://fallback-user:fallback-pass@db.example.test/todos",
      TODOS_DATABASE_SSL: "not-a-boolean",
      TODOS_SYNC_BATCH_SIZE: "not-a-number",
    });
    expect(fallbackInvalid.exitCode).toBe(0);
    const fallbackPayload = JSON.parse(fallbackInvalid.stdout.toString());
    expect(fallbackPayload.database).toMatchObject({ configured: true, provider: "postgres", ssl: true });
    expect(fallbackPayload.env.databaseSsl.active_name).toBe("TODOS_DATABASE_SSL");
    expect(fallbackPayload.env.syncBatchSize.active_name).toBe("TODOS_SYNC_BATCH_SIZE");
    expect(fallbackPayload.issues).toEqual([
      "TODOS_DATABASE_SSL must be a boolean (1/0, true/false, yes/no, or on/off)",
      "TODOS_SYNC_BATCH_SIZE must be a positive integer",
    ]);
    expect(fallbackPayload.issues.join("\n")).not.toContain("DATABASE_URL is required");
    expect(`${fallbackInvalid.stdout.toString()}\n${fallbackInvalid.stderr.toString()}`).not.toContain("fallback-user");
    expect(`${fallbackInvalid.stdout.toString()}\n${fallbackInvalid.stderr.toString()}`).not.toContain("fallback-pass");

    const hostileEnv = {
      TODOS_STORAGE_MODE: "",
      HASNA_TODOS_DATABASE_URL: "postgres://db.example.test/todos",
      HASNA_TODOS_DATABASE_SCHEMA: "schema\r\nBUILT_SCHEMA_CONTROL\u001b[31m",
      HASNA_TODOS_S3_BUCKET: "bucket\nBUILT_BUCKET_CONTROL\u001b]52;c;payload\u0007",
      HASNA_TODOS_S3_PREFIX:
        `Authorization: Basic YnVpbHQtdXNlcjpidWlsdC1wYXNz/${"x".repeat(60_000)}`,
      HASNA_TODOS_AWS_REGION: "region\rBUILT_REGION_CONTROL",
    };
    const hostileJson = runBuilt(entry, statusHome, ["--json", "storage", "sync-plan"], "remote", hostileEnv);
    expect(hostileJson.exitCode).toBe(0);
    const hostilePayload = JSON.parse(hostileJson.stdout.toString());
    expect(hostilePayload.diagnostics.truncated).toBe(true);
    expect(hostilePayload.diagnostics.truncations.length).toBeGreaterThan(0);
    expect(hostileJson.stdout.byteLength).toBeLessThan(40_000);
    expect(hostilePayload.status.database.schema).toContain("BUILT_SCHEMA_CONTROL");
    expect(hostilePayload.status.object_storage.bucket).toContain("BUILT_BUCKET_CONTROL");
    expect(hostilePayload.status.object_storage.region).toContain("BUILT_REGION_CONTROL");
    for (const field of [
      hostilePayload.status.database.schema,
      hostilePayload.status.object_storage.bucket,
      hostilePayload.status.object_storage.prefix,
      hostilePayload.status.object_storage.region,
    ]) {
      expect(field).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    }

    const hostilePlain = runBuilt(entry, statusHome, ["storage", "status"], "remote", hostileEnv);
    expect(hostilePlain.exitCode).toBe(0);
    expect(hostilePlain.stderr.toString()).toContain("Diagnostics: truncated");
    expect(`${hostilePlain.stdout.toString()}\n${hostilePlain.stderr.toString()}`.length).toBeLessThan(40_000);
    for (const marker of ["YnVpbHQtdXNlcjpidWlsdC1wYXNz", "\u001b", "\u0007"]) {
      expect(`${hostileJson.stdout.toString()}\n${hostileJson.stderr.toString()}`).not.toContain(marker);
      expect(`${hostilePlain.stdout.toString()}\n${hostilePlain.stderr.toString()}`).not.toContain(marker);
    }
    expect(existsSync(join(statusHome, "todos.db"))).toBe(false);
  });
});
