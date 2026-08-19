/**
 * Test gap coverage for src/lib/event-stream-client.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The SSE transport parser had no sibling test. These tests pin the frame
 * grammar: LF and CRLF separators, comment lines, field/colon handling,
 * multi-line data joining, chunk boundaries (a frame split across chunks),
 * empty-data frames, and the non-OK fetch rejection with header plumbing.
 */
import { describe, expect, it } from "bun:test";
import {
  readSseMessages,
  type SseMessage,
  streamServerEvents,
} from "./event-stream-client.ts";

async function collect(body: ReadableStream<Uint8Array> | null): Promise<SseMessage[]> {
  const messages: SseMessage[] = [];
  for await (const message of readSseMessages(body)) messages.push(message);
  return messages;
}

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("readSseMessages", () => {
  it("returns nothing for a null body", async () => {
    expect(await collect(null)).toEqual([]);
  });

  it("parses a single data frame with default event name", async () => {
    const messages = await collect(streamFrom(["data: hello world\n\n"]));
    expect(messages).toEqual([{ event: "message", id: null, data: "hello world" }]);
  });

  it("parses event and id fields and multi-line data joined with newlines", async () => {
    const messages = await collect(
      streamFrom([
        "id: 42\nevent: log\ndata: line one\ndata: line two\n\n",
      ]),
    );
    expect(messages).toEqual([
      { event: "log", id: "42", data: "line one\nline two" },
    ]);
  });

  it("handles CRLF frame separators and CRLF line endings", async () => {
    const messages = await collect(
      streamFrom(["data: crlf-frame\r\n\r\n"]),
    );
    expect(messages).toEqual([{ event: "message", id: null, data: "crlf-frame" }]);
  });

  it("treats comments and blank lines inside a frame as ignorable", async () => {
    const messages = await collect(
      streamFrom([": keep-alive\ndata: real\n\n"]),
    );
    expect(messages).toEqual([{ event: "message", id: null, data: "real" }]);
  });

  it("emits no message when a frame carries no data lines", async () => {
    const messages = await collect(
      streamFrom(["event: ping\n\n", "id: 1\n\n"]),
    );
    expect(messages).toEqual([]);
  });

  it("treats a field without a colon as a field with an empty value", async () => {
    const messages = await collect(streamFrom(["data\n\n"]));
    expect(messages).toEqual([{ event: "message", id: null, data: "" }]);
  });

  it("strips exactly one leading space after the colon", async () => {
    const messages = await collect(
      streamFrom(["data:  two-space-value\n\n", "data: no-space\n\n"]),
    );
    expect(messages.map((m) => m.data)).toEqual([" two-space-value", "no-space"]);
  });

  it("splits frames that straddle chunk boundaries", async () => {
    const messages = await collect(
      streamFrom(["data: first", "\n\n", "data: second\n\n"]),
    );
    expect(messages.map((m) => m.data)).toEqual(["first", "second"]);
  });

  it("keeps the last id for a frame that repeats the id field", async () => {
    const messages = await collect(
      streamFrom(["id: 1\nid: 2\ndata: x\n\n"]),
    );
    expect(messages).toEqual([{ event: "message", id: "2", data: "x" }]);
  });

  it("parses multiple frames in one stream", async () => {
    const messages = await collect(
      streamFrom(["data: a\n\ndata: b\n\ndata: c\n\n"]),
    );
    expect(messages.map((m) => m.data)).toEqual(["a", "b", "c"]);
  });
});

describe("streamServerEvents", () => {
  it("throws on a non-OK response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Response("boom", { status: 503, statusText: "Service Unavailable" })) as typeof fetch;
    try {
      await expect(
        streamServerEvents({ url: "https://logs.example/api/events/stream" })
          .next(),
      ).rejects.toThrow("Stream failed: 503 Service Unavailable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sets the bearer token and Last-Event-ID headers", async () => {
    const captured: Headers[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      captured.push(new Headers(init?.headers));
      return new Response("data: ok\n\n", { status: 200 });
    }) as typeof fetch;
    try {
      const messages: SseMessage[] = [];
      for await (const message of streamServerEvents({
        url: "https://logs.example/api/events/stream",
        token: "secret-token-value",
        lastEventId: "cursor-9",
      })) {
        messages.push(message);
      }
      expect(captured[0]?.get("authorization")).toBe("Bearer secret-token-value");
      expect(captured[0]?.get("last-event-id")).toBe("cursor-9");
      expect(messages).toEqual([{ event: "message", id: null, data: "ok" }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("omits auth headers when no token or cursor is given", async () => {
    const captured: Headers[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      captured.push(new Headers(init?.headers));
      return new Response("", { status: 200 });
    }) as typeof fetch;
    try {
      for await (const _ of streamServerEvents({
        url: "https://logs.example/api/events/stream",
      })) {
        // drain
      }
      expect(captured[0]?.has("authorization")).toBe(false);
      expect(captured[0]?.has("last-event-id")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
