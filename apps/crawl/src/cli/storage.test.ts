import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const repoRoot = join(import.meta.dir, "../..");
const dbPaths: string[] = [];

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return await new Response(stream).text();
}

async function runCli(args: string[], envOverrides: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

afterEach(async () => {
  const { closeDb } = await import("../db/database");
  closeDb();

  for (const dbPath of dbPaths.splice(0)) {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  }
});

describe("crawl storage command", () => {
  it("advertises storage without a legacy cloud command", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("storage");
    expect(result.stdout).not.toMatch(/\n\s+cloud(?:\s|$)/);
  });

  it("reports local storage status with canonical env names", async () => {
    const dbPath = `/tmp/test-crawl-storage-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    dbPaths.push(dbPath);

    const result = await runCli(["storage", "status"], {
      CRAWL_DB_PATH: dbPath,
      HASNA_CRAWL_DB_PATH: dbPath,
    });
    const status = JSON.parse(result.stdout) as {
      configured: boolean;
      mode: string;
      env: string[];
      deprecatedEnv: string[];
      s3: {
        configured: boolean;
        env: { bucket: string[]; prefix: string[]; region: string[] };
      };
      tables: string[];
    };

    expect(result.exitCode).toBe(0);
    expect(status.configured).toBe(false);
    expect(status.mode).toBe("local");
    expect(status.env).toEqual(["HASNA_CRAWL_DATABASE_URL", "CRAWL_DATABASE_URL"]);
    expect(status.deprecatedEnv).toEqual([]);
    expect(status.s3.configured).toBe(false);
    expect(status.s3.env.bucket).toEqual(["HASNA_CRAWL_S3_BUCKET"]);
    expect(status.s3.env.prefix).toEqual(["HASNA_CRAWL_S3_PREFIX"]);
    expect(status.s3.env.region).toContain("HASNA_CRAWL_AWS_REGION");
    expect(status.tables).toContain("crawls");
    expect(status.tables).toContain("pages");
  });

  it("reports artifact storage status without touching S3", async () => {
    const result = await runCli(["storage", "artifacts", "status"], {
      HASNA_CRAWL_S3_BUCKET: "crawl-artifacts",
      HASNA_CRAWL_S3_PREFIX: "crawl/dev",
      HASNA_CRAWL_AWS_REGION: "us-east-1",
    });
    const status = JSON.parse(result.stdout) as {
      configured: boolean;
      bucket: string;
      prefix: string;
      region: string;
    };

    expect(result.exitCode).toBe(0);
    expect(status).toMatchObject({
      configured: true,
      bucket: "crawl-artifacts",
      prefix: "crawl/dev",
      region: "us-east-1",
    });
  });
});
