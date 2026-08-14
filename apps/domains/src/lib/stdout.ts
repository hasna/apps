/**
 * Deliver CLI output so that it cannot be silently lost.
 *
 * `console.log` on a pipe is not a completed write. Measured on station01 with
 * Bun 1.3.14 against the published `@hasna/domains` 0.0.36 binary and a
 * 1,040-row portfolio:
 *
 *     domains domain list --all --json > file    ->  929621 bytes, rc=0
 *     domains domain list --all --json | wc -c   ->   65536 bytes, rc=0
 *
 * 7% of the document, at exit code 0, with empty stderr. Nothing marks it as
 * short. A caller that parses defensively and counts rows out of that buffer
 * gets a confident, plausible, seven-percent answer.
 *
 * ── The mechanism, read from the code and measured rather than assumed ──
 *
 * The obvious hypothesis for this shape in Node is `process.exit()` racing an
 * async flush. That is NOT what happens here, and the difference matters
 * because it changes the fix. Two measurements refute it:
 *
 *   - Wrapping `process.exit` and printing a stack on a truncating run records
 *     no call at all; only the natural `exit` event fires, at code 0.
 *   - Patching a 300 ms delay in after the write, so the process is still alive
 *     long enough for any queued flush to run, leaves the output truncated at
 *     exactly the same length.
 *
 * What actually happens is that fd 1 is in NON-BLOCKING mode by the time the
 * write runs, and on a non-blocking descriptor Bun's `console.log` performs one
 * `write(2)` and discards whatever the pipe would not accept. Read from
 * `/proc/self/fdinfo/1` inside a real run of the published binary:
 *
 *     at process start  flags: 01     (O_WRONLY)
 *     at process exit   flags: 04001  (O_WRONLY | O_NONBLOCK)
 *
 * `ink` is what sets it. Importing ink and nothing else is sufficient to
 * reproduce the truncation in a four-line script. The CLI never means to load
 * ink for `domain list` — `src/cli/index.ts` reaches the TUI only through
 * `await import("./commands/interactive.js")`, gated behind the `interactive`
 * optional group — but `bun build` inlines that dynamically-imported module
 * into the single-file bundle while `ink` stays `--external`, which turns it
 * into a static top-level `import … from "ink"`, hoisted and evaluated on every
 * invocation. So the defect exists only in the artifact users install: running
 * the same command from source delivers all 929,621 bytes through a pipe.
 *
 * ── Why the writer, and not just "stop loading ink" ──
 *
 * Keeping ink off the startup path is worth doing on its own merits and is
 * tracked separately, but it is not this fix, because it leaves the defect one
 * flag away from returning: `DOMAINS_ENABLE_EXTRAS=1` loads ink deliberately,
 * and any future dependency that touches fd 1 reintroduces it silently. The
 * property this module buys — a write that either completes or reports — holds
 * whatever the descriptor's mode is and whoever set it.
 *
 * So output goes through `writeSync` in a loop. A synchronous write to a file
 * descriptor either returns the bytes accepted or throws; there is no queue
 * left behind at exit, so a `process.exit()` immediately afterwards is safe.
 * Three cases have to be handled explicitly, and each is a real failure mode
 * rather than defensive padding:
 *
 *   - **Partial writes.** `write(2)` on a pipe may accept fewer bytes than
 *     offered, and does for anything past the buffer capacity. A single
 *     unchecked `writeSync` is the same bug with extra steps.
 *   - **EAGAIN.** On the non-blocking fd 1 described above, a full pipe raises
 *     EAGAIN instead of blocking until the reader drains. That is
 *     back-pressure, not an error, and the write must be retried.
 *   - **EPIPE.** `domains domain list --all --json | head` closes the reader
 *     early. That is the reader's choice and the normal end of a shell
 *     pipeline, so writing stops quietly instead of raising — otherwise adding
 *     a pager to a working command would turn it into a crash.
 *
 * The design and the three cases follow the fix already landed for this same
 * defect class in hasna/repos (`src/cli/stdout.ts`, PR #36, merged 2026-07-28)
 * and in hasna/conversations (`src/lib/stdout.ts`, PR #24, merged 2026-07-30).
 * This package is the third instance; the class is not new, only unchecked here.
 */
import { writeSync } from "node:fs";
import { format } from "node:util";

/** Bytes accepted per attempt. Throws an errno-bearing Error on failure. */
export interface SyncWriter {
  (chunk: Uint8Array): number;
}

