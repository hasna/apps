import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

/**
 * The regression the unit tests in `src/lib/stdout.test.ts` cannot prove: that
 * the *CLI process* does not lose its tail when stdout is a pipe.
 *
 * Measured on the unfixed 0.5.9 binary, five consecutive trials of the same
 * command in the same minute against a 1,149,610-byte channel index:
 *
 *     conversations channel list -j > file             -> 1149610 bytes, rc=0
 *     bash -c 'set -o pipefail; … channel list -j|cat' ->   98304 bytes, rc=0
 *                                                           65536 bytes, rc=0
 *                                                           98304 bytes, rc=0
 *                                                           65536 bytes, rc=0
 *                                                           98304 bytes, rc=0
 *
 * One or two pipe buffers, reported as success. It only reproduces against the
 * real binary through a real pipe, because whether the queued flush survives
 * depends on how much work the process did before writing.
 *
 * `Bun.spawnSync({ stdout: "pipe" })` — the flavour every existing CLI-spawning
 * test in this repo uses — is structurally blind to this class and delivers the
 * whole document even against the unfixed build. A test written the convenient
 * way here would pass against the bug. Hence the real shell pipeline below.
 */
describe("conversations --json over a pipe", () => {
  // Enough rows that the document is an order of magnitude past a 65536-byte
  // pipe buffer, so a truncation cannot hide inside one.
  const CHANNEL_ROWS = 400;
  const PIPE_TRIALS = 5;
  const PIPE_BUFFER_BYTES = 65536;
  // Each measurement cold-starts the TypeScript CLI in a subprocess (~1s), and
  // the byte-equality test does PIPE_TRIALS + 1 of them.
  const SPAWN_TIMEOUT_MS = 180_000;
  const BIG_CHANNEL = "fixture-channel-0000";
  const BIG_MESSAGES = 5;

  /**
   * Build a frozen fixture store.
   *
   * It has to be frozen: measuring against the operator's live store on this
   * fleet produced two full-length but non-identical documents, because other
   * agents post between the two runs and `message_count` moves. A byte-equality
   * assertion needs an index that nothing else is writing to.
   */
  function seedStore(): { dir: string; dbPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "conversations-json-pipe-"));
    const dbPath = join(dir, "conversations.db");
    // Let the CLI create and migrate the schema, so the fixture cannot drift
    // from the real one.
    const boot = Bun.spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "channel", "list", "-j"],
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(dbPath),
    });
    expect(boot.exitCode).toBe(0);

    const db = new Database(dbPath);
    const insert = db.prepare(
      "INSERT INTO channels (name, description, topic, project_id, created_by, metadata, tags) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    for (let i = 0; i < CHANNEL_ROWS; i++) {
      insert.run(
        `fixture-channel-${String(i).padStart(4, "0")}`,
        `d`.repeat(200),
        `t`.repeat(120),
        null,
        "agent:fixture",
        JSON.stringify({ channel_schema: { class: "fixture" } }),
        JSON.stringify(["fixture"]),
      );
    }
    const insertMessage = db.prepare(
      "INSERT INTO messages (session_id, from_agent, to_agent, channel, content) VALUES (?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < BIG_MESSAGES; i++) {
      // One unbounded body per message: this is what an agent posting an
      // evidence dump looks like, and it is the plain-text surface that can
      // exceed a pipe buffer in a single write.
      insertMessage.run("sess-fixture", "agent:fixture", "channel", BIG_CHANNEL, `body-${i} ` + "m".repeat(120_000));
    }
    db.exec("COMMIT");
    db.close();
    return { dir, dbPath };
  }

  function cliEnv(dbPath: string): Record<string, string | undefined> {
    return {
      ...process.env,
      HASNA_CONVERSATIONS_DB_PATH: dbPath,
      // The mere presence of an API pointer flips the client out of the local
      // SQLite store, which would make this measure the wrong process.
      HASNA_CONVERSATIONS_API_URL: undefined,
      HASNA_CONVERSATIONS_API_KEY: undefined,
      CONVERSATIONS_DB_PATH: undefined,
      // chalk would otherwise colour by inherited TTY state, differing between
      // the file run and the pipe run and defeating byte equality.
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    };
  }

  /**
   * `bash`, explicitly, and never `sh`.
   *
   * `/bin/sh` is dash on Debian and Ubuntu, and dash has no `set -o pipefail` —
   * it answers `set: Illegal option -o pipefail` at rc=2 and runs nothing, so a
   * pipe test that quietly degrades to dash measures nothing at all. `pipefail`
   * is the point of using a shell here: without it the pipeline reports `cat`'s
   * status, so a producer that died mid-document would still read as success —
   * the exact class of lie this file exists to catch.
   */
  function pipeline(script: string, dbPath: string) {
    return Bun.spawnSync({
      cmd: ["bash", "-c", `set -o pipefail; ${script}`],
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(dbPath),
    });
  }

  const LIST_JSON = "bun run src/cli/index.tsx channel list -j";

  let fixture: { dir: string; dbPath: string };
  beforeAll(() => {
    fixture = seedStore();
  });
  afterAll(() => {
    if (fixture) rmSync(fixture.dir, { recursive: true, force: true });
  });

  test("channel list -j delivers byte-for-byte the same document through a pipe as to a file", () => {
    const { dir, dbPath } = fixture;
    {
      const outFile = join(dir, "redirected.json");
      const redirected = pipeline(`${LIST_JSON} > ${JSON.stringify(outFile)}`, dbPath);
      expect(redirected.exitCode).toBe(0);
      const expected = readFileSync(outFile);

      // Guard the guard: if the fixture produced a document that fits in one
      // pipe buffer, every comparison below would pass vacuously — the defect
      // only manifests past the buffer. This is the positive-control side of
      // the assertion: the input must be capable of producing the failure.
      expect(expected.byteLength).toBeGreaterThan(PIPE_BUFFER_BYTES * 4);

      for (let trial = 0; trial < PIPE_TRIALS; trial++) {
        const piped = pipeline(`${LIST_JSON} | cat`, dbPath);
        // With pipefail this is the *producer's* status, not `cat`'s.
        expect(piped.exitCode).toBe(0);
        // Measure BYTES. `String.length` counts UTF-16 code units, and 65536 is
        // a byte boundary — a pipe buffer. On multi-byte content the two
        // diverge in the direction that hides truncation.
        expect({ trial, bytes: piped.stdout.byteLength }).toEqual({
          trial,
          bytes: expected.byteLength,
        });
        expect(Buffer.compare(Buffer.from(piped.stdout), expected)).toBe(0);
      }

      // Parse as well as size it, so a *valid* short answer would still fail.
      const parsed = JSON.parse(expected.toString("utf8")) as unknown[];
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(CHANNEL_ROWS);
    }
  }, SPAWN_TIMEOUT_MS);

  test("human-readable output is not truncated through a pipe either", () => {
    // `channel read <name>` returns rc=0 and "No messages in #<name>." for a
    // channel that does NOT exist, identically to one that exists and is empty,
    // so an operator reading channels in plain text is exactly as exposed as
    // one parsing JSON. `channel list`'s human form is row-capped at
    // MAX_COMPACT_LIMIT and cannot itself overflow a pipe buffer, but message
    // BODIES are unbounded — agents post evidence dumps — and `--verbose`
    // prints them whole. That is the plain-text surface that can overflow, so
    // that is the one measured.
    const { dir, dbPath } = fixture;
    const read = `bun run src/cli/index.tsx channel read ${BIG_CHANNEL} --verbose --limit 5`;
    {
      const outFile = join(dir, "redirected.txt");
      const redirected = pipeline(`${read} > ${JSON.stringify(outFile)}`, dbPath);
      expect(redirected.exitCode).toBe(0);
      const expected = readFileSync(outFile);
      // Positive control on the input: below one pipe buffer this proves nothing.
      expect(expected.byteLength).toBeGreaterThan(PIPE_BUFFER_BYTES * 4);

      const piped = pipeline(`${read} | cat`, dbPath);
      expect(piped.exitCode).toBe(0);
      expect(piped.stdout.byteLength).toBe(expected.byteLength);
      expect(Buffer.compare(Buffer.from(piped.stdout), expected)).toBe(0);
    }
  }, SPAWN_TIMEOUT_MS);

  test("ends cleanly when the reader closes the pipe, without an unhandled EPIPE", () => {
    // The reader-closed path is otherwise only exercised against an injected
    // SyncWriter. Deleting the EPIPE branch from writeAllSync would regress
    // silently: writeSync would throw, Bun would print an uncaught EPIPE and a
    // stack, and `conversations channel list -j | head` — an ordinary shell
    // pipeline — would become a crash.
    //
    // A closed reader means a SHORT document is the CORRECT outcome here; that
    // is the difference from the tests above, where the pipe stays open and
    // short is the defect. Both a clean stop and a deliberate non-zero producer
    // exit satisfy the contract, so the exit code itself is not asserted — what
    // is asserted is that the process terminated, emitted no unhandled failure,
    // and still produced the beginning of the real document.
    const { dbPath } = fixture;
    {
      const result = pipeline(`${LIST_JSON} | head -1`, dbPath);
      // A hang is caught by the suite timeout; this asserts it exited rather
      // than being left for the runner to reap.
      expect(result.exitCode).not.toBeNull();
      const stderr = result.stderr.toString();
      expect(stderr).not.toContain("EPIPE");
      expect(stderr).not.toContain("ERR_STREAM_DESTROYED");
      // printJson pretty-prints, so the first line of a channel list is the
      // array opening. Getting it proves the producer wrote before the reader
      // left, rather than dying on startup and passing by writing nothing.
      expect(new TextDecoder().decode(result.stdout).trim()).toBe("[");
    }
  }, SPAWN_TIMEOUT_MS);
});

