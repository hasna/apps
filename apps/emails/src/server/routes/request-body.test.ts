// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// readBoundedRequestText is the body gate for every write route on the
// server. Two limits must hold independently, and a happy-path test misses
// both:
//
//   - the DECLARED content-length is checked BEFORE any byte is read — a
//     request that advertises more than the bound must fail without reading
//     its body at all (this is what keeps a giant body from being buffered);
//   - the ACTUAL stream is enforced as it is read — a chunked request whose
//     real size exceeds the bound (lying or missing content-length) must
//     cancel the reader and fail MID-READ, not after buffering the whole
//     body;
//   - the exact boundary: a body of exactly maxBytes is accepted, one byte
//     more is refused — off-by-one here is a route that accepts an
//     unbounded body or rejects the legitimate maximum;
//   - a non-numeric content-length header must not blow up the guard (it is
//     skipped and the stream bound still applies).

import { describe, expect, it } from "bun:test";
import { readBoundedRequestText, RouteBodyTooLargeError } from "./request-body.js";

function streamBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

describe("readBoundedRequestText", () => {
  it("reads a body within the bound", async () => {
    const req = new Request("http://local/v1/x", { method: "POST", body: "hello" });
    expect(await readBoundedRequestText(req, 1024)).toBe("hello");
  });

  it("rejects a declared content-length above the bound before reading", async () => {
    const req = new Request("http://local/v1/x", {
      method: "POST",
      headers: { "content-length": "2048" },
      body: "small-but-lying",
    });
    await expect(readBoundedRequestText(req, 1024)).rejects.toBeInstanceOf(RouteBodyTooLargeError);
  });

  it("rejects a body that exceeds the bound mid-stream, even without a lying header", async () => {
    const req = new Request("http://local/v1/x", {
      method: "POST",
      // No content-length: the stream bound is the only guard.
      body: streamBody(["aaaa", "bbbb", "cccc"]),
    });
    await expect(readBoundedRequestText(req, 10)).rejects.toBeInstanceOf(RouteBodyTooLargeError);
  });

  it("accepts exactly maxBytes and rejects one byte more", async () => {
    const atBound = new Request("http://local/v1/x", { method: "POST", body: "a".repeat(10) });
    expect(await readBoundedRequestText(atBound, 10)).toBe("a".repeat(10));

    const over = new Request("http://local/v1/x", { method: "POST", body: "a".repeat(11) });
    await expect(readBoundedRequestText(over, 10)).rejects.toBeInstanceOf(RouteBodyTooLargeError);
  });

  it("accepts a chunked stream that stays under the bound, byte-exact", async () => {
    const req = new Request("http://local/v1/x", {
      method: "POST",
      body: streamBody(["ab", "", "cd", "e"]),
    });
    expect(await readBoundedRequestText(req, 10)).toBe("abcde");
  });

  it("returns an empty string for a request with no body", async () => {
    const req = new Request("http://local/v1/x", { method: "GET" });
    expect(await readBoundedRequestText(req, 10)).toBe("");
  });

  it("tolerates a non-numeric content-length header — the stream bound still applies", async () => {
    const ok = new Request("http://local/v1/x", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
      body: "abc",
    });
    expect(await readBoundedRequestText(ok, 10)).toBe("abc");

    const big = new Request("http://local/v1/x", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
      body: "a".repeat(50),
    });
    await expect(readBoundedRequestText(big, 10)).rejects.toBeInstanceOf(RouteBodyTooLargeError);
  });

  it("preserves multi-byte UTF-8 characters across chunk boundaries", async () => {
    // "é" is two bytes; splitting mid-codepoint must still decode correctly
    // because the decoder runs over the assembled bytes, not per chunk.
    const req = new Request("http://local/v1/x", {
      method: "POST",
      body: streamBody(["caf", "é"]),
    });
    expect(await readBoundedRequestText(req, 10)).toBe("café");
  });
});
