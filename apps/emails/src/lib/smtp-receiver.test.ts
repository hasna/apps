import { describe, expect, test } from "bun:test";
import { createConnection } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSmtpSession, listenSmtp, SMTP_MAX_MESSAGE_BYTES, type SmtpDelivery } from "./smtp-receiver.js";

const raw = [
  'From: "Sender" <sender@example.test>',
  "To: visible@example.test",
  "Cc: copy@example.test",
  "Subject: =?UTF-8?B?SGVsbG8g4pyT?=",
  "Message-ID: <message-1@example.test>",
  "In-Reply-To: <previous@example.test>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="outer"',
  "",
  "--outer",
  'Content-Type: multipart/alternative; boundary="inner"',
  "",
  "--inner",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "First line",
  "",
  "..literal dot and trailing spaces  ",
  "--inner",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>First line</p>",
  "--inner--",
  "--outer",
  'Content-Type: application/octet-stream; name="payload.bin"',
  'Content-Disposition: attachment; filename="payload.bin"',
  "Content-Transfer-Encoding: base64",
  "",
  "AAECA/8=",
  "--outer--",
  "",
].join("\r\n");
const preamble = "EHLO fixture.test\r\nMAIL FROM:<bounce@example.test>\r\nRCPT TO:<hidden@example.test>\r\nDATA\r\n";
const receipt = { id: "11111111-1111-4111-8111-111111111111" };

