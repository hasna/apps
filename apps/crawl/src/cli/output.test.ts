import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const repoRoot = join(import.meta.dir, "../..");
const dbPaths: string[] = [];

async function resetDb() {
  const { closeDb } = await import("../db/database.js");
  closeDb();
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return await new Response(stream).text();
}

async function runCli(args: string[], dbPath: string) {
  const env = { ...process.env };
  env["CRAWL_DB_PATH"] = dbPath;
  env["HASNA_CRAWL_DB_PATH"] = dbPath;
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env,
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

async function createDbPath(prefix: string) {
  const dbPath = `/tmp/test-crawl-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  dbPaths.push(dbPath);
  process.env["CRAWL_DB_PATH"] = dbPath;
  process.env["HASNA_CRAWL_DB_PATH"] = dbPath;
  await resetDb();
  return dbPath;
}

afterEach(async () => {
  await resetDb();
  for (const dbPath of dbPaths.splice(0)) {
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  }
  delete process.env["CRAWL_DB_PATH"];
  delete process.env["HASNA_CRAWL_DB_PATH"];
});

describe("CLI compact output", () => {
  it("previews page content by default and keeps full/json detail paths", async () => {
    const dbPath = await createDbPath("cli-get");
    const { createCrawl } = await import("../db/crawls.js");
    const { createPage } = await import("../db/pages.js");
    const crawl = createCrawl({ url: "https://example.com" });
    const longBody = `# Compact output\n${"body ".repeat(220)}TAIL_MARKER`;
    const page = createPage({
      crawlId: crawl.id,
      url: "https://example.com/long",
      statusCode: 200,
      title: "Long body",
      textContent: longBody,
      markdownContent: longBody,
      wordCount: 222,
      byteSize: longBody.length,
    });
    await resetDb();

    const compact = await runCli(["get", page.id], dbPath);
    expect(compact.exitCode).toBe(0);
    expect(compact.stdout).not.toContain("TAIL_MARKER");
    expect(compact.stderr).toContain("Preview truncated");
    expect(compact.stderr).toContain("--full");
    expect(compact.stdout.length).toBeLessThan(700);

    const full = await runCli(["get", page.id, "--full"], dbPath);
    expect(full.exitCode).toBe(0);
    expect(full.stdout).toContain("TAIL_MARKER");

    const json = await runCli(["get", page.id, "--json"], dbPath);
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout) as { markdownContent: string };
    expect(parsed.markdownContent).toContain("TAIL_MARKER");
  });

  it("caps human list output but preserves the default json list window", async () => {
    const dbPath = await createDbPath("cli-list");
    const { createCrawl } = await import("../db/crawls.js");
    for (let i = 0; i < 60; i += 1) {
      createCrawl({ url: `https://example.com/${i}` });
    }
    await resetDb();

    const compact = await runCli(["list"], dbPath);
    expect(compact.exitCode).toBe(0);
    expect(compact.stderr).toContain("20+ crawl job");
    expect(compact.stderr).toContain("use --limit");
    expect((compact.stderr.match(/https:\/\/example\.com\//g) ?? []).length).toBe(20);

    const json = await runCli(["list", "--json"], dbPath);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toHaveLength(50);

    const jsonWithLimit = await runCli(["list", "--json", "--limit", "60"], dbPath);
    expect(jsonWithLimit.exitCode).toBe(0);
    expect(JSON.parse(jsonWithLimit.stdout)).toHaveLength(60);
  });

  it("redacts webhook secrets and delivery bodies from default json output", async () => {
    const dbPath = await createDbPath("cli-webhooks");
    const add = await runCli([
      "webhook",
      "add",
      "https://example.com/webhook",
      "--secret",
      "top-secret",
      "--json",
    ], dbPath);
    expect(add.exitCode).toBe(0);
    const added = JSON.parse(add.stdout) as { id: string; hasSecret: boolean; secret?: string };
    expect(added.hasSecret).toBe(true);
    expect(added.secret).toBeUndefined();

    const { createDelivery } = await import("../db/webhooks.js");
    createDelivery({
      webhookId: added.id,
      event: "crawl.completed",
      payload: JSON.stringify({ token: "payload-secret" }),
    });
    await resetDb();

    const list = await runCli(["webhook", "list", "--json"], dbPath);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).not.toContain("top-secret");
    expect(JSON.parse(list.stdout)[0].hasSecret).toBe(true);

    const deliveries = await runCli(["webhook", "deliveries", added.id, "--json"], dbPath);
    expect(deliveries.exitCode).toBe(0);
    expect(deliveries.stdout).not.toContain("payload-secret");
    expect(JSON.parse(deliveries.stdout)[0].payload).toBeUndefined();

    const fullDeliveries = await runCli(["webhook", "deliveries", added.id, "--json", "--include-payloads"], dbPath);
    expect(fullDeliveries.exitCode).toBe(0);
    expect(fullDeliveries.stdout).toContain("payload-secret");
  });
});
