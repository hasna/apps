/**
 * @hasna/logs — event-stream client (out-of-band operational SSE transport).
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * This is the transport behind `logs watch --server <url>`: a live tail of an
 * OPERATOR-NAMED logs server's `/api/events/stream` (Server-Sent Events)
 * endpoint. It is deliberately NOT the mode-resolved data-plane {@link Store}:
 *
 *   - The events catalog has no cloud data model (ApiStore surfaces it as
 *     `unsupported`); only a running logs HTTP server serves the live bus.
 *   - `--server <url>` addresses an explicit server the operator names, not the
 *     tier resolved through the @hasna/contracts credential chain, so it can
 *     never cause the split-brain bug (silently reading/writing the wrong tier)
 *     the Store abstraction exists to prevent.
 *
 * Confining the one raw `fetch` for this feature to this documented transport —
 * instead of inlining it in a CLI command body — keeps command handlers free of
 * direct network/db access, exactly as the Store impls confine `getDb()`.
 * SAFETY: the bearer token is only ever placed on the outbound Authorization
 * header; it is never logged, returned, or embedded in output.
 */

/** A single parsed Server-Sent Events frame. */
export interface SseMessage {
  event: string;
  id: string | null;
  data: string;
}

/** Connection parameters for {@link streamServerEvents}. */
export interface EventStreamRequest {
  /** Absolute stream URL (already built with filters/last-event-id query). */
  url: string;
  /** Optional bearer token for the named server. */
  token?: string;
  /** Resume cursor forwarded as the `Last-Event-ID` header. */
  lastEventId?: string | null;
  /** Abort signal to tear the connection down. */
  signal?: AbortSignal;
}

/**
 * Connect to a named logs server's SSE event stream and yield parsed
 * frames. The raw `fetch` for the `--server` tail lives here (a transport),
 * never in a command handler. Throws on a non-OK HTTP response so the caller
 * can surface/reconnect.
 */
export async function* streamServerEvents(
  req: EventStreamRequest,
): AsyncGenerator<SseMessage> {
  const headers: Record<string, string> = {};
  if (req.token) headers.Authorization = `Bearer ${req.token}`;
  if (req.lastEventId) headers["Last-Event-ID"] = req.lastEventId;

  const response = await fetch(req.url, { headers, signal: req.signal });
  if (!response.ok) {
    throw new Error(`Stream failed: ${response.status} ${response.statusText}`);
  }
  yield* readSseMessages(response.body);
}

/** Parse a raw SSE byte stream into discrete {@link SseMessage} frames. */
export async function* readSseMessages(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<SseMessage> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let frameEnd = findSseFrameEnd(buffer);
      while (frameEnd >= 0) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd).replace(/^\r?\n\r?\n?/, "");
        const message = parseSseFrame(frame);
        if (message) yield message;
        frameEnd = findSseFrameEnd(buffer);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function findSseFrameEnd(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function parseSseFrame(frame: string): SseMessage | null {
  let event = "message";
  let id: string | null = null;
  const data: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const separator = rawLine.indexOf(":");
    const field = separator >= 0 ? rawLine.slice(0, separator) : rawLine;
    const value =
      separator >= 0 ? rawLine.slice(separator + 1).replace(/^ /, "") : "";
    if (field === "event") event = value || "message";
    if (field === "id") id = value;
    if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, id, data: data.join("\n") };
}