/**
 * A writer module does nothing for a call site that bypasses it.
 *
 * In hasna/repos the identical defect was fixed by routing every `--json`
 * surface through a completing writer, and came straight back on a *new*
 * surface added later with a fresh `console.log(JSON.stringify(...))`. No
 * amount of care at review time substitutes for a check that fails, so this
 * guard makes reintroducing the bypass a red test rather than a defect
 * discovered later by whatever consumed the truncated output.
 *
 * The rule is broader than JSON: `channel list` without `-j` is 145 KiB of
 * plain text and is equally a pipe-buffer overflow, so the guard bans
 * `console.log` and `console.error` outright under `src/cli/`.
 */
describe("no CLI surface bypasses the completing writer", () => {
  const CLI_ROOT = import.meta.dir;
  const BYPASS = /\bconsole\.(log|error)\s*\(/;

  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        sourceFiles(full, found);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
    return found;
  }

  test("no console.log or console.error remains anywhere under src/cli/", () => {
    const files = sourceFiles(CLI_ROOT);
    // Guard the guard: if the walk finds nothing, an empty offender list would
    // pass vacuously.
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (BYPASS.test(line)) offenders.push(`${relative(CLI_ROOT, file)}:${i + 1}`);
      });
    }
    // Named in the failure so the fix is obvious: replace it with printLine /
    // printErrorLine / printJson / printJsonLine from src/lib/stdout.ts.
    expect(offenders).toEqual([]);
  });
});
