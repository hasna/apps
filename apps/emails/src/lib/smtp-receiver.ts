// Storage-free SMTP receiver: session parser + bounded loopback TCP adapter.
//
// SCOPE (receiver-only): this module ships the SMTP wire parser and a TCP
// adapter that acknowledges (250) only after the caller's authoritative
// `persist()` resolves with a non-empty durable receipt id. It does NOT wire
// any durable remote persistence itself — the caller provides `persist()`.
// Follow-up: wire a minimal remote-store `persist()` implementation; until
// then the PR title/body must read "receiver-only", not "durable remote
// persistence".
//
// SECURITY (loopback-only): `listenSmtp` defaults to 127.0.0.1. Do not bind
// 0.0.0.0 without an authenticating proxy/firewall in front. There is no
// STARTTLS/AUTH/TLS in this receiver by design; both return 500 (documented
// below) so clients fail closed rather than sending credentials in cleartext
// to a listener that cannot upgrade.
//
// LIMITS (documented behaviour, not oversights):
// - MAIL FROM only accepts `SIZE=`; other ESMTP params (BODY=8BITMIME,
//   SMTPUTF8, …) are rejected with 501. Accept-and-ignore is a follow-up.
// - Oversize (declared SIZE= or accumulated bytes) answers 552 then closes
//   the session (does not continue) to bound memory against pipelined abuse;
//   the client must reconnect. 552-continue is a follow-up.
// - No per-DATA deadline; only a 120s idle socket timeout. Per-message
//   deadline is a follow-up.
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { parseInboundMime, type NormalizedInboundEmail } from "./inbound-mime.js";

/** RFC822 bytes, excluding SMTP dot transparency and the DATA terminator. */
export const SMTP_MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
const MAX_LINE_BYTES = 1000;
const MAX_RECIPIENTS = 100;
const MAX_CONNECTIONS = 16;

export interface SmtpDelivery {
  /** Unique per DATA transaction: equal messages are not silently deduplicated. */
  transactionId: string;
  envelope: { from: string; to: string[] };
  message: NormalizedInboundEmail;
  receivedAt: string;
  rawSize: number;
  rawSha256: string;
}

export interface SmtpReceiverError {
  /** Which stage failed. Never carries message bodies, envelopes, or credentials. */
  stage: "parse" | "persist" | "connection";
  /** The SMTP reply already queued for the client (e.g. "451 …"). */
  reply: string;
  error: unknown;
}

export interface SmtpReceiverOptions {
  /** Resolves only after the authoritative store confirms durable persistence. */
  persist(delivery: SmtpDelivery): Promise<{ id: string }>;
  /** May lower, never increase, the advertised and enforced wire limit. */
  maxMessageBytes?: number;
  /**
   * Metric/error hook (no bodies/envelopes/credentials are passed).
   * Wire to a counter (e.g. `smtp_receiver_errors_total{stage}`); never log payloads here.
   */
  onError?: (event: SmtpReceiverError) => void;
}

export interface SmtpSession {
  readonly closed: boolean;
  /** Sequential input; the TCP adapter pauses reads while this promise is pending. */
  receive(chunk: Uint8Array): Promise<string[]>;
}

function boundedMessageBytes(value = SMTP_MAX_MESSAGE_BYTES): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > SMTP_MAX_MESSAGE_BYTES) {
    throw new TypeError("SMTP message limit must be within the supported byte bound");
  }
  return value;
}

