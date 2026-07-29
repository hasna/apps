import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  printJson,
  writeAllSync,
  type SyncWriter,
} from "./stdout.js";

function errorWithCode(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function recordingWriter(
  accept: (chunk: Uint8Array, call: number) => number | Error,
) {
  const chunks: Uint8Array[] = [];
  let calls = 0;
  const writer: SyncWriter = (chunk) => {
    const result = accept(chunk, calls++);
    if (result instanceof Error) throw result;
    chunks.push(chunk.slice(0, result));
    return result;
  };
  return {
    writer,
    text: () => Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
  };
}

describe("writeAllSync", () => {
  test("continues after partial writes", () => {
    const payload = "partial-write-".repeat(500);
    const sink = recordingWriter((chunk) => Math.min(chunk.length, 97));

    expect(writeAllSync(payload, sink.writer)).toBe("complete");
    expect(sink.text()).toBe(payload);
  });

  test("retries EAGAIN and zero-byte accepts", () => {
    const payload = "backpressure-".repeat(100);
    const sink = recordingWriter((chunk, call) => {
      if (call === 0) return errorWithCode("EAGAIN");
      if (call === 1) return 0;
      return Math.min(chunk.length, 41);
    });

    expect(writeAllSync(payload, sink.writer)).toBe("complete");
    expect(sink.text()).toBe(payload);
  });

  test("stops cleanly when a pipe reader closes", () => {
    const sink = recordingWriter((chunk, call) => (
      call === 0 ? Math.min(chunk.length, 12) : errorWithCode("EPIPE")
    ));

    expect(writeAllSync("x".repeat(100), sink.writer)).toBe("reader-closed");
    expect(sink.text()).toBe("x".repeat(12));
  });

  test("printJson emits a complete newline-terminated document", () => {
    const sink = recordingWriter((chunk) => chunk.length);
    printJson({ ok: true, values: [1, 2, 3] }, sink.writer);

    expect(sink.text().endsWith("\n")).toBe(true);
    expect(JSON.parse(sink.text())).toEqual({ ok: true, values: [1, 2, 3] });
  });
});

describe("channel list --json through a real pipeline", () => {
  test("is byte-for-byte identical to redirected-to-file output", () => {
    const dir = mkdtempSync(join(tmpdir(), "conversations-json-pipe-"));
    const dbPath = join(dir, "conversations.db");
    const directPath = join(dir, "direct.json");
    const pipedPath = join(dir, "piped.json");
    const env = {
      ...process.env,
      CONVERSATIONS_DB_PATH: dbPath,
      CONVERSATIONS_AGENT_ID: "json-pipe-test",
      DIRECT_OUTPUT: directPath,
      PIPED_OUTPUT: pipedPath,
      FORCE_COLOR: "0",
    };

    try {
      const boot = Bun.spawnSync({
        cmd: ["bun", "run", "./src/cli/index.tsx", "channel", "list", "--json"],
        cwd: process.cwd(),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(boot.exitCode).toBe(0);

      const db = new Database(dbPath);
      const insert = db.prepare(
        "INSERT INTO channels (name, description, created_by) VALUES (?, ?, ?)",
      );
      db.exec("BEGIN");
      for (let i = 0; i < 1_200; i++) {
        insert.run(
          `pipeline-fixture-${String(i).padStart(4, "0")}`,
          `channel ${i}: ${"large-json-payload-".repeat(32)}`,
          "json-pipe-test",
        );
      }
      db.exec("COMMIT");
      db.close();

      const shell = Bun.spawnSync({
        cmd: [
          "bash",
          "-c",
          [
            "set -o pipefail",
            "bun run ./src/cli/index.tsx channel list --json > \"$DIRECT_OUTPUT\"",
            "bun run ./src/cli/index.tsx channel list --json | cat > \"$PIPED_OUTPUT\"",
          ].join("\n"),
        ],
        cwd: process.cwd(),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(shell.exitCode).toBe(0);
      expect(new TextDecoder().decode(shell.stderr)).toBe("");

      const direct = readFileSync(directPath);
      const piped = readFileSync(pipedPath);
      expect(direct.byteLength).toBeGreaterThan(65_536);
      expect(piped.equals(direct)).toBe(true);
      expect(JSON.parse(piped.toString())).toHaveLength(1_200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("export JSON through a real pipeline", () => {
  test("is byte-for-byte identical to redirected-to-file output", () => {
    const dir = mkdtempSync(join(tmpdir(), "conversations-export-pipe-"));
    const dbPath = join(dir, "conversations.db");
    const directPath = join(dir, "direct.json");
    const pipedPath = join(dir, "piped.json");
    const env = {
      ...process.env,
      CONVERSATIONS_DB_PATH: dbPath,
      CONVERSATIONS_AGENT_ID: "export-pipe-test",
      DIRECT_OUTPUT: directPath,
      PIPED_OUTPUT: pipedPath,
      FORCE_COLOR: "0",
    };

    try {
      const boot = Bun.spawnSync({
        cmd: ["bun", "run", "./src/cli/index.tsx", "export"],
        cwd: process.cwd(),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(boot.exitCode).toBe(0);

      const db = new Database(dbPath);
      const insert = db.prepare(
        "INSERT INTO messages (session_id, from_agent, to_agent, content) VALUES (?, ?, ?, ?)",
      );
      db.exec("BEGIN");
      for (let i = 0; i < 1_200; i++) {
        insert.run(
          `export-session-${String(i).padStart(4, "0")}`,
          "export-pipe-test",
          "reader",
          `message ${i}: ${"large-json-payload-".repeat(32)}`,
        );
      }
      db.exec("COMMIT");
      db.close();

      const shell = Bun.spawnSync({
        cmd: [
          "bash",
          "-c",
          [
            "set -o pipefail",
            "bun run ./src/cli/index.tsx export > \"$DIRECT_OUTPUT\"",
            "bun run ./src/cli/index.tsx export | cat > \"$PIPED_OUTPUT\"",
          ].join("\n"),
        ],
        cwd: process.cwd(),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(shell.exitCode).toBe(0);
      expect(new TextDecoder().decode(shell.stderr)).toBe("");

      const direct = readFileSync(directPath);
      const piped = readFileSync(pipedPath);
      expect(direct.byteLength).toBeGreaterThan(65_536);
      expect(piped.equals(direct)).toBe(true);
      expect(JSON.parse(piped.toString())).toHaveLength(1_200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("CLI JSON output", () => {
  test("does not bypass the completing writer", () => {
    const root = import.meta.dir;
    const offenders: string[] = [];

    function inspect(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          inspect(path);
        } else if (/\.tsx?$/.test(entry.name) && path !== import.meta.path) {
          if (/console\.log\s*\(\s*JSON\.stringify/.test(readFileSync(path, "utf8"))) {
            offenders.push(relative(root, path));
          }
        }
      }
    }

    inspect(root);
    expect(offenders).toEqual([]);
  });
});