const BACKPRESSURE_WAIT_MS = 1;
const backpressureWait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

/** Sleep without spinning a core while a full pipe drains. */
function awaitDrain(): void {
  Atomics.wait(backpressureWait, 0, 0, BACKPRESSURE_WAIT_MS);
}

function errorCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export type WriteOutcome = "complete" | "reader-closed";

/**
 * Write every byte in `bytes`, or stop because the reader closed the pipe.
 *
 * `writer` is injectable so the partial-write, back-pressure and reader-closed
 * paths can be exercised without needing a real full pipe, which is not
 * reproducible on demand in a unit test.
 */
export function writeAllBytesSync(bytes: Uint8Array, writer: SyncWriter): WriteOutcome {
  let offset = 0;
  while (offset < bytes.length) {
    let accepted: number;
    try {
      accepted = writer(bytes.subarray(offset));
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === "EAGAIN" || code === "EWOULDBLOCK") {
        awaitDrain();
        continue;
      }
      // EPIPE (reader closed) and ERR_STREAM_DESTROYED (the same condition
      // surfaced by a stream wrapper) end the pipeline; anything else is a real
      // I/O failure and must not be swallowed into a short write.
      if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") return "reader-closed";
      throw error;
    }
    if (accepted <= 0) {
      // A zero-byte accept with no error means the descriptor took nothing and
      // raised nothing. Retrying immediately would spin, so wait as for EAGAIN.
      awaitDrain();
      continue;
    }
    offset += accepted;
  }
  return "complete";
}

export function writeAllSync(text: string, writer: SyncWriter): WriteOutcome {
  return writeAllBytesSync(Buffer.from(text, "utf8"), writer);
}

const fdWriter = (fd: number): SyncWriter => (chunk) => writeSync(fd, chunk);

const stdoutWriter = fdWriter(1);
const stderrWriter = fdWriter(2);

/** Write `text` to stdout, completing the write before returning. */
export function writeStdout(text: string, writer: SyncWriter = stdoutWriter): WriteOutcome {
  return writeAllSync(text, writer);
}

/** Write arbitrary bytes to stdout without text encoding or a trailing newline. */
export function writeStdoutBytes(
  bytes: Uint8Array,
  writer: SyncWriter = stdoutWriter,
): WriteOutcome {
  return writeAllBytesSync(bytes, writer);
}

/**
 * Render arguments exactly as `console.log` would, plus the trailing newline.
 *
 * Exported so the formatting contract can be asserted directly. 739 call sites
 * were converted mechanically and many of them pass more than one argument or a
 * `%s`/`%d`/`%o` specifier; a replacement that only handled a single string
 * would change their output silently, which would be a worse regression than
 * the truncation being fixed. Testing that through the real fd would measure
 * the writer instead of the formatter, so the seam is here.
 */
export function formatLine(...args: unknown[]): string {
  return `${format(...args)}\n`;
}

/**
 * Drop-in replacement for `console.log`, with the write actually completed.
 *
 * Variadic and `util.format`-based so it matches `console.log` argument for
 * argument (`%s`/`%d`/`%o` substitution, space-joined extras, object
 * inspection).
 */
export function printLine(...args: unknown[]): WriteOutcome {
  return writeStdout(formatLine(...args));
}

/** `console.error` equivalent: completed write to stderr. */
export function printErrorLine(...args: unknown[]): WriteOutcome {
  return writeAllSync(formatLine(...args), stderrWriter);
}

/**
 * Emit a machine-readable JSON document on stdout.
 *
 * Every `--json` surface is a single write of an unbounded document, so every
 * one of them can exceed a pipe buffer once the portfolio grows. Measured on
 * an 800-row fixture, before this module existed: `domain list --all --json`
 * delivered 65,536 of 822,523 bytes, `domain expiring --json` 65,536 of
 * 784,003, and `domain export --format json` 131,072 of 572,803 — one or two
 * buffers depending on how fast the reader drained, which is why the cut is not
 * a constant anyone can test against.
 */
export function printJson(value: unknown, writer: SyncWriter = stdoutWriter): WriteOutcome {
  return writeAllSync(`${JSON.stringify(value, null, 2)}\n`, writer);
}

/** Single-line JSON, for streams where one record per line is the contract. */
export function printJsonLine(value: unknown, writer: SyncWriter = stdoutWriter): WriteOutcome {
  return writeAllSync(`${JSON.stringify(value)}\n`, writer);
}
