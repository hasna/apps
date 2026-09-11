import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
let apiFixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { backfilledChannelIdForName } from "../lib/channel-id.js";

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
  async function seedStore(): Promise<{dir:string;authority:string}> {
    apiFixture=await startLoopbackApiFixture();
    await apiFixture.seed({channels:Array.from({length:CHANNEL_ROWS},(_,i)=> {
      const name=`fixture-channel-${String(i).padStart(4,"0")}`;
      return {id:backfilledChannelIdForName(name),name,description:"d".repeat(200),topic:"t".repeat(120),project_id:null,created_by:"agent:fixture",metadata:JSON.stringify({channel_schema:{class:"fixture"}}),tags:JSON.stringify(["fixture"]),created_at:"2026-01-01T00:00:00.000Z",archived_at:null};
    }),messages:Array.from({length:BIG_MESSAGES},(_,i)=>({session_id:"sess-fixture",from_agent:"agent:fixture",to_agent:"channel",channel:BIG_CHANNEL,content:`body-${i} `+"m".repeat(120000)}))});
    return {dir:apiFixture.root,authority:apiFixture.url};
  }
  function cliEnv(_authority:string):Record<string,string> { return {...apiFixture.env,CONVERSATIONS_AGENT_ID:"pipe-fixture"}; }

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
  function pipeline(script: string, authority: string) {
    return Bun.spawnSync({
      cmd: ["bash", "-c", `set -o pipefail; ${script}`],
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(authority),
    });
  }

  const LIST_JSON = "bun run src/cli/index.tsx channel list -j";

  let fixture: { dir: string; authority: string };
  beforeAll(async () => {
    fixture = await seedStore();
  });
  afterAll(async () => {
    await apiFixture?.stop();
  });

  test("channel list -j delivers byte-for-byte the same document through a pipe as to a file", () => {
    const { dir, authority } = fixture;
    {
      const outFile = join(dir, "redirected.json");
      const redirected = pipeline(`${LIST_JSON} > ${JSON.stringify(outFile)}`, authority);
      expect(redirected.exitCode).toBe(0);
      const expected = readFileSync(outFile);

      // Guard the guard: if the fixture produced a document that fits in one
      // pipe buffer, every comparison below would pass vacuously — the defect
      // only manifests past the buffer. This is the positive-control side of
      // the assertion: the input must be capable of producing the failure.
      expect(expected.byteLength).toBeGreaterThan(PIPE_BUFFER_BYTES * 4);

      for (let trial = 0; trial < PIPE_TRIALS; trial++) {
        const piped = pipeline(`${LIST_JSON} | cat`, authority);
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

  test("human-readable collection output stays bounded and identical through a pipe", () => {
    // `channel read <name>` returns rc=0 and "No messages in #<name>." for a
    // channel that does NOT exist, identically to one that exists and is empty,
    // so an operator reading channels in plain text is exactly as exposed as
    // one parsing JSON. `channel list`'s human form is row-capped at
    // MAX_COMPACT_LIMIT and cannot itself overflow a pipe buffer, but message
    // BODIES are unbounded — agents post evidence dumps — and `--verbose`
    // prints them whole. That is the plain-text surface that can overflow, so
    // that is the one measured.
    const { dir, authority } = fixture;
    const read = `bun run src/cli/index.tsx channel read ${BIG_CHANNEL} --verbose --limit 5`;
    {
      const outFile = join(dir, "redirected.txt");
      const redirected = pipeline(`${read} > ${JSON.stringify(outFile)}`, authority);
      expect(redirected.exitCode).toBe(0);
      const expected = readFileSync(outFile);
      // Safe collection reads are bounded previews; exact bodies require show.
      expect(expected.byteLength).toBeLessThan(PIPE_BUFFER_BYTES);

      const piped = pipeline(`${read} | cat`, authority);
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
    const { authority } = fixture;
    {
      const result = pipeline(`${LIST_JSON} | head -1`, authority);
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
