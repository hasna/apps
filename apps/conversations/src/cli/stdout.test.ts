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
import { writeAllSync, type SyncWriter } from "./stdout.js";

function recordingWriter(
  policy: (chunk: Uint8Array, call: number) => number | Error,
) {
  const chunks: Uint8Array[] = [];
  let calls = 0;
  const writer: SyncWriter = (chunk) => {
    const outcome = policy(chunk, calls++);
    if (outcome instanceof Error) throw outcome;
    chunks.push(chunk.slice(0, outcome));
    return outcome;
  };
  return {
    writer,
    get calls() {
      return calls;
    },
    text() {
      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    },
  };
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("writeAllSync", () => {
  test("continues after partial writes", () => {
    const payload = "abcdefghij".repeat(500);
    const sink = recordingWriter((chunk) => Math.min(chunk.length, 97));

    expect(writeAllSync(payload, sink.writer)).toBe("complete");
    expect(sink.text()).toBe(payload);
    expect(sink.calls).toBeGreaterThan(1);
  });

  test("retries EAGAIN back-pressure", () => {
    let blocked = true;
    const sink = recordingWriter((chunk) => {
      if (blocked) {
        blocked = false;
        return errno("EAGAIN");
      }
      return chunk.length;
    });

    expect(writeAllSync("payload", sink.writer)).toBe("complete");
    expect(sink.text()).toBe("payload");
  });

  test("stops quietly when the reader closes the pipe", () => {
    const sink = recordingWriter((chunk, call) =>
      call === 0 ? Math.min(chunk.length, 4) : errno("EPIPE"),
    );

    expect(writeAllSync("payload", sink.writer)).toBe("reader-closed");
    expect(sink.text()).toBe("payl");
  });
});

describe("channel list --json stdout delivery", () => {
  const CHANNEL_ROWS = 1_500;
  const cliEntry = join(import.meta.dir, "index.tsx");

  function seedChannels(): { dir: string; dbPath: string; expectedPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "conversations-json-pipe-"));
    const dbPath = join(dir, "messages.db");
    const expectedPath = join(dir, "redirected.json");
    const env = { ...process.env, HASNA_CONVERSATIONS_DB_PATH: dbPath };
    const boot = Bun.spawnSync({
      cmd: ["bun", "run", cliEntry, "channel", "list", "--json"],
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    expect(boot.exitCode).toBe(0);

    const db = new Database(dbPath);
    const insert = db.prepare(
      "INSERT INTO channels (name, description, topic, created_by) VALUES (?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    for (let i = 0; i < CHANNEL_ROWS; i++) {
      insert.run(
        `fixture-channel-${i.toString().padStart(4, "0")}`,
        `description-${i}-` + "d".repeat(700),
        `topic-${i}`,
        "stdout-regression",
      );
    }
    db.exec("COMMIT");
    db.close();

    return { dir, dbPath, expectedPath };
  }

  function bash(script: string, dbPath: string, expectedPath: string) {
    return Bun.spawnSync({
      cmd: ["bash", "-c", `set -o pipefail\n${script}`],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HASNA_CONVERSATIONS_DB_PATH: dbPath,
        CONVERSATIONS_CLI_ENTRY: cliEntry,
        EXPECTED_OUTPUT: expectedPath,
      },
    });
  }

  test("matches redirected output byte-for-byte through a real shell pipeline", () => {
    const { dir, dbPath, expectedPath } = seedChannels();
    try {
      const redirected = bash(
        'bun run "$CONVERSATIONS_CLI_ENTRY" channel list --json > "$EXPECTED_OUTPUT"',
        dbPath,
        expectedPath,
      );
      expect(redirected.exitCode).toBe(0);
      expect(redirected.stderr.toString()).toBe("");

      const piped = bash(
        'bun run "$CONVERSATIONS_CLI_ENTRY" channel list --json | cat',
        dbPath,
        expectedPath,
      );
      expect(piped.exitCode).toBe(0);
      expect(piped.stderr.toString()).toBe("");

      const expected = readFileSync(expectedPath);
      expect(expected.byteLength).toBeGreaterThan(1_000_000);
      expect(piped.stdout.byteLength).toBe(expected.byteLength);
      expect(Buffer.from(piped.stdout).equals(expected)).toBe(true);
      expect(JSON.parse(expected.toString())).toHaveLength(CHANNEL_ROWS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test("does not raise EPIPE when a pipeline reader exits early", () => {
    const { dir, dbPath, expectedPath } = seedChannels();
    try {
      const result = bash(
        'bun run "$CONVERSATIONS_CLI_ENTRY" channel list --json | head -1',
        dbPath,
        expectedPath,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).not.toContain("EPIPE");
      expect(new TextDecoder().decode(result.stdout).trim()).toBe("[");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("JSON stdout call sites", () => {
  const cliRoot = import.meta.dir;

  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        sourceFiles(path, found);
      } else if (/\.tsx?$/.test(entry.name) && path !== import.meta.path) {
        found.push(path);
      }
    }
    return found;
  }

  test("none bypass the completing writer with console.log", () => {
    const offenders = sourceFiles(cliRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return /console\.log\s*\(\s*JSON\.stringify/.test(source)
        ? [relative(cliRoot, file)]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
