import { describe, expect, test } from "bun:test";
import {
  formatLine,
  printJson,
  printJsonLine,
  writeAllBytesSync,
  writeAllSync,
  writeStdout,
  writeStdoutBytes,
  type SyncWriter,
} from "./stdout.js";

/**
 * The unit half of the regression. These exercise the three cases the loop
 * exists for — partial accepts, back-pressure, reader-closed — against an
 * injected writer, because a genuinely full pipe is not reproducible on demand.
 * The other half, that the shipped CLI actually delivers its whole document
 * through a real pipe, is in `src/cli/stdout-pipe.e2e.test.ts`; neither
 * substitutes for the other.
 */

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
    bytes() {
      return Buffer.concat(chunks.map((c) => Buffer.from(c)));
    },
  };
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("writeAllSync", () => {
  test("keeps writing until every byte is accepted, not just the first chunk", () => {
    // A pipe accepts a bounded number of bytes per call. One unchecked
    // writeSync is exactly the truncation defect, so a short accept must be
    // followed up rather than treated as done.
    const payload = "x".repeat(5000);
    const sink = recordingWriter((chunk) => Math.min(chunk.length, 97));
    expect(writeAllSync(payload, sink.writer)).toBe("complete");
    expect(sink.text()).toBe(payload);
    expect(sink.calls).toBeGreaterThan(1);
  });

  test("retries on EAGAIN instead of losing the remainder", () => {
    // ink leaves fd 1 non-blocking in the shipped bundle, so a full pipe raises
    // EAGAIN rather than blocking. EAGAIN is back-pressure; treating it as an
    // error would drop the tail exactly like the original bug.
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
    // `domains domain list --all --json | head` is a normal shell pipeline.
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
    // characters over a string. Domain data is full of these — IDN names and
    // the ✓/✗ markers the CLI prints.
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

  test("writes arbitrary bytes without UTF-8 conversion across partial accepts", () => {
    const payload = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xc8, 0xff]);
    const sink = recordingWriter((chunk) => Math.min(chunk.length, 2));
    expect(writeAllBytesSync(payload, sink.writer)).toBe("complete");
    expect(sink.bytes()).toEqual(payload);
    expect(sink.calls).toBeGreaterThan(1);
  });

  test("writeStdoutBytes of an empty buffer does not call the writer", () => {
    const sink = recordingWriter(() => 0);
    expect(writeStdoutBytes(Buffer.alloc(0), sink.writer)).toBe("complete");
    expect(sink.calls).toBe(0);
  });
});

describe("formatLine reproduces console.log's argument handling", () => {
  // 739 call sites were converted mechanically and many pass more than one
  // argument or a format specifier. A replacement that only handled a single
  // string would change their output silently, which is a worse regression than
  // the truncation being fixed. Each case below is a shape that actually occurs
  // in src/cli today.
  test("joins multiple arguments with a space", () => {
    expect(formatLine("Domain", "example.com", "added")).toBe("Domain example.com added\n");
  });

  test("applies %s and %d substitution", () => {
    expect(formatLine("%s expires in %d days", "example.com", 30)).toBe(
      "example.com expires in 30 days\n",
    );
  });

  test("inspects objects rather than stringifying them to [object Object]", () => {
    expect(formatLine({ name: "example.com" })).not.toContain("[object Object]");
    expect(formatLine({ name: "example.com" })).toContain("example.com");
  });

  test("a bare call emits just the newline, like console.log()", () => {
    expect(formatLine()).toBe("\n");
  });

  test("preserves an embedded newline instead of escaping it", () => {
    // `console.log(`\n${hint}`)` is the shape used for trailing hints.
    expect(formatLine("\nUse --verbose")).toBe("\nUse --verbose\n");
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

  test("printJson survives a pipe-sized partial accept without losing the tail", () => {
    // The end-to-end analogue of the measured defect, at unit scale: an 800-row
    // portfolio serialized to 822,523 bytes was delivered as 65,536. Here the
    // writer accepts one buffer's worth per call and the document must still
    // arrive whole and parseable.
    const rows = Array.from({ length: 4000 }, (_, i) => ({ id: i, name: `fixture-${i}.example` }));
    const sink = recordingWriter((chunk) => Math.min(chunk.length, 65536));
    expect(printJson({ domains: rows, count: rows.length }, sink.writer)).toBe("complete");
    const parsed = JSON.parse(sink.text()) as { domains: unknown[]; count: number };
    expect(parsed.count).toBe(4000);
    expect(parsed.domains.length).toBe(4000);
    expect(sink.calls).toBeGreaterThan(1);
  });
});