/** No persistence, filesystem, provider, or authentication configuration is implicit. */
export function createSmtpSession(options: SmtpReceiverOptions): SmtpSession {
  const maxBytes = boundedMessageBytes(options.maxMessageBytes);
  const notify = (stage: SmtpReceiverError["stage"], reply: string, error: unknown): void => {
    try {
      options.onError?.({ stage, reply, error });
    } catch {
      // Metric hooks must never break the SMTP session.
    }
  };
  let closed = false;
  let busy = false;
  let greeting = false;
  let from: string | null = null;
  let recipients: string[] = [];
  let collecting = false;
  let pending = Buffer.alloc(0);
  let parts: Buffer[] = [];
  let size = 0;

  function reset(): void {
    from = null;
    recipients = [];
    collecting = false;
    parts = [];
    size = 0;
  }

  function tooLarge(responses: string[]): void {
    responses.push("552 5.3.4 Message exceeds the size limit\r\n");
    closed = true;
    pending = Buffer.alloc(0);
    reset();
  }

  async function line(bytes: Buffer, responses: string[]): Promise<void> {
    if (collecting) {
      if (bytes.equals(Buffer.from("."))) {
        const data = Buffer.concat(parts, size);
        const envelope = { from: from!, to: [...recipients] };
        reset();
        let message: NormalizedInboundEmail;
        try {
          message = await parseInboundMime(data);
        } catch (error) {
          const reply = "554 5.6.0 Message format rejected\r\n";
          notify("parse", reply, error);
          responses.push(reply);
          return;
        }
        try {
          const receipt = await options.persist({
            transactionId: randomUUID(),
            envelope,
            message,
            receivedAt: new Date().toISOString(),
            rawSize: data.byteLength,
            rawSha256: createHash("sha256").update(data).digest("hex"),
          });
          if (!receipt || typeof receipt.id !== "string" || !receipt.id.trim()) throw new Error("missing durable receipt");
          responses.push("250 2.0.0 Message stored\r\n");
        } catch (error) {
          // Never report success or echo a remote error, credential, or message body.
          const reply = "451 4.3.0 Message persistence failed; retry later\r\n";
          notify("persist", reply, error);
          responses.push(reply);
        }
      } else {
        const unstuffed = bytes[0] === 46 ? bytes.subarray(1) : bytes;
        size += unstuffed.byteLength + 2;
        if (size > maxBytes) { tooLarge(responses); return; }
        parts.push(Buffer.concat([unstuffed, Buffer.from("\r\n")]));
      }
      return;
    }

    const command = bytes.toString("utf8");
    if (/^(?:EHLO|HELO) [^\s]+$/i.test(command)) {
      reset();
      greeting = true;
      responses.push(`250-emails\r\n250 SIZE ${maxBytes}\r\n`);
    } else if (/^MAIL FROM:/i.test(command)) {
      if (!greeting) { responses.push("503 5.5.1 Send EHLO first\r\n"); return; }
      // Only SIZE= is accepted; BODY=8BITMIME/SMTPUTF8/etc. are 501 by design (see header).
      const match = /^MAIL FROM:<([^<>\r\n]*)>(?: SIZE=(\d+))?$/i.exec(command);
      if (!match || match[1]!.length > 254 || (match[1] && !match[1].includes("@"))) {
        responses.push("501 5.5.4 Invalid reverse path or parameters\r\n"); return;
      }
      reset();
      if (match[2] && (!Number.isSafeInteger(Number(match[2])) || Number(match[2]) > maxBytes)) {
        responses.push("552 5.3.4 Message exceeds the size limit\r\n"); return;
      }
      from = match[1]!;
      responses.push("250 2.1.0 Sender accepted\r\n");
    } else if (/^RCPT TO:/i.test(command)) {
      if (from === null) { responses.push("503 5.5.1 MAIL required\r\n"); return; }
      const match = /^RCPT TO:<([^<>\s]+@[^<>\s]+)>$/i.exec(command);
      if (!match || match[1]!.length > 254) { responses.push("501 5.5.4 Invalid recipient\r\n"); return; }
      if (recipients.length >= MAX_RECIPIENTS) { responses.push("452 4.5.3 Too many recipients\r\n"); return; }
      recipients.push(match[1]!);
      responses.push("250 2.1.5 Recipient accepted\r\n");
    } else if (/^DATA$/i.test(command)) {
      if (from === null || recipients.length === 0) {
        responses.push("503 5.5.1 MAIL and RCPT required\r\n"); return;
      }
      collecting = true;
      responses.push("354 Start mail input; end with <CRLF>.<CRLF>\r\n");
    } else if (/^RSET$/i.test(command)) {
      reset();
      responses.push("250 2.0.0 Reset\r\n");
    } else if (/^NOOP(?: .*)?$/i.test(command)) {
      responses.push("250 2.0.0 OK\r\n");
    } else if (/^QUIT$/i.test(command)) {
      reset();
      closed = true;
      responses.push("221 2.0.0 Bye\r\n");
    } else if (/^(?:STARTTLS|AUTH)(?:\s|$)/i.test(command)) {
      // No TLS/auth in this loopback-only receiver by design; fail closed with 500.
      responses.push("500 5.5.2 Command not recognized\r\n");
    } else {
      responses.push("500 5.5.2 Command not recognized\r\n");
    }
  }

  return {
    get closed() { return closed; },
    async receive(chunk) {
      if (closed) return [];
      if (busy) throw new Error("SMTP input must be sequential");
      busy = true;
      const responses: string[] = [];
      try {
        // A complete TCP chunk can contain many short lines; only the unfinished
        // line is retained between calls. Buffers remain bytes until MIME parsing.
        let offset = 0;
        while (offset < chunk.byteLength && !closed) {
          const next = chunk.indexOf(10, offset);
          const end = next < 0 ? chunk.byteLength : next + 1;
          const piece = chunk.subarray(offset, end);
          if (collecting && size + pending.byteLength + piece.byteLength > maxBytes + 3) {
            tooLarge(responses); break;
          }
          if (pending.byteLength + piece.byteLength > MAX_LINE_BYTES + (collecting ? 1 : 0)) {
            // Command lines cap at 1000 bytes excl. CRLF; DATA wire lines allow one
            // extra byte for the dot-stuffing indicator stripped before accounting.
            responses.push("500 5.5.2 SMTP line exceeds the limit\r\n");
            closed = true; reset(); break;
          }
          pending = Buffer.concat([pending, piece]);
          offset = end;
          if (next < 0) break;
          if (pending.byteLength < 2 || pending[pending.byteLength - 2] !== 13) {
            responses.push("500 5.5.2 CRLF line ending required\r\n");
            closed = true; reset(); break;
          }
          const complete = pending.subarray(0, pending.byteLength - 2);
          pending = Buffer.alloc(0);
          await line(complete, responses);
        }
      } finally { busy = false; }
      return responses;
    },
  };
}

