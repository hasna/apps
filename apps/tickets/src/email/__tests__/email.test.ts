import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "../../db/database.ts";
import { createProject } from "../../db/projects.ts";
import { createTicket, getTicketById } from "../../db/tickets.ts";
import { listComments } from "../../db/comments.ts";
import { ConsoleEmailProvider } from "../providers/console.ts";
import { generateReplyToken, verifyReplyToken } from "../reply-token.ts";
import { parseToAddress, processInboundEmail, buildReplyToAddress } from "../inbound.ts";
import { enqueue, processQueue, getQueueStats } from "../queue.ts";
import { setEmailProvider } from "../index.ts";

process.env["TICKETS_DB_PATH"] = ":memory:";
process.env["TICKETS_REPLY_SECRET"] = "test-secret-123";

let projectId: string;

beforeEach(() => {
  resetDatabase();
  const db = getDatabase();
  const p = createProject({ name: "Email Test", ticket_prefix: "EML" }, db);
  projectId = p.id;
});

afterEach(() => closeDatabase());

// ── ConsoleEmailProvider ──────────────────────────────────────────────────────

describe("ConsoleEmailProvider", () => {
  it("sends email and returns messageId", async () => {
    const provider = new ConsoleEmailProvider();
    const result = await provider.send({
      from: "support@test.com",
      to: ["user@example.com"],
      subject: "Test email",
      text: "Hello world",
    });
    expect(result.provider).toBe("console");
    expect(result.messageId).toMatch(/^console-\d+$/);
  });

  it("handles multiple recipients", async () => {
    const provider = new ConsoleEmailProvider();
    const result = await provider.send({
      from: "support@test.com",
      to: ["a@example.com", "b@example.com"],
      subject: "Multi",
      html: "<p>Hello</p>",
    });
    expect(result.provider).toBe("console");
  });
});

// ── Reply token ───────────────────────────────────────────────────────────────

describe("generateReplyToken / verifyReplyToken", () => {
  it("roundtrip: generate then verify succeeds", () => {
    const token = generateReplyToken("TST-0042", "user@example.com", "my-secret");
    expect(verifyReplyToken("TST-0042", "user@example.com", token, "my-secret")).toBe(true);
  });

  it("returns false for wrong ticket ID", () => {
    const token = generateReplyToken("TST-0042", "user@example.com", "my-secret");
    expect(verifyReplyToken("TST-9999", "user@example.com", token, "my-secret")).toBe(false);
  });

  it("returns false for wrong email", () => {
    const token = generateReplyToken("TST-0042", "user@example.com", "my-secret");
    expect(verifyReplyToken("TST-0042", "attacker@evil.com", token, "my-secret")).toBe(false);
  });

  it("returns false for wrong secret", () => {
    const token = generateReplyToken("TST-0042", "user@example.com", "correct-secret");
    expect(verifyReplyToken("TST-0042", "user@example.com", token, "wrong-secret")).toBe(false);
  });

  it("is case-insensitive on email", () => {
    const token = generateReplyToken("TST-0042", "User@Example.COM", "secret");
    expect(verifyReplyToken("TST-0042", "user@example.com", token, "secret")).toBe(true);
  });

  it("produces 16-char hex token", () => {
    const token = generateReplyToken("A-0001", "x@y.com", "s");
    expect(token).toHaveLength(16);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });
});

// ── parseToAddress ────────────────────────────────────────────────────────────

describe("parseToAddress", () => {
  it("detects new ticket address", () => {
    expect(parseToAddress("support@myapp.com")).toEqual({ type: "new" });
    expect(parseToAddress("help@tickets.io")).toEqual({ type: "new" });
  });

  it("detects reply address", () => {
    const result = parseToAddress("reply+TST-0042+abc123def456@myapp.com");
    expect(result).toEqual({ type: "reply", ticketId: "tst-0042", token: "abc123def456" });
  });

  it("handles uppercase in short_id", () => {
    const result = parseToAddress("reply+API-0001+tokenhere@domain.com");
    expect(result.type).toBe("reply");
    if (result.type === "reply") expect(result.ticketId).toBe("api-0001");
  });
});

// ── processInboundEmail ───────────────────────────────────────────────────────

