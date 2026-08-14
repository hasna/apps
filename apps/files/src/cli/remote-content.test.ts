import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
const PRIVATE_BYTES = Buffer.from("PRIVATE_REMOTE_BYTES_7004\n", "utf8");
const PRIVATE_TEXT = "PRIVATE_REMOTE_TEXT_7004";
const API_KEY = "fixture-files-read-key";

let testDir: string;
let server: ReturnType<typeof Bun.serve>;
let requests: Array<{ method: string; path: string }>;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-remote-content-cli-"));
  requests = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      requests.push({ method: req.method, path: url.pathname });
      if (req.headers.get("x-api-key") !== API_KEY) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (req.method === "GET" && url.pathname === "/v1/files/f_remote/content") {
        return new Response(PRIVATE_BYTES, {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(PRIVATE_BYTES.byteLength),
          },
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/files/f_remote/extract-text") {
        return Response.json({
          source_ref: "open-files://file/f_remote/revision/rev_remote",
          file_id: "f_remote",
          revision_id: "rev_remote",
          status: "ready",
          mime: "text/plain",
          encoding: "utf-8",
          bytes_read: PRIVATE_BYTES.byteLength,
          total_size: PRIVATE_BYTES.byteLength,
          truncated: false,
          redacted: false,
          segments: [{
            index: 0,
            text: PRIVATE_TEXT,
            byte_start: 0,
            byte_end: PRIVATE_BYTES.byteLength,
            char_start: 0,
            char_end: PRIVATE_TEXT.length,
            line_start: 1,
            line_end: 1,
          }],
          metadata: {
            extractor: "open-files-text-v1",
            max_bytes: 1048576,
            max_segment_chars: 4000,
            supported_mime: true,
          },
        });
      }
      return Response.json({ error: "File not found" }, { status: 404 });
    },
  });
});

afterEach(() => {
  server.stop(true);
  rmSync(testDir, { recursive: true, force: true });
});

describe("hosted remote content CLI", () => {
  test("downloads exact bytes to a new owner-only destination without printing content", async () => {
    const destination = join(testDir, "download.bin");

    const result = await runCli(["download", "f_remote", destination]);

    expect(result.exitCode).toBe(0);
    expect(readFileSync(destination)).toEqual(PRIVATE_BYTES);
    expect(lstatSync(destination).mode & 0o777).toBe(0o600);
    expect(requests).toEqual([{ method: "GET", path: "/v1/files/f_remote/content" }]);
    expect(result.stdout).not.toContain(PRIVATE_BYTES.toString("utf8").trim());
    expect(result.stderr).not.toContain(PRIVATE_BYTES.toString("utf8").trim());
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/s3:\/\/|object[_ -]?key|bucket/i);
  });

  test("writes derived extraction to a new owner-only output file without echoing private text or metadata", async () => {
    const outputFile = join(testDir, "extraction-json.json");
    const humanOutputFile = join(testDir, "extraction-human.json");

    const result = await runCli([
      "extract-text",
      "f_remote",
      "--output-file",
      outputFile,
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const extraction = JSON.parse(readFileSync(outputFile, "utf8")) as {
      source_ref: string;
      segments: Array<{ text: string }>;
    };
    expect(extraction.source_ref).toBe("open-files://file/f_remote/revision/rev_remote");
    expect(extraction.segments[0]?.text).toBe(PRIVATE_TEXT);
    expect(lstatSync(outputFile).mode & 0o777).toBe(0o600);
    expect(requests).toEqual([{ method: "POST", path: "/v1/files/f_remote/extract-text" }]);
    expect(result.stdout).not.toContain(PRIVATE_TEXT);
    expect(result.stderr).not.toContain(PRIVATE_TEXT);
    expect(result.stdout).not.toContain(extraction.source_ref);
    expect(result.stderr).not.toContain(extraction.source_ref);

    const humanResult = await runCli([
      "extract-text",
      "f_remote",
      "--output-file",
      humanOutputFile,
    ]);
    expect(humanResult.exitCode).toBe(0);
    const humanExtraction = JSON.parse(readFileSync(humanOutputFile, "utf8")) as {
      source_ref: string;
      segments: Array<{ text: string }>;
    };
    expect(humanExtraction.segments[0]?.text).toBe(PRIVATE_TEXT);
    expect(lstatSync(humanOutputFile).mode & 0o777).toBe(0o600);
    expect(`${humanResult.stdout}\n${humanResult.stderr}`).not.toContain(PRIVATE_TEXT);
    expect(`${humanResult.stdout}\n${humanResult.stderr}`).not.toContain(humanExtraction.source_ref);
    expect(requests).toEqual([
      { method: "POST", path: "/v1/files/f_remote/extract-text" },
      { method: "POST", path: "/v1/files/f_remote/extract-text" },
    ]);
  });

  test("rejects collisions, symlinks, symlinked parents, and stdout output before requesting private bytes", async () => {
    const collision = join(testDir, "collision.bin");
    writeFileSync(collision, "keep");

    const symlinkTarget = join(testDir, "symlink-target.bin");
    const symlinkDestination = join(testDir, "symlink.bin");
    writeFileSync(symlinkTarget, "keep-target");
    symlinkSync(symlinkTarget, symlinkDestination);

    const actualParent = join(testDir, "actual-parent");
    const linkedParent = join(testDir, "linked-parent");
    mkdirSync(actualParent);
    symlinkSync(actualParent, linkedParent);

    const cases = [
      ["download", "f_remote", collision],
      ["download", "f_remote", symlinkDestination],
      ["download", "f_remote", join(linkedParent, "nested.bin")],
      ["extract-text", "f_remote", "--output-file", "-", "--json"],
    ];

    for (const args of cases) {
      const before = requests.length;
      const result = await runCli(args);
      expect(result.exitCode).toBe(1);
      expect(requests).toHaveLength(before);
    }

    expect(readFileSync(collision, "utf8")).toBe("keep");
    expect(readFileSync(symlinkTarget, "utf8")).toBe("keep-target");
  });

  test("removes a newly-created destination when the authorized server reports a missing file", async () => {
    const destination = join(testDir, "missing.bin");

    const result = await runCli(["download", "f_missing", destination]);

    expect(result.exitCode).toBe(1);
    expect(() => lstatSync(destination)).toThrow();
    expect(requests).toEqual([{ method: "GET", path: "/v1/files/f_missing/content" }]);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(PRIVATE_TEXT);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(PRIVATE_BYTES.toString("utf8").trim());
  });
});

async function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", cliPath, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HASNA_FILES_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_FILES_API_KEY: API_KEY,
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
