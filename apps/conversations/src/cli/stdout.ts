/**
 * Deliver CLI output synchronously so a process cannot exit with bytes still
 * queued for an stdout pipe.
 */
import { writeSync } from "node:fs";

export interface SyncWriter {
  (chunk: Uint8Array): number;
}

export type StdoutWriteOutcome = "complete" | "reader-closed";

const BACKPRESSURE_WAIT_MS = 1;
const backpressureWait = new Int32Array(
  new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
);

function awaitDrain(): void {
  Atomics.wait(backpressureWait, 0, 0, BACKPRESSURE_WAIT_MS);
}

function errorCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Write every byte, retrying partial writes and non-blocking back-pressure. */
export function writeAllSync(text: string, writer: SyncWriter): StdoutWriteOutcome {
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
      if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") {
        return "reader-closed";
      }
      throw error;
    }

    if (accepted <= 0) {
      awaitDrain();
      continue;
    }
    offset += accepted;
  }

  return "complete";
}

const fdWriter = (fd: number): SyncWriter => (chunk) => writeSync(fd, chunk);

export function writeStdout(
  text: string,
  writer: SyncWriter = fdWriter(1),
): StdoutWriteOutcome {
  return writeAllSync(text, writer);
}

/** Print one newline-terminated value only after all bytes reach stdout. */
export function printLine(
  text: string,
  writer: SyncWriter = fdWriter(1),
): StdoutWriteOutcome {
  return writeStdout(`${text}\n`, writer);
}
