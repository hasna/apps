/**
 * Deliver CLI output so that it cannot be silently lost.
 *
 * `console.log` on a pipe is not a completed write. Measured on this box with
 * Bun 1.3.14 against `@hasna/conversations` 0.5.9 and a 1,149,610-byte channel
 * index, five consecutive trials of the identical command in the same minute:
 *
 *     conversations channel list -j > file            ->  1149610 bytes, rc=0
 *     bash -c 'set -o pipefail; … channel list -j|cat' ->  98304 / 65536 /
 *                                                          98304 / 65536 /
 *                                                          98304 bytes, rc=0
 *
 * One or two pipe buffers, page-aligned, reported as success. The overflow is
 * queued for an async flush that never runs, because nothing keeps the process
 * alive long enough to drain it — and the CLI calls `process.exit()` on many
 * paths, which does not drain it either. The result is invalid JSON delivered
 * at exit code 0:
 *
 *     conversations channel list -j | jq .
 *     # parse error at ~char 65536, and the shell saw rc=0
 *
 * Whether the payload survives is a race on how much work the process did
 * before writing, which is why the same command answers 65536 on one run and
 * 98304 on the next. A truncation that varies run to run is worse than one that
 * always happens: it reads as success on a small store and starts corrupting
 * data as the store grows.
 *
 * This is not cosmetic here. `conversations channel read <name>` returns rc=0
 * and "No messages in #<name>." for a channel that does NOT exist, identically
 * to one that exists and is empty, so `channel list` is the only working
 * channel-existence test on this fleet. An agent grepping it through a pipe
 * would have missed 43% of channels in the worst measured trial and concluded a
 * channel is absent.
 *
 * So output goes through `writeSync` in a loop instead. A synchronous write to
 * a file descriptor either returns bytes accepted or fails; there is no queue
 * left behind at exit, so `process.exit()` immediately afterwards is safe.
 * Three cases have to be handled explicitly, and each is a real failure mode
 * rather than defensive padding:
 *
 *   - **Partial writes.** `write(2)` on a pipe is allowed to accept fewer bytes
 *     than offered, and does so for anything past the buffer capacity. A single
 *     unchecked `writeSync` is the 64 KiB bug with extra steps.
 *   - **EAGAIN.** Bun may leave fd 1 in non-blocking mode, so a full pipe
 *     raises EAGAIN rather than blocking until the reader drains. That is
 *     back-pressure, not an error, and the write has to be retried.
 *   - **EPIPE.** `conversations channel list -j | head` closes the reader
 *     early. That is the reader's choice and the normal end of a shell
 *     pipeline, so writing stops quietly instead of raising — otherwise adding
 *     a pager to a working command would turn it into a crash.
 *
 * The design and the three cases follow the fix landed for the same defect
 * class in hasna/repos PR #36 (`src/cli/stdout.ts`, merged 2026-07-28).
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
 * Write every byte of `text`, or stop because the reader closed the pipe.
 *
 * `writer` is injectable so the partial-write, back-pressure and reader-closed
 * paths can be exercised without needing a real full pipe, which is not
 * reproducible on demand in a test.
 */
export function writeAllSync(text: string, writer: SyncWriter): WriteOutcome {
  const buffer = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < buffer.length) {
    let accepted: number;
    try {
      accepted = writer(buffer.subarray(offset));
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
      // raised nothing. Retrying immediately would spin, so wait like EAGAIN.
      awaitDrain();
      continue;
    }
    offset += accepted;
  }
  return "complete";
}

const fdWriter = (fd: number): SyncWriter => (chunk) => writeSync(fd, chunk);

const stdoutWriter = fdWriter(1);
const stderrWriter = fdWriter(2);

/** Write `text` to stdout, completing the write before returning. */
export function writeStdout(text: string, writer: SyncWriter = stdoutWriter): WriteOutcome {
  return writeAllSync(text, writer);
}

/**
 * Drop-in replacement for `console.log`, with the write actually completed.
 *
 * Variadic and `util.format`-based so it matches `console.log` argument for
 * argument (`%s`/`%d`/`%o` substitution, space-joined extras, object
 * inspection). A replacement that only accepted one string would quietly change
 * the output of any call site passing two.
 */
export function printLine(...args: unknown[]): WriteOutcome {
  return writeStdout(`${format(...args)}\n`);
}

/** `console.error` equivalent: completed write to stderr. */
export function printErrorLine(...args: unknown[]): WriteOutcome {
  return writeAllSync(`${format(...args)}\n`, stderrWriter);
}

/**
 * Emit a machine-readable JSON document on stdout.
 *
 * Every `--json` surface goes through here rather than `console.log`, because
 * any of them can exceed a pipe buffer once the store grows: the channel list,
 * the message history, the agent roster and the analytics reports are all
 * unbounded in the number of rows they serialize.
 */
export function printJson(value: unknown, writer: SyncWriter = stdoutWriter): WriteOutcome {
  return writeAllSync(`${JSON.stringify(value, null, 2)}\n`, writer);
}

/** Single-line JSON, for streams where one record per line is the contract. */
export function printJsonLine(value: unknown, writer: SyncWriter = stdoutWriter): WriteOutcome {
  return writeAllSync(`${JSON.stringify(value)}\n`, writer);
}