/** Bounded TCP adapter; no socket opens until this function is explicitly called.
 * Loopback-only by default (127.0.0.1); binding 0.0.0.0 requires an
 * authenticating proxy/firewall. Idle socket timeout is 120s; there is no
 * per-DATA deadline (follow-up). */
export async function listenSmtp(options: SmtpReceiverOptions & { port: number; hostname?: string }): Promise<{ port: number; stop(): Promise<void> }> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new TypeError("Invalid SMTP port");
  boundedMessageBytes(options.maxMessageBytes);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    // server.maxConnections (set below) is the backstop; this app-level check
    // keeps the 421 reply instead of a silent drop. Single-threaded accept
    // means no race between the check and `sockets.add`.
    if (sockets.size >= MAX_CONNECTIONS) { socket.end("421 4.3.2 Too many connections\r\n"); return; }
    sockets.add(socket);
    const session = createSmtpSession(options);
    socket.setTimeout(120_000, () => socket.end("421 4.4.2 Connection timed out\r\n"));
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 emails ESMTP ready\r\n");
    socket.on("data", async (data: Buffer) => {
      socket.pause();
      try {
        const replies = await session.receive(data as Uint8Array);
        if (socket.destroyed) return;
        for (const reply of replies) socket.write(reply);
        if (session.closed) socket.end();
        else socket.resume();
      } catch (error) {
        // Metric hook only — never include bytes/envelopes/credentials.
        try {
          options.onError?.({ stage: "connection", reply: "451 4.3.0 Receiver failed; retry later\r\n", error });
        } catch {
          // Metric hooks must never break the socket path.
        }
        socket.end("451 4.3.0 Receiver failed; retry later\r\n");
      }
    });
  });
  // Kernel-level backstop for the app-level 421 check above.
  server.maxConnections = MAX_CONNECTIONS;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.hostname ?? "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SMTP listener did not acquire a TCP port");
  return {
    port: address.port,
    stop: () => new Promise<void>((resolve, reject) => {
      for (const socket of sockets) socket.destroy();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
