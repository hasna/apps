import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "fs";
import { spawn } from "node:child_process";
import { tmpdir } from "os";
import { join } from "path";
import { filesLocalModeNotice } from "../lib/cloud-storage.js";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
/** The ONE line a local run prints on stderr — nothing else is allowed. */
const LOCAL_NOTICE = `${filesLocalModeNotice()}\n`;
let testDir: string | undefined;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("sources CLI", () => {
  test("drains JSON larger than a pipe buffer before exiting", async () => {
    const env = cliEnv();
    seedLargeSourceList(env);

    const regularOutputPath = join(testDir!, "sources-regular.json");
    const regular = await runCliToFile(["sources", "list", "--json"], env, regularOutputPath);
    const regularOutput = readFileSync(regularOutputPath, "utf8");
    const regularSources = JSON.parse(regularOutput) as Array<{ name: string }>;

    expect(regular.exitCode).toBe(0);
    // An opted-in local run's stderr carries exactly the local-mode notice, and nothing else.
    expect(regular.stderr).toBe(LOCAL_NOTICE);
    expect(Buffer.byteLength(regularOutput)).toBeGreaterThan(64 * 1024);
    expect(regularSources).toHaveLength(1201);

    const piped = await runCliThroughPipe(["sources", "list", "--json"], env);
    expect(piped.exitCode).toBe(0);
    expect(piped.stderr).toBe(LOCAL_NOTICE);
    expect(Buffer.byteLength(piped.stdout)).toBe(Buffer.byteLength(regularOutput));
    expect(JSON.parse(piped.stdout)).toEqual(regularSources);
  });

  test("persists AWS profile on S3 sources", () => {
    const env = cliEnv();
    const add = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "sources",
        "add",
        "s3://example-files-bucket-archive/google-drive",
        "--region",
        "us-east-1",
        "--aws-profile",
        "test-aws-profile",
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(add.exitCode).toBe(0);

    const list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{
      bucket?: string;
      prefix?: string;
      region?: string;
      config?: { profile?: string };
    }>;

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      bucket: "example-files-bucket-archive",
      prefix: "google-drive",
      region: "us-east-1",
      config: { profile: "test-aws-profile" },
    });
  });

  test("rejects static S3 credentials instead of storing them", () => {
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "sources",
        "add",
        "s3://example-files-bucket-archive",
        "--access-key",
        "static-access",
        "--secret-key",
        "static-secret",
      ],
      env: cliEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stderr)).toContain("Static S3 credentials are not stored");
  });

  test("persists S3-compatible endpoint diagnostics without static secrets", () => {
    const env = cliEnv();
    const add = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "sources",
        "add",
        "s3://example-files/objects",
        "--region",
        "us-east-1",
        "--endpoint",
        "https://s3-compatible.example.test",
        "--force-path-style",
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(add.exitCode).toBe(0);

    const list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{
      config?: { endpoint?: string; forcePathStyle?: boolean; accessKeyId?: string; secretAccessKey?: string };
    }>;

    expect(sources[0]?.config).toMatchObject({
      endpoint: "https://s3-compatible.example.test",
      forcePathStyle: true,
    });
    expect(sources[0]?.config?.accessKeyId).toBeUndefined();
    expect(sources[0]?.config?.secretAccessKey).toBeUndefined();
  });

  test("bootstraps the legacy prod-emails alias with canonical files bucket defaults", () => {
    const env = cliEnv();
    const bootstrap = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "bootstrap-prod-emails", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(bootstrap.exitCode).toBe(0);
    const bootstrapped = JSON.parse(new TextDecoder().decode(bootstrap.stdout)) as {
      source: { bucket?: string; name: string; prefix?: string; region?: string; config?: { profile?: string } };
      google_drive_default_destination_source_id?: string;
    };

    expect(bootstrapped.source).toMatchObject({
      name: "prod-files-drive",
      bucket: "example-files-bucket",
      prefix: "imports/google-drive/live",
      region: "us-east-1",
      config: { profile: "test-aws-profile" },
    });
    expect(bootstrapped.google_drive_default_destination_source_id).toBeDefined();
  });

  test("bootstraps the production Drive archive by updating a stale bucket source and setting Drive default", () => {
    const env = cliEnv();
    const stale = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", "s3://example-files-bucket-legacy", "--name", "prod-files"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stale.exitCode).toBe(0);

    const bootstrap = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "bootstrap-prod-files", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(bootstrap.exitCode).toBe(0);
    const bootstrapped = JSON.parse(new TextDecoder().decode(bootstrap.stdout)) as {
      source: { id: string; bucket?: string; name: string; config?: { profile?: string } };
      google_drive_default_destination_source_id?: string;
    };

    expect(bootstrapped.source).toMatchObject({
      name: "prod-files-drive",
      bucket: "example-files-bucket",
      prefix: "imports/google-drive/live",
      region: "us-east-1",
      config: { profile: "test-aws-profile" },
    });
    expect(bootstrapped.google_drive_default_destination_source_id).toBe(bootstrapped.source.id);

    const list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{ type: string; bucket?: string; prefix?: string }>;
    expect(sources.filter((source) => source.type === "s3")).toEqual([
      expect.objectContaining({ bucket: "example-files-bucket", prefix: "imports/google-drive/live" }),
    ]);

    const config = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "config", "get", "google_drive_default_destination_source_id"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(JSON.parse(new TextDecoder().decode(config.stdout))).toBe(bootstrapped.source.id);
  });

  test("bootstraps the S3 source used by enabled Drive sources before disabled legacy duplicates", () => {
    const env = cliEnv();
    const disabledLegacy = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", "s3://example-files-bucket-legacy", "--name", "prod-files"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(disabledLegacy.exitCode).toBe(0);

    let list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const disabledId = (JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{ id: string }>)[0]!.id;
    expect(Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "disable", disabledId],
      env,
      stdout: "pipe",
      stderr: "pipe",
    }).exitCode).toBe(0);

    const activeLegacy = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", "s3://example-files-bucket-archive", "--name", "prod-files"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(activeLegacy.exitCode).toBe(0);

    list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const activeId = (JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{
      id: string;
      type: string;
      enabled: boolean;
    }>).find((source) => source.type === "s3" && source.enabled)!.id;

    const drive = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "sources",
        "add-google-drive",
        "--profile",
        "andreihasnacom",
        "--include-my-drive",
        "--destination-source",
        activeId,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(drive.exitCode).toBe(0);

    const bootstrap = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "bootstrap-prod-files", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(bootstrap.exitCode).toBe(0);
    const bootstrapped = JSON.parse(new TextDecoder().decode(bootstrap.stdout)) as {
      source: { id: string; bucket?: string; prefix?: string };
      google_drive_default_destination_source_id?: string;
      updated_google_drive_source_ids: string[];
      disabled_legacy_source_ids: string[];
    };

    expect(bootstrapped.source.id).toBe(activeId);
    expect(bootstrapped.source).toMatchObject({
      bucket: "example-files-bucket",
      prefix: "imports/google-drive/live",
    });
    expect(bootstrapped.google_drive_default_destination_source_id).toBe(activeId);
    expect(bootstrapped.updated_google_drive_source_ids).toEqual([]);
    expect(bootstrapped.disabled_legacy_source_ids).toEqual([]);

    list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{
      id: string;
      type: string;
      bucket?: string;
      enabled: boolean;
    }>;
    expect(sources.find((source) => source.id === activeId)).toMatchObject({
      bucket: "example-files-bucket",
      enabled: true,
    });
    expect(sources.find((source) => source.id === disabledId)).toMatchObject({
      bucket: "example-files-bucket-legacy",
      enabled: false,
    });
  });

  test("repairs Drive source destinations that point at disabled legacy S3 sources", () => {
    const env = cliEnv();
    const legacy = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", "s3://example-files-bucket-archive/google-drive", "--name", "prod-files"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(legacy.exitCode).toBe(0);

    let list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const legacyId = (JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{ id: string }>)[0]!.id;

    const drive = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "sources",
        "add-google-drive",
        "--profile",
        "andreihasnacom",
        "--include-my-drive",
        "--destination-source",
        legacyId,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(drive.exitCode).toBe(0);

    expect(Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "disable", legacyId],
      env,
      stdout: "pipe",
      stderr: "pipe",
    }).exitCode).toBe(0);

    const bootstrap = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "bootstrap-prod-files", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(bootstrap.exitCode).toBe(0);
    const bootstrapped = JSON.parse(new TextDecoder().decode(bootstrap.stdout)) as {
      source: { id: string; bucket?: string; prefix?: string };
      updated_google_drive_source_ids: string[];
    };
    expect(bootstrapped.source.id).toBe(legacyId);
    expect(bootstrapped.source).toMatchObject({
      bucket: "example-files-bucket",
      prefix: "imports/google-drive/live",
    });
    expect(bootstrapped.updated_google_drive_source_ids).toEqual([]);

    list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{
      id: string;
      type: string;
      config: { destination_source_id?: string };
    }>;
    const driveSource = sources.find((source) => source.type === "google_drive")!;
    expect(driveSource.config.destination_source_id).toBe(legacyId);
  });
});

