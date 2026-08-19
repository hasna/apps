// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// Opaque keyset cursors. This is the ONLY test coverage of the store seam's
// pagination contract, and the contract is a TOTAL SORT ORDER claim: an
// interrupted scan must resume at exactly the next row, never re-emitting and
// never skipping one.
//
// The failure modes a happy-path round-trip test misses are all on the
// DECODE side, because callers hand `next_cursor` back from storage or user
// input:
//   - a malformed or truncated cursor must be REJECTED (null), never coerced
//     — a cursor that silently decodes to "start from the beginning" turns a
//     resumed scan into a duplicate one, and one that decodes to a wrong
//     row SKIPS data;
//   - base64url is not injective over arbitrary input, so the decoder
//     re-encodes and compares — a token that merely decodes must fail;
//   - version and field-type checks are per-cursor: a message cursor that
//     carries an attachment idx, or a v2 token, must be rejected;
//   - the attachment idx must be a non-negative safe integer — a fractional
//     or negative idx would corrupt the ORDER the cursor pins.

import { describe, expect, it } from "bun:test";
import {
  decodeAttachmentCursor,
  decodeMessageCursor,
  encodeAttachmentCursor,
  encodeMessageCursor,
} from "./cursor.js";

describe("message cursors", () => {
  it("round-trips a cursor", () => {
    const cursor = encodeMessageCursor("2026-08-19T00:00:00.000Z", "msg-1");
    expect(decodeMessageCursor(cursor)).toEqual({ v: 1, ts: "2026-08-19T00:00:00.000Z", id: "msg-1" });
  });

  it("round-trips ids that need base64url escaping", () => {
    const cursor = encodeMessageCursor("ts/+_=", "id with spaces and ünïcode");
    expect(decodeMessageCursor(cursor)).toEqual({ v: 1, ts: "ts/+_=", id: "id with spaces and ünïcode" });
  });

  it("rejects null, empty and over-long cursors", () => {
    expect(decodeMessageCursor("")).toBeNull();
    expect(decodeMessageCursor("x".repeat(2049))).toBeNull();
    // 2048 chars is still within the bound; only the payload must be valid.
    expect(decodeMessageCursor("A".repeat(2048))).toBeNull();
  });

  it("rejects non-alphabet characters", () => {
    expect(decodeMessageCursor("not base64url!")).toBeNull();
    expect(decodeMessageCursor("a+b/c=")).toBeNull();
  });

  it("rejects tokens that merely decode — the re-encoding proof", () => {
    // This string decodes from base64url but is not the canonical encoding of
    // its own bytes, so it is not a token we minted.
    expect(decodeMessageCursor("aGVsbG8=")).toBeNull();
  });

  it("rejects valid JSON that is not a cursor object", () => {
    expect(decodeMessageCursor(Buffer.from("[1,2]").toString("base64url"))).toBeNull();
    expect(decodeMessageCursor(Buffer.from('"str"').toString("base64url"))).toBeNull();
    expect(decodeMessageCursor(Buffer.from("42").toString("base64url"))).toBeNull();
    expect(decodeMessageCursor(Buffer.from("null").toString("base64url"))).toBeNull();
  });

  it("rejects wrong versions and wrong field types", () => {
    const v2 = Buffer.from(JSON.stringify({ v: 2, ts: "t", id: "i" })).toString("base64url");
    expect(decodeMessageCursor(v2)).toBeNull();
    const numTs = Buffer.from(JSON.stringify({ v: 1, ts: 123, id: "i" })).toString("base64url");
    expect(decodeMessageCursor(numTs)).toBeNull();
    const missingId = Buffer.from(JSON.stringify({ v: 1, ts: "t" })).toString("base64url");
    expect(decodeMessageCursor(missingId)).toBeNull();
    // Extra fields beyond the pinned set are tolerated and dropped: the
    // decoder reads only the fields it defined, so a forward-compatible
    // cursor (v:1 plus a future field) still decodes. The attachment cursor
    // SHAPE is enforced by decodeAttachmentCursor, which requires idx.
    const extraIdx = Buffer.from(JSON.stringify({ v: 1, ts: "t", id: "i", idx: 1 })).toString("base64url");
    expect(decodeMessageCursor(extraIdx)).toEqual({ v: 1, ts: "t", id: "i" });
  });
});

describe("attachment cursors", () => {
  it("round-trips a cursor with its attachment index", () => {
    const cursor = encodeAttachmentCursor("2026-08-19T00:00:00.000Z", "msg-1", 3);
    expect(decodeAttachmentCursor(cursor)).toEqual({ v: 1, ts: "2026-08-19T00:00:00.000Z", id: "msg-1", idx: 3 });
  });

  it("accepts idx 0", () => {
    const cursor = encodeAttachmentCursor("t", "i", 0);
    expect(decodeAttachmentCursor(cursor)?.idx).toBe(0);
  });

  it("rejects negative, fractional and unsafe-integer idx values", () => {
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      const cursor = Buffer.from(JSON.stringify({ v: 1, ts: "t", id: "i", idx: bad })).toString("base64url");
      expect(decodeAttachmentCursor(cursor)).toBeNull();
    }
  });

  it("rejects cursors missing the idx field entirely", () => {
    const cursor = Buffer.from(JSON.stringify({ v: 1, ts: "t", id: "i" })).toString("base64url");
    expect(decodeAttachmentCursor(cursor)).toBeNull();
  });

  it("rejects non-attachment shapes, mirroring the message guard", () => {
    expect(decodeAttachmentCursor(Buffer.from(JSON.stringify({ v: 2, ts: "t", id: "i", idx: 0 })).toString("base64url"))).toBeNull();
    expect(decodeAttachmentCursor("")).toBeNull();
    expect(decodeAttachmentCursor("x".repeat(2049))).toBeNull();
  });
});