describe("processInboundEmail", () => {
  it("creates new ticket from plain email", async () => {
    const result = await processInboundEmail({
      from: "customer@example.com",
      to: ["support@myapp.com"],
      subject: "Login page crashes on mobile",
      text: "When I try to login on my iPhone the page freezes.",
    }, projectId);

    expect(result.action).toBe("created");
    expect(result.short_id).toBe("EML-0001");

    const ticket = getTicketById(result.short_id);
    expect(ticket.title).toBe("Login page crashes on mobile");
    expect(ticket.source).toBe("email");
    expect(ticket.type).toBe("question");
  });

  it("strips Re: prefix from subject", async () => {
    const result = await processInboundEmail({
      from: "customer@example.com",
      to: ["support@myapp.com"],
      subject: "Re: Re: Login crash",
    }, projectId);
    const ticket = getTicketById(result.short_id);
    expect(ticket.title).toBe("Login crash");
  });

  it("appends comment when reply token is valid", async () => {
    const ticket = createTicket({ project_id: projectId, title: "Original issue" });
    const testSecret = "fixed-test-secret-for-this-test";
    const token = generateReplyToken(ticket.short_id, "reporter@example.com", testSecret);
    const replyTo = `reply+${ticket.short_id}+${token}@support.myapp.com`;

    const result = await processInboundEmail({
      from: "reporter@example.com",
      to: [replyTo],
      subject: `Re: [${ticket.short_id}] Original issue`,
      text: "I can reproduce this too on iOS 17.",
    }, projectId, "email", testSecret);

    expect(result.action).toBe("commented");
    expect(result.short_id).toBe(ticket.short_id);

    const comments = listComments(ticket.id, false);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.content).toContain("I can reproduce");
  });

  it("rejects reply with invalid token", async () => {
    const ticket = createTicket({ project_id: projectId, title: "Real ticket" });
    const replyTo = `reply+${ticket.short_id}+bad1token2here3456@support.myapp.com`;

    await expect(processInboundEmail({
      from: "attacker@evil.com",
      to: [replyTo],
      subject: "Injected comment",
      text: "Malicious content",
    }, projectId, "email", "test-secret-123")).rejects.toThrow(/Invalid reply token/);
  });

  it("sets description from email body", async () => {
    const result = await processInboundEmail({
      from: "user@test.com",
      to: ["support@app.com"],
      subject: "Performance issue",
      text: "The dashboard takes 30 seconds to load.",
    }, projectId);
    const ticket = getTicketById(result.short_id);
    expect(ticket.description).toContain("30 seconds");
  });
});

// ── Email queue ───────────────────────────────────────────────────────────────

describe("email queue", () => {
  beforeEach(() => {
    // Use console provider so tests don't make real network calls
    setEmailProvider(new ConsoleEmailProvider());
  });

  it("enqueue adds to queue", () => {
    enqueue({ from: "noreply@app.com", to: ["user@test.com"], subject: "Test", text: "Hello" });
    const stats = getQueueStats();
    expect(stats.pending).toBe(1);
  });

  it("processQueue sends pending emails", async () => {
    enqueue({ from: "noreply@app.com", to: ["user@test.com"], subject: "Test 1", text: "Hello 1" });
    enqueue({ from: "noreply@app.com", to: ["user@test.com"], subject: "Test 2", text: "Hello 2" });

    const result = await processQueue();
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);

    const stats = getQueueStats();
    expect(stats.sent).toBe(2);
    expect(stats.pending).toBe(0);
  });

  it("retries failed email up to 3 times then marks failed", async () => {
    setEmailProvider({
      name: "failing",
      send: async () => { throw new Error("SMTP connection refused"); },
    });

    enqueue({ from: "noreply@app.com", to: ["user@test.com"], subject: "Will fail", text: "..." });

    // Clear send_at after each run so backoff doesn't block the next attempt
    const db = getDatabase();
    for (let i = 0; i < 3; i++) {
      await processQueue();
      db.run("UPDATE email_queue SET send_at = NULL WHERE status = 'pending'");
    }

    const stats = getQueueStats();
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(0);
  });

  it("getQueueStats returns correct counts", async () => {
    setEmailProvider(new ConsoleEmailProvider());
    enqueue({ from: "a@b.com", to: ["c@d.com"], subject: "S1", text: "T1" });
    enqueue({ from: "a@b.com", to: ["c@d.com"], subject: "S2", text: "T2" });
    await processQueue();
    enqueue({ from: "a@b.com", to: ["c@d.com"], subject: "S3", text: "T3" });

    const stats = getQueueStats();
    expect(stats.sent).toBe(2);
    expect(stats.pending).toBe(1);
  });
});

// ── buildReplyToAddress ───────────────────────────────────────────────────────

describe("buildReplyToAddress", () => {
  it("builds correct reply-to format", () => {
    const addr = buildReplyToAddress("TST-0001", "user@example.com", "support.myapp.com");
    expect(addr).toMatch(/^reply\+TST-0001\+[0-9a-f]{16}@support\.myapp\.com$/);
  });

  it("verifiable: token from buildReplyToAddress can be verified with same secret", () => {
    const secret = "explicit-test-secret-xyz";
    const addr = buildReplyToAddress("API-0042", "reporter@test.com", "tickets.acme.com", secret);
    const parsed = parseToAddress(addr);
    expect(parsed.type).toBe("reply");
    if (parsed.type === "reply") {
      const valid = verifyReplyToken("API-0042", "reporter@test.com", parsed.token, secret);
      expect(valid).toBe(true);
    }
  });
});
