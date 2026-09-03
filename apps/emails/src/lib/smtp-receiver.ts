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

export interface SmtpReceiverOptions {
  /** Resolves only after the authoritative store confirms durable persistence. */
  persist(delivery: SmtpDelivery): Promise<{ id: string }>;
  /** May lower, never increase, the advertised and enforced wire limit. */
  maxMessageBytes?: number;
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
        } catch {
          responses.push("554 5.6.0 Message format rejected\r\n");
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
        } catch {
          // Never report success or echo a remote error, credential, or message body.
          responses.push("451 4.3.0 Message persistence failed; retry later\r\n");
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

/** Bounded TCP adapter; no socket opens until this function is explicitly called. */
export async function listenSmtp(options: SmtpReceiverOptions & { port: number; hostname?: string }): Promise<{ port: number; stop(): Promise<void> }> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new TypeError("Invalid SMTP port");
  boundedMessageBytes(options.maxMessageBytes);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    if (sockets.size >= MAX_CONNECTIONS) { socket.end("421 4.3.2 Too many connections\r\n"); return; }
    sockets.add(socket);
    const session = createSmtpSession(options);
    socket.setTimeout(120_000, () => socket.end("421 4.4.2 Connection timed out\r\n"));
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 emails ESMTP ready\r\n");
    socket.on("data", async (data) => {
      socket.pause();
      try {
        const replies = await session.receive(data);
        if (socket.destroyed) return;
        for (const reply of replies) socket.write(reply);
        if (session.closed) socket.end();
        else socket.resume();
      } catch {
        socket.end("451 4.3.0 Receiver failed; retry later\r\n");
      }
    });
  });
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
