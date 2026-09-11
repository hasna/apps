import { describe, it, expect } from "bun:test";
import { generateMessageId, buildThreadingHeaders, parseReferences, normalizeMessageId, deriveReplyThreading } from "./threading.js";

describe("generateMessageId", () => {
  it("produces an RFC Message-ID <id@domain>", () => {
    const m = generateMessageId("example.com", "abc-123");
    expect(m).toBe("<abc-123@example.com>");
  });
  it("auto-generates the local part when not given", () => {
    const m = generateMessageId("example.com");
    expect(m).toMatch(/^<[a-z0-9-]+@example\.com>$/);
  });
});

describe("buildThreadingHeaders — full References chain", () => {
  it("first reply: In-Reply-To = parent id, References = [parent id]", () => {
    const h = buildThreadingHeaders({ message_id: "<root@x.com>", references: [] });
    expect(h.inReplyTo).toBe("<root@x.com>");
    expect(h.references).toEqual(["<root@x.com>"]);
  });
  it("third message: References accumulates the whole ancestry", () => {
    // parent is the 2nd message, whose references already include the root
    const h = buildThreadingHeaders({ message_id: "<msg2@x.com>", references: ["<root@x.com>"] });
    expect(h.inReplyTo).toBe("<msg2@x.com>");
    expect(h.references).toEqual(["<root@x.com>", "<msg2@x.com>"]);
  });
  it("does not duplicate the parent id if already in references", () => {
    const h = buildThreadingHeaders({ message_id: "<msg2@x.com>", references: ["<root@x.com>", "<msg2@x.com>"] });
    expect(h.references).toEqual(["<root@x.com>", "<msg2@x.com>"]);
  });
  it("emits a References header string joined by spaces", () => {
    const h = buildThreadingHeaders({ message_id: "<b@x.com>", references: ["<a@x.com>"] });
    expect(h.referencesHeader).toBe("<a@x.com> <b@x.com>");
    expect(h.inReplyToHeader).toBe("<b@x.com>");
  });
});

describe("parseReferences", () => {
  it("splits a References header into ids", () => {
    expect(parseReferences("<a@x.com> <b@x.com>")).toEqual(["<a@x.com>", "<b@x.com>"]);
    expect(parseReferences("")).toEqual([]);
    expect(parseReferences(undefined)).toEqual([]);
  });
});

describe("normalizeMessageId", () => {
  it("brackets a bare Message-ID and is idempotent", () => {
    expect(normalizeMessageId("a@x.com")).toBe("<a@x.com>");
    expect(normalizeMessageId("<a@x.com>")).toBe("<a@x.com>");
    expect(normalizeMessageId("  <a@x.com> ")).toBe("<a@x.com>");
  });
  it("normalizes a blank value to the empty string, never <>", () => {
    expect(normalizeMessageId("")).toBe("");
    expect(normalizeMessageId("   ")).toBe("");
    expect(normalizeMessageId("<>")).toBe("");
  });
});

describe("deriveReplyThreading (FR-0002)", () => {
  it("first reply: In-Reply-To = parent, References = parent chain + parent, Message-ID minted", () => {
    const t = deriveReplyThreading({
      ownMessageId: "<own@x.com>",
      parentMessageId: "<root@x.com>",
      parentReferences: [],
    });
    expect(t.in_reply_to).toBe("<root@x.com>");
    expect(t.references).toEqual(["<root@x.com>"]);
    expect(t.headers).toEqual({
      "Message-ID": "<own@x.com>",
      "In-Reply-To": "<root@x.com>",
      "References": "<root@x.com>",
    });
  });

  it("deep reply: References is the parent's chain then the parent (RFC 5322 §3.6.4)", () => {
    const t = deriveReplyThreading({
      ownMessageId: "<own@x.com>",
      parentMessageId: "<msg2@x.com>",
      parentReferences: ["<root@x.com>"],
    });
    expect(t.in_reply_to).toBe("<msg2@x.com>");
    expect(t.headers["References"]).toBe("<root@x.com> <msg2@x.com>");
  });

  it("deduplicates a parent id that is already the last entry of its own chain", () => {
    const t = deriveReplyThreading({
      ownMessageId: "<own@x.com>",
      parentMessageId: "<msg2@x.com>",
      parentReferences: ["<root@x.com>", "<msg2@x.com>"],
    });
    expect(t.references).toEqual(["<root@x.com>", "<msg2@x.com>"]);
  });

  it("merges caller-supplied ancestors without duplicating the parent", () => {
    const t = deriveReplyThreading({
      ownMessageId: "<own@x.com>",
      parentMessageId: "<msg2@x.com>",
      parentReferences: ["<root@x.com>"],
      extraReferences: ["<root@x.com>", "<uncle@x.com>"],
    });
    expect(t.references).toEqual(["<root@x.com>", "<uncle@x.com>", "<msg2@x.com>"]);
  });

  it("normalizes unbracketed Message-IDs on both sides", () => {
    const t = deriveReplyThreading({
      ownMessageId: "own@x.com",
      parentMessageId: "root@x.com",
      parentReferences: ["ancestor@x.com"],
    });
    expect(t.headers["Message-ID"]).toBe("<own@x.com>");
    expect(t.headers["In-Reply-To"]).toBe("<root@x.com>");
    expect(t.headers["References"]).toBe("<ancestor@x.com> <root@x.com>");
  });

  it("a root message (no parent, no extras) reports no In-Reply-To and no References", () => {
    const t = deriveReplyThreading({ ownMessageId: "<own@x.com>" });
    expect(t.in_reply_to).toBeNull();
    expect(t.references).toEqual([]);
    expect(t.headers).toEqual({ "Message-ID": "<own@x.com>" });
  });
});
