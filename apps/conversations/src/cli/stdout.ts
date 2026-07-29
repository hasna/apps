import { writeSync } from "node:fs";

export interface SyncWriter {
  (chunk: Uint8Array): number;
}

export type StdoutWriteOutcome = "complete" | "reader-closed";

const backpressureWait = new Int32Array(
  new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
);

function waitForDrain(): void {
  Atomics.wait(backpressureWait, 0, 0, 1);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Write every byte, retrying pipe backpressure and partial writes. */
export function writeAllSync(
  text: string,
  writer: SyncWriter,
): StdoutWriteOutcome {
  const buffer = Buffer.from(text, "utf8");
  let offset = 0;

  while (offset < buffer.length) {
    let accepted: number;
    try {
      accepted = writer(buffer.subarray(offset));
    } catch (error) {
      const code = errorCode(error);
      if (code === "EAGAIN" || code === "EWOULDBLOCK") {
        waitForDrain();
        continue;
      }
      if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") {
        return "reader-closed";
      }
      throw error;
    }

    if (accepted <= 0) {
      waitForDrain();
      continue;
    }
    offset += accepted;
  }

  return "complete";
}

const stdoutWriter: SyncWriter = (chunk) => writeSync(1, chunk);

export function writeStdout(
  text: string,
  writer: SyncWriter = stdoutWriter,
): StdoutWriteOutcome {
  return writeAllSync(text, writer);
}

export function printJson(
  value: unknown,
  writer: SyncWriter = stdoutWriter,
): StdoutWriteOutcome {
  return writeStdout(`${JSON.stringify(value, null, 2)}\n`, writer);
}

export function printJsonLine(
  value: unknown,
  writer: SyncWriter = stdoutWriter,
): StdoutWriteOutcome {
  return writeStdout(`${JSON.stringify(value)}\n`, writer);
}