function cliEnv(): NodeJS.ProcessEnv {
  testDir = mkdtempSync(join(tmpdir(), "open-files-cli-"));
  const env = { ...process.env };
  for (const key of [
    "HASNA_FILES_API_URL",
    "FILES_API_URL",
    "HASNA_FILES_API_KEY",
    "FILES_API_KEY",
  ]) {
    delete env[key];
  }
  return {
    ...env,
    HASNA_FILES_DATA_DIR: testDir,
    HASNA_FILES_DB_PATH: join(testDir, "files.db"),
    // This package ships no default bucket/profile (see SECURITY note in
    // src/cli/index.tsx); the bootstrap-prod-files/emails tests below rely on
    // these being set, exactly as an operator would configure them.
    HASNA_FILES_S3_BUCKET: "example-files-bucket",
    HASNA_FILES_AWS_PROFILE: "test-aws-profile",
  };
}

function seedLargeSourceList(env: NodeJS.ProcessEnv): void {
  const initialized = Bun.spawnSync({
    cmd: ["bun", cliPath, "sources", "add", testDir!, "--name", "pipe-output-control"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(initialized.exitCode).toBe(0);

  const db = new Database(env.HASNA_FILES_DB_PATH!);
  const machine = db.query<{ id: string }, []>("SELECT id FROM machines LIMIT 1").get();
  expect(machine).not.toBeNull();
  const insert = db.prepare(`
    INSERT INTO sources (id, name, type, path, config, machine_id)
    VALUES (?, ?, 'local', ?, ?, ?)
  `);
  const seed = db.transaction(() => {
    for (let index = 0; index < 1200; index += 1) {
      const suffix = index.toString().padStart(4, "0");
      insert.run(
        `src_pipe_${suffix}`,
        `pipe-source-${suffix}-${"n".repeat(64)}`,
        `/tmp/pipe-output/${suffix}/${"p".repeat(96)}`,
        JSON.stringify({ marker: "c".repeat(64) }),
        machine!.id,
      );
    }
  });
  seed();
  db.close();
}

function runCliThroughPipe(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [cliPath, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function runCliToFile(
  args: string[],
  env: NodeJS.ProcessEnv,
  outputPath: string,
): Promise<{ exitCode: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const stdoutFd = openSync(outputPath, "w");
    let stdoutClosed = false;
    const closeStdout = () => {
      if (stdoutClosed) return;
      closeSync(stdoutFd);
      stdoutClosed = true;
    };
    const child = spawn("bun", [cliPath, ...args], {
      env,
      stdio: ["ignore", stdoutFd, "pipe"],
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      closeStdout();
      reject(error);
    });
    child.once("close", (exitCode) => {
      closeStdout();
      resolve({
        exitCode,
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
