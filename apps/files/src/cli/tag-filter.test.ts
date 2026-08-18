import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
const MATCHING_TAG = "project:company-taxes";
const ABSENT_TAGS = ["project:monthly-filing", "project:ro-accounting"] as const;
const MEMBER_ID = "f_cli_tag_member";
const NON_MEMBER_ID = "f_cli_tag_non_member";
const API_KEY = "[REDACTED_SECRET]";

let testDir: string | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(async () => {
  server?.stop(true);
  server = undefined;
  const { closeDb } = await import("../db/database.js");
  closeDb();
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("files list --tag", () => {
  test("local CLI composes source and tag filters with known-negative controls", async () => {
    testDir = mkdtempSync(join(tmpdir(), "files-cli-tag-local-"));
    const sourceId = await seedLocalFiles(testDir);

    const matching = await runCli([
      "list",
      "--source",
      sourceId,
      "--tag",
      MATCHING_TAG,
      "--json",
    ], localEnv(testDir));
    expect(matching.exitCode).toBe(0);
    expect(parseIds(matching.stdout)).toEqual([MEMBER_ID]);

    for (const tag of ABSENT_TAGS) {
      const negative = await runCli([
        "list",
        "--source",
        sourceId,
        "--tag",
        tag,
        "--json",
      ], localEnv(testDir));
      expect(negative.exitCode).toBe(0);
      expect(parseIds(negative.stdout)).toEqual([]);
    }
  });

  test("API CLI composes the exact source and tag instead of returning a plausible unrelated row", async () => {
    testDir = mkdtempSync(join(tmpdir(), "files-cli-tag-api-"));
    const member = syntheticFile(MEMBER_ID, [MATCHING_TAG]);
    const unrelated = syntheticFile(NON_MEMBER_ID, ["zz"]);
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (req.headers.get("x-api-key") !== API_KEY) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const sourceId = url.searchParams.get("source_id");
        const tag = url.searchParams.get("tag");
        if (sourceId === "src_cli_tag" && tag === MATCHING_TAG) return Response.json({ items: [member] });
        if (
          sourceId === "src_cli_tag"
          && ABSENT_TAGS.includes(tag as typeof ABSENT_TAGS[number])
        ) {
          return Response.json({ items: [] });
        }
        return Response.json({ items: [unrelated] });
      },
    });

    const env = {
      ...localEnv(testDir),
      HASNA_FILES_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_FILES_API_KEY: API_KEY,
    };
    const matching = await runCli([
      "list",
      "--source",
      "src_cli_tag",
      "--tag",
      MATCHING_TAG,
      "--json",
    ], env);
    expect(matching.exitCode).toBe(0);
    expect(parseIds(matching.stdout)).toEqual([MEMBER_ID]);

    for (const tag of ABSENT_TAGS) {
      const negative = await runCli([
        "list",
        "--source",
        "src_cli_tag",
        "--tag",
        tag,
        "--json",
      ], env);
      expect(negative.exitCode).toBe(0);
      expect(parseIds(negative.stdout)).toEqual([]);
    }
  });
});

async function seedLocalFiles(root: string): Promise<string> {
  process.env.HASNA_FILES_DATA_DIR = root;
  process.env.HASNA_FILES_DB_PATH = join(root, "files.db");
  const { closeDb } = await import("../db/database.js");
  const { getCurrentMachine } = await import("../db/machines.js");
  const { createSource } = await import("../db/sources.js");
  const { upsertFile } = await import("../db/files.js");
  const { tagFile } = await import("../db/tags.js");
  const machine = getCurrentMachine();
  const source = createSource({
    name: "Synthetic CLI tag source",
    type: "local",
    path: root,
    machine_id: machine.id,
  });
  upsertFile({
    id: MEMBER_ID,
    source_id: source.id,
    machine_id: machine.id,
    path: "member.txt",
    name: "member.txt",
    ext: ".txt",
    size: 1,
    mime: "text/plain",
    status: "active",
  });
  upsertFile({
    id: NON_MEMBER_ID,
    source_id: source.id,
    machine_id: machine.id,
    path: "unrelated.txt",
    name: "unrelated.txt",
    ext: ".txt",
    size: 1,
    mime: "text/plain",
    status: "active",
  });
  tagFile(MEMBER_ID, MATCHING_TAG);
  tagFile(NON_MEMBER_ID, "zz");
  closeDb();
  return source.id;
}

function syntheticFile(id: string, tags: string[]) {
  return {
    id,
    source_id: "src_cli_tag",
    machine_id: "m_cli_tag",
    path: `${id}.txt`,
    name: `${id}.txt`,
    ext: ".txt",
    size: 1,
    mime: "text/plain",
    status: "active",
    indexed_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    tags,
  };
}

function localEnv(root: string): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.HASNA_FILES_API_URL;
  delete env.HASNA_FILES_API_KEY;
  env.HASNA_FILES_DATA_DIR = root;
  env.HASNA_FILES_DB_PATH = join(root, "files.db");
  return env;
}

async function runCli(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", cliPath, ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function parseIds(stdout: string): string[] {
  return (JSON.parse(stdout) as Array<{ id: string }>).map((file) => file.id);
}
