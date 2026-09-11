/**
 * Hosted-path tests for the knowledge/extraction CLI commands ported to `/v1`
 * (W13 PORT-TO-API slice A).
 *
 * `files knowledge resolve`, `files knowledge doctor` and
 * `files extract-snapshot` used to be `requireLocalTransport`-only: on a
 * hosted credential they refused, and the only way to run them was the local
 * SQLite island. Each one's underlying operation already had a `/v1` route, so
 * they now compose those routes instead.
 *
 * Each test drives the real CLI binary against a fake `/v1` server with a
 * hosted credential and asserts (a) the request actually hit the versioned
 * route and (b) no `*.db*` file appeared under the run's HOME — the hosted arm
 * must never open the local island.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(import.meta.dir, "index.tsx");
const SERVER_EXPECTED_AUTH = "fixture-files-knowledge-key";
const HOSTED_TEXT = "hosted knowledge line one\nhosted knowledge line two\n";

const HOSTED_FILE = {
  id: "f_know1",
  source_id: "src_know",
  machine_id: "m_1",
  path: "docs/notes.md",
  name: "notes.md",
  ext: ".md",
  size: HOSTED_TEXT.length,
  mime: "text/markdown",
  hash: "sha256:deadbeef",
  status: "active",
  indexed_at: "2026-09-11T00:00:00.000Z",
  created_at: "2026-09-11T00:00:00.000Z",
  modified_at: "2026-09-11T00:00:00.000Z",
  tags: [],
};

const HOSTED_EXTRACT = {
  source_ref: "open-files://file/f_know1",
  file_id: "f_know1",
  status: "ready",
  mime: "text/markdown",
  encoding: "utf-8",
  bytes_read: HOSTED_TEXT.length,
  total_size: HOSTED_TEXT.length,
  truncated: false,
  redacted: false,
  segments: [
    {
      index: 0,
      text: "hosted knowledge line one",
      byte_start: 0,
      byte_end: 25,
      char_start: 0,
      char_end: 25,
      line_start: 1,
      line_end: 1,
    },
    {
      index: 1,
      text: "hosted knowledge line two",
      byte_start: 26,
      byte_end: 51,
      char_start: 26,
      char_end: 51,
      line_start: 2,
      line_end: 2,
    },
  ],
  metadata: {
    extractor: "hosted-extractor-v1",
    max_bytes: 262144,
    max_segment_chars: 4000,
    supported_mime: true,
  },
};

let testDir: string;
let server: ReturnType<typeof Bun.serve>;
let hits: string[];

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-knowledge-hosted-cli-"));
  hits = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/v1/, "") || "/";
      hits.push(`${req.method} ${path}`);
      if (req.headers.get("x-api-key") !== SERVER_EXPECTED_AUTH) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (req.method === "GET" && path === "/files") {
        return Response.json({ items: [HOSTED_FILE] });
      }
      if (req.method === "GET" && path === `/files/${HOSTED_FILE.id}`) {
        return Response.json(HOSTED_FILE);
      }
      if (req.method === "GET" && path === `/files/${HOSTED_FILE.id}/content`) {
        return new Response(HOSTED_TEXT, { headers: { "content-type": "text/markdown" } });
      }
      if (req.method === "POST" && path === `/files/${HOSTED_FILE.id}/extract-text`) {
        return Response.json(HOSTED_EXTRACT);
      }
      if (req.method === "POST" && path === `/files/${HOSTED_FILE.id}/sign-download`) {
        return Response.json({ url: "https://s3.example.test/presigned-f_know1" });
      }
      return Response.json({ error: `no route ${req.method} ${path}` }, { status: 404 });
    },
  });
});

afterEach(() => {
  server.stop(true);
  rmSync(testDir, { recursive: true, force: true });
});

describe("files knowledge resolve on the hosted transport", () => {
  test("metadata mode reads GET /v1/files/{id} and opens no local database", async () => {
    const result = await runCli(["knowledge", "resolve", "open-files://file/f_know1", "--json"]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      status: string; file_id: string; path: string;
      content: { text_available: boolean; extracted_text_ref?: string };
    };
    expect(payload.status).toBe("ready");
    expect(payload.file_id).toBe("f_know1");
    expect(payload.path).toBe("docs/notes.md");
    // Parity with the on-box resolver: text availability comes from mime +
    // filename, so metadata mode reports it without reading any bytes.
    expect(payload.content.text_available).toBe(true);
    expect(payload.content.extracted_text_ref).toBe("open-files://file/f_know1/text");
    expect(hits).toEqual(["GET /files/f_know1"]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  });

  test("content mode streams GET /v1/files/{id}/content", async () => {
    const result = await runCli([
      "knowledge", "resolve", "open-files://file/f_know1", "--mode", "content", "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { content: { text: string; text_available: boolean } };
    expect(payload.content.text).toBe(HOSTED_TEXT);
    expect(payload.content.text_available).toBe(true);
    expect(hits).toEqual(["GET /files/f_know1", "GET /files/f_know1/content"]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  });

  test("extracted_text mode posts to POST /v1/files/{id}/extract-text", async () => {
    const result = await runCli([
      "knowledge", "resolve", "open-files://file/f_know1", "--mode", "extracted_text", "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      extracted_text: { segments: Array<{ text: string }>; metadata: { extractor: string } };
    };
    expect(payload.status).toBe("ready");
    expect(payload.extracted_text.metadata.extractor).toBe("hosted-extractor-v1");
    expect(payload.extracted_text.segments[0]?.text).toBe("hosted knowledge line one");
    expect(hits).toEqual(["GET /files/f_know1", "POST /files/f_know1/extract-text"]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  });

  test("signed_url mode posts to POST /v1/files/{id}/sign-download", async () => {
    const result = await runCli([
      "knowledge", "resolve", "open-files://file/f_know1", "--mode", "signed_url", "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { access: { url: string; expires_at: string } };
    expect(payload.access.url).toBe("https://s3.example.test/presigned-f_know1");
    expect(Date.parse(payload.access.expires_at)).toBeGreaterThan(Date.now());
    expect(hits).toEqual(["GET /files/f_know1", "POST /files/f_know1/sign-download"]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  });

  test("a ref the hosted service does not know resolves not_found without a local lookup", async () => {
    const result = await runCli(["knowledge", "resolve", "open-files://file/f_absent", "--json"]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { status: string };
    expect(payload.status).toBe("not_found");
    expect(hits).toEqual(["GET /files/f_absent"]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  });
});

describe("files knowledge doctor on the hosted transport", () => {
  test("collects refs from GET /v1/files and reports each check", async () => {
    const result = await runCli(["knowledge", "doctor", "--json"]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      checked_count: number;
      summary: { ready: number };
      checks: Array<{ source_ref: string; status: string; content: { extraction_status?: string } }>;
    };
    expect(report.checked_count).toBe(1);
    expect(report.checks[0]?.source_ref).toBe("open-files://file/f_know1");
    expect(report.checks[0]?.status).toBe("ready");
    expect(report.summary.ready).toBe(1);
    // text_available is decided from mime + filename, so the default doctor
    // answers "extracted text present" without extracting anything.
    expect(hits).toEqual(["GET /files", "GET /files/f_know1"]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  });

  test("--check-extracted-text opts into POST /v1/files/{id}/extract-text", async () => {
    const result = await runCli([
      "knowledge", "doctor", "open-files://file/f_know1", "--check-extracted-text", "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      checks: Array<{ status: string; content: { extraction_status?: string } }>;
    };
    expect(report.checks[0]?.status).toBe("ready");
    expect(report.checks[0]?.content.extraction_status).toBe("ready");
    expect(hits).toEqual(["GET /files/f_know1", "POST /files/f_know1/extract-text"]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  });

  test("an explicit unknown ref is reported as not_found with a fix_ref recommendation", async () => {
    const result = await runCli(["knowledge", "doctor", "open-files://file/f_absent", "--json"]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      checks: Array<{ status: string; recommendation: string; issue_codes: string[] }>;
      summary: { not_found: number };
    };
    expect(report.checks[0]?.status).toBe("not_found");
    expect(report.checks[0]?.recommendation).toBe("fix_ref");
    expect(report.checks[0]?.issue_codes).toContain("not_found");
    expect(report.summary.not_found).toBe(1);
    expect(hits).toEqual(["GET /files/f_absent"]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  });
});

describe("files extract-snapshot on the hosted transport", () => {
  test("derives a deterministic snapshot from POST /v1/files/{id}/extract-text", async () => {
    const result = await runCli(["extract-snapshot", "f_know1", "--json"]);

    expect(result.exitCode).toBe(0);
    const snapshot = JSON.parse(result.stdout) as {
      snapshot_id: string;
      status: string;
      content_hash: string;
      sections: Array<{ text: string }>;
    };
    expect(snapshot.snapshot_id).toMatch(/^snap_/);
    expect(snapshot.status).toBe("ready");
    expect(snapshot.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.sections.length).toBeGreaterThan(0);
    expect(hits).toEqual(["POST /files/f_know1/extract-text"]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  });

  test("the snapshot id is deterministic across hosted runs", async () => {
    const first = await runCli(["extract-snapshot", "f_know1", "--json"]);
    const second = await runCli(["extract-snapshot", "f_know1", "--json"]);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    const firstId = (JSON.parse(first.stdout) as { snapshot_id: string }).snapshot_id;
    expect((JSON.parse(second.stdout) as { snapshot_id: string }).snapshot_id).toBe(firstId);
    expect(hits).toEqual([
      "POST /files/f_know1/extract-text",
      "POST /files/f_know1/extract-text",
    ]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  }, 15000);

  test("surfaces a hosted failure instead of falling back to the local island", async () => {
    const result = await runCli(["extract-snapshot", "f_absent", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(hits).toEqual(["POST /files/f_absent/extract-text"]);
    expect(databaseFilesUnder(testDir)).toEqual([]);
  });
});

/** Every `*.db*` file anywhere under `root` — the hosted arm must create none. */
function databaseFilesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.db(-wal|-shm|-journal)?$/.test(entry.name) && statSync(full).isFile()) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

async function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", cliPath, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: testDir,
      HASNA_HOME: testDir,
      HASNA_CONFIG_HOME: testDir,
      // A station account no Keychain item uses, so the ambient credential
      // tier cannot outrank the fake authority pinned below.
      HASNA_STATION: "files-hermetic-no-such-station",
      HASNA_FILES_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_FILES_API_KEY: SERVER_EXPECTED_AUTH,
      HASNA_FILES_DATA_DIR: testDir,
      HASNA_FILES_DB_PATH: join(testDir, "files.db"),
    },
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