describe("storage-free SMTP transaction", () => {
  test("reassembles arbitrary TCP fragments, preserves blank lines/MIME/attachments and envelope", async () => {
    const stored: SmtpDelivery[] = [];
    const session = createSmtpSession({ persist: async (delivery) => { stored.push(delivery); return receipt; } });
    const bytes = Buffer.from(preamble + raw + ".\r\n");
    const responses: string[] = [];
    for (let i = 0; i < bytes.length; i += 7) responses.push(...await session.receive(bytes.subarray(i, i + 7)));
    expect(stored).toHaveLength(1);
    const delivery = stored[0]!;
    expect(delivery.envelope).toEqual({ from: "bounce@example.test", to: ["hidden@example.test"] });
    expect(delivery.message.from_addr).toContain("sender@example.test");
    expect(delivery.message.to_addrs).toEqual(["visible@example.test"]);
    expect(delivery.message.cc_addrs).toEqual(["copy@example.test"]);
    expect(delivery.message.subject).toBe("Hello ✓");
    expect(delivery.message.rfc_message_id).toBe("message-1@example.test");
    expect(delivery.message.in_reply_to).toBe("previous@example.test");
    expect(delivery.message.body_text).toContain("First line\n\n.literal dot and trailing spaces  ");
    expect(delivery.message.body_html).toContain("<p>First line</p>");
    expect(delivery.message.attachments).toEqual([{ filename: "payload.bin", content_type: "application/octet-stream", size: 5, content_base64: "AAECA/8=" }]);
    expect(delivery.rawSize).toBe(Buffer.byteLength(raw.replace("..literal", ".literal")));
    expect(delivery.rawSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(responses.at(-1)).toBe("250 2.0.0 Message stored\r\n");
  });

  test("never acknowledges before persistence settles and returns failure when it rejects", async () => {
    let reject!: (error: Error) => void;
    let called!: () => void;
    const started = new Promise<void>((resolve) => { called = resolve; });
    const session = createSmtpSession({ persist: () => { called(); return new Promise((_resolve, failure) => { reject = failure; }); } });
    await session.receive(Buffer.from(preamble));
    let completed = false;
    const result = session.receive(Buffer.from(raw + ".\r\n")).then((r) => { completed = true; return r; });
    await started;
    expect(completed).toBeFalse();
    reject(new Error("credential-and-private-mail-must-not-appear"));
    expect(await result).toEqual(["451 4.3.0 Message persistence failed; retry later\r\n"]);
  });

  test("requires MAIL and RCPT, keeps each identical submission distinct, and resets after failure", async () => {
    const deliveries: SmtpDelivery[] = [];
    let fail = true;
    const session = createSmtpSession({ persist: async (d) => { deliveries.push(d); if (fail) throw new Error("no"); return receipt; } });
    expect(await session.receive(Buffer.from("DATA\r\n"))).toEqual(["503 5.5.1 MAIL and RCPT required\r\n"]);
    await session.receive(Buffer.from(preamble));
    expect(await session.receive(Buffer.from(raw + ".\r\n"))).toEqual(["451 4.3.0 Message persistence failed; retry later\r\n"]);
    fail = false;
    await session.receive(Buffer.from(preamble));
    expect((await session.receive(Buffer.from(raw + ".\r\n"))).at(-1)).toStartWith("250");
    expect(deliveries[0]!.transactionId).not.toBe(deliveries[1]!.transactionId);
    expect(deliveries[0]!.rawSha256).toBe(deliveries[1]!.rawSha256);
  });

  test("bounds partial lines and message bytes without calling persistence", async () => {
    let calls = 0;
    const options = { persist: async () => { calls++; return receipt; }, maxMessageBytes: 256 };
    const hugeLine = createSmtpSession(options);
    await hugeLine.receive(Buffer.from(preamble));
    expect(await hugeLine.receive(Buffer.alloc(300, 65))).toEqual(["552 5.3.4 Message exceeds the size limit\r\n"]);
    expect(hugeLine.closed).toBeTrue();
    const declared = createSmtpSession(options);
    await declared.receive(Buffer.from("EHLO fixture.test\r\n"));
    expect(await declared.receive(Buffer.from("MAIL FROM:<a@example.test> SIZE=257\r\n"))).toEqual(["552 5.3.4 Message exceeds the size limit\r\n"]);
    expect(calls).toBe(0);
    expect(SMTP_MAX_MESSAGE_BYTES).toBe(10 * 1024 * 1024);
  });

  test("has no local store import or logging of message payloads", () => {
    const source = readFileSync(join(import.meta.dir, "smtp-receiver.ts"), "utf8");
    expect(source).not.toMatch(/bun:sqlite|inbound\.local|db\/database|console\.|process\.stderr/);
  });

  test("rejects bare LF, overlong unterminated commands and incomplete receipts", async () => {
    let calls = 0;
    const persist = async () => { calls++; return { id: "" }; };
    const lf = createSmtpSession({ persist });
    expect(await lf.receive(Buffer.from("EHLO fixture.test\n"))).toEqual(["500 5.5.2 CRLF line ending required\r\n"]);
    expect(lf.closed).toBeTrue();
    const long = createSmtpSession({ persist });
    expect(await long.receive(Buffer.alloc(1001, 65))).toEqual(["500 5.5.2 SMTP line exceeds the limit\r\n"]);
    expect(long.closed).toBeTrue();
    expect(calls).toBe(0);
    const noReceipt = createSmtpSession({ persist });
    await noReceipt.receive(Buffer.from(preamble));
    expect(await noReceipt.receive(Buffer.from(raw + ".\r\n"))).toEqual(["451 4.3.0 Message persistence failed; retry later\r\n"]);
    expect(calls).toBe(1);
  });

  test("enforces byte rather than UTF16 limits and requires recipients even for null reverse paths", async () => {
    let calls = 0;
    const message = "From: a@example.test\r\nTo: b@example.test\r\n\r\n✓✓✓✓\r\n";
    const session = createSmtpSession({ maxMessageBytes: message.length, persist: async () => { calls++; return receipt; } });
    await session.receive(Buffer.from("EHLO fixture.test\r\nMAIL FROM:<>\r\n"));
    expect(await session.receive(Buffer.from("DATA\r\n"))).toEqual(["503 5.5.1 MAIL and RCPT required\r\n"]);
    await session.receive(Buffer.from("RCPT TO:<b@example.test>\r\nDATA\r\n"));
    expect(await session.receive(Buffer.from(message + ".\r\n"))).toEqual(["552 5.3.4 Message exceeds the size limit\r\n"]);
    expect(calls).toBe(0);
  });

  test("requires EHLO before MAIL, caps recipients, and answers RSET/NOOP", async () => {
    const session = createSmtpSession({ persist: async () => receipt });
    expect(await session.receive(Buffer.from("MAIL FROM:<a@example.test>\r\n"))).toEqual([
      "503 5.5.1 Send EHLO first\r\n",
    ]);
    expect(await session.receive(Buffer.from("EHLO fixture.test\r\n"))).toEqual([
      expect.stringContaining("250-emails"),
    ]);
    expect(await session.receive(Buffer.from("NOOP\r\n"))).toEqual(["250 2.0.0 OK\r\n"]);
    await session.receive(Buffer.from("MAIL FROM:<a@example.test>\r\n"));
    for (let i = 0; i < 100; i++) {
      const replies = await session.receive(Buffer.from(`RCPT TO:<u${i}@example.test>\r\n`));
      expect(replies).toEqual(["250 2.1.5 Recipient accepted\r\n"]);
    }
    expect(await session.receive(Buffer.from("RCPT TO:<overflow@example.test>\r\n"))).toEqual([
      "452 4.5.3 Too many recipients\r\n",
    ]);
    expect(await session.receive(Buffer.from("RSET\r\n"))).toEqual(["250 2.0.0 Reset\r\n"]);
    expect(await session.receive(Buffer.from("DATA\r\n"))).toEqual(["503 5.5.1 MAIL and RCPT required\r\n"]);
  });

  test("rejects STARTTLS/AUTH with 500 and BODY=8BITMIME with 501 (documented, loopback-only)", async () => {
    const session = createSmtpSession({ persist: async () => receipt });
    await session.receive(Buffer.from("EHLO fixture.test\r\n"));
    expect(await session.receive(Buffer.from("STARTTLS\r\n"))).toEqual(["500 5.5.2 Command not recognized\r\n"]);
    expect(await session.receive(Buffer.from("AUTH PLAIN abc\r\n"))).toEqual(["500 5.5.2 Command not recognized\r\n"]);
    expect(await session.receive(Buffer.from("MAIL FROM:<a@example.test> BODY=8BITMIME\r\n"))).toEqual([
      "501 5.5.4 Invalid reverse path or parameters\r\n",
    ]);
  });

  test("stores empty DATA, keeps transactions distinct, and reports persist failures via onError without bodies", async () => {
    const deliveries: SmtpDelivery[] = [];
    const errors: Array<{ stage: string; reply: string; error: unknown }> = [];
    let fail = true;
    const session = createSmtpSession({
      persist: async (d) => {
        deliveries.push(d);
        if (fail) throw new Error("remote-store-down");
        return receipt;
      },
      onError: (e) => {
        errors.push(e);
      },
    });
    await session.receive(Buffer.from(preamble));
    expect(await session.receive(Buffer.from(".\r\n"))).toEqual([
      "451 4.3.0 Message persistence failed; retry later\r\n",
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.stage).toBe("persist");
    // Hook payload must not carry bodies/envelopes: only stage/reply/error.
    expect(Object.keys(errors[0]!).sort()).toEqual(["error", "reply", "stage"]);
    expect(JSON.stringify(errors[0])).not.toContain("First line");
    fail = false;
    await session.receive(Buffer.from(preamble));
    expect(await session.receive(Buffer.from(raw + ".\r\n"))).toEqual(["250 2.0.0 Message stored\r\n"]);
    // Second transaction on the same session stays distinct.
    await session.receive(Buffer.from(preamble));
    expect(await session.receive(Buffer.from(raw + ".\r\n"))).toEqual(["250 2.0.0 Message stored\r\n"]);
    expect(deliveries).toHaveLength(3);
    expect(new Set(deliveries.map((d) => d.transactionId)).size).toBe(3);
  });
});

test("real synthetic loopback SMTP socket returns success only for a durable receipt", async () => {
  const deliveries: SmtpDelivery[] = [];
  const server = await listenSmtp({ port: 0, hostname: "127.0.0.1", persist: async (d) => { deliveries.push(d); return receipt; } });
  const response = await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ port: server.port, host: "127.0.0.1" });
    let response = "";
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("fixture socket timed out")); });
    socket.on("error", reject);
    socket.on("data", (data) => {
      response += data.toString();
      if (response.includes("220 emails ESMTP ready\r\n") && !response.includes("250")) socket.write(preamble + raw + ".\r\nQUIT\r\n");
    });
    socket.on("close", () => resolve(response));
  }).finally(() => server.stop());
  expect(deliveries).toHaveLength(1);
  expect(response).toContain("250 2.0.0 Message stored\r\n221 2.0.0 Bye\r\n");
});
