import { describe, expect, test } from "bun:test";
import { printJson, printJsonLine, writeAllSync, writeStdout, type SyncWriter } from "./stdout.js";

/** Collect everything a writer is handed, with a scriptable accept policy. */
function recordingWriter(policy: (chunk: Uint8Array, call: number) => number | Error) {
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
      return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    },
  };
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("writeAllSync", () => {
  test("keeps writing until every byte is accepted, not just the first chunk", () => {
    // A pipe accepts a bounded number of bytes per call. One unchecked
    // writeSync is exactly the 64 KiB truncation defect, so a short accept must
    // be followed up rather than treated as done.
    const payload = "x".repeat(5000);
    const sink = recordingWriter((chunk) => Math.min(chunk.length, 97));
    expect(writeAllSync(payload, sink.writer)).toBe("complete");
    expect(sink.text()).toBe(payload);
    expect(sink.calls).toBeGreaterThan(1);
  });

  test("retries on EAGAIN instead of losing the remainder", () => {
    // Bun may leave fd 1 non-blocking, so a full pipe raises EAGAIN rather than
    // blocking. EAGAIN is back-pressure; treating it as an error would drop the
    // tail exactly like the original bug.
    const payload = "abcdefghij".repeat(20);
    let raised = 0;
    const sink = recordingWriter((chunk, call) => {
      if (call % 2 === 1 && raised < 4) {
        raised++;
        return errno("EAGAIN");
      }
      return Math.min(chunk.length, 31);
    });
    expect(writeAllSync(payload, sink.writer)).toBe("complete");
    expect(sink.text()).toBe(payload);
    expect(raised).toBe(4);
  });

  test("retries on EWOULDBLOCK, the other spelling of the same condition", () => {
    const payload = "q".repeat(200);
    let raised = 0;
    const sink = recordingWriter((chunk, call) => {
      if (call === 1 && raised < 1) {
        raised++;
        return errno("EWOULDBLOCK");
      }
      return Math.min(chunk.length, 64);
    });
    expect(writeAllSync(payload, sink.writer)).toBe("complete");
    expect(sink.text()).toBe(payload);
    expect(raised).toBe(1);
  });

  test("retries when the descriptor accepts zero bytes without raising", () => {
    const payload = "y".repeat(300);
    let stalls = 0;
    const sink = recordingWriter((chunk, call) => {
      if (call % 2 === 0 && stalls < 3) {
        stalls++;
        return 0;
      }
      return Math.min(chunk.length, 64);
    });
    expect(writeAllSync(payload, sink.writer)).toBe("complete");
    expect(sink.text()).toBe(payload);
  });

  test("stops quietly when the reader closes the pipe", () => {
    // `conversations channel list -j | head` is a normal shell pipeline.
    // Raising EPIPE here would turn adding a pager onto a working command into
    // a crash.
    const sink = recordingWriter((chunk, call) =>
      call === 0 ? Math.min(chunk.length, 10) : errno("EPIPE"),
    );
    expect(writeAllSync("z".repeat(500), sink.writer)).toBe("reader-closed");
    expect(sink.text()).toBe("z".repeat(10));
  });

  test("treats ERR_STREAM_DESTROYED as the same reader-closed condition", () => {
    const sink = recordingWriter(() => errno("ERR_STREAM_DESTROYED"));
    expect(writeAllSync("payload", sink.writer)).toBe("reader-closed");
  });

  test("propagates a genuine I/O error rather than reporting a short write as done", () => {
    // ENOSPC on `--json > /dev/full` must surface, not be swallowed into a
    // silent short write — completing a write also means reporting a failure to
    // complete it.
    const sink = recordingWriter(() => errno("EIO"));
    expect(() => writeAllSync("payload", sink.writer)).toThrow("EIO");
  });

  test("counts BYTES, not UTF-16 code units, when following up a partial accept", () => {
    // A multi-byte payload is where a length-vs-byteLength confusion silently
    // truncates: the loop must advance by accepted bytes over a Buffer, not by
    // characters over a string.
    const payload = "☃".repeat(400); // 3 bytes each in UTF-8, 1 code unit each
    const sink = recordingWriter((chunk) => Math.min(chunk.length, 7));
    expect(writeAllSync(payload, sink.writer)).toBe("complete");
    expect(sink.text()).toBe(payload);
    expect(Buffer.byteLength(payload, "utf8")).toBe(1200);
  });

  test("writeStdout of an empty string does not call the writer", () => {
    const sink = recordingWriter(() => 0);
    expect(writeStdout("", sink.writer)).toBe("complete");
    expect(sink.calls).toBe(0);
  });
});

describe("JSON helpers", () => {
  test("printJson emits one parseable pretty document terminated by a newline", () => {
    const sink = recordingWriter((chunk) => chunk.length);
    printJson({ ok: true, rows: [1, 2, 3] }, sink.writer);
    const text = sink.text();
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain("\n  ");
    expect(JSON.parse(text)).toEqual({ ok: true, rows: [1, 2, 3] });
  });

  test("printJsonLine emits exactly one line", () => {
    const sink = recordingWriter((chunk) => chunk.length);
    printJsonLine({ released: 2 }, sink.writer);
    const text = sink.text();
    expect(text).toBe('{"released":2}\n');
  });
});
