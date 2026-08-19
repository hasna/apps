// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// Webhook event handling has three distinct surfaces, each with a failure
// mode a happy-path test misses:
//
//  1. verifyResendSignature — the svix-style HMAC check. The dangerous
//     failure is a MISSING-HEADER acceptance (a webhook without svix-*
//     headers must be rejected, not verified against undefined), and the
//     timestamp window: an old replay must fail even with a valid signature.
//     Signatures are computed in-test with the same crypto.subtle the code
//     uses, so the positive case is a REAL signature, not a stub.
//
//  2. verifySnsStructure — a structural guard that must reject a payload
//     claiming a Type it does not implement and a TopicArn outside arn:aws,
//     while accepting Notification/SubscriptionConfirmation and arn-less
//     payloads (some valid SNS deliveries carry no TopicArn shape).
//
//  3. parseResendWebhook — the own-key lookup guard: a payload with
//     type:"constructor" / "__proto__" / "toString" must return null, not an
//     inherited Object.prototype member that passes the truthy check and
//     crashes the persist path with a permanently retried 500 (the exact
//     incident recorded in the module comment). Also: provider_event_id must
//     come from the signed envelope when present, and recipient may be an
//     array (first element) or a string.

import { describe, expect, it } from "bun:test";
import { parseResendWebhook, verifyResendSignature, verifySnsStructure } from "./webhook-events.js";

async function signBody(body: string, secret: string, ts: number, id = "msg_123"): Promise<string> {
  const signedContent = `${id}.${ts}.${body}`;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  return "v1," + Buffer.from(sig).toString("base64");
}

describe("verifyResendSignature", () => {
  const SECRET = "whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  const BODY = '{"type":"email.delivered","data":{"email_id":"m1"}}';
  const nowSec = Math.floor(Date.now() / 1000);

  it("accepts a genuine signature for the exact body", async () => {
    const sig = await signBody(BODY, SECRET, nowSec);
    const ok = await verifyResendSignature(BODY, { "svix-id": "msg_123", "svix-timestamp": String(nowSec), "svix-signature": sig }, SECRET);
    expect(ok).toBe(true);
  });

  it("rejects when any svix header is missing", async () => {
    const sig = await signBody(BODY, SECRET, nowSec);
    expect(await verifyResendSignature(BODY, { "svix-timestamp": String(nowSec), "svix-signature": sig }, SECRET)).toBe(false);
    expect(await verifyResendSignature(BODY, { "svix-id": "msg_123", "svix-signature": sig }, SECRET)).toBe(false);
    expect(await verifyResendSignature(BODY, { "svix-id": "msg_123", "svix-timestamp": String(nowSec) }, SECRET)).toBe(false);
    expect(await verifyResendSignature(BODY, {}, SECRET)).toBe(false);
  });

  it("rejects a signature over a different body", async () => {
    const sig = await signBody(BODY, SECRET, nowSec);
    const tampered = await verifyResendSignature(BODY + ',"x":1}', { "svix-id": "msg_123", "svix-timestamp": String(nowSec), "svix-signature": sig }, SECRET);
    expect(tampered).toBe(false);
  });

  it("rejects a valid signature outside the 300-second window", async () => {
    const sig = await signBody(BODY, SECRET, nowSec - 301);
    const ok = await verifyResendSignature(BODY, { "svix-id": "msg_123", "svix-timestamp": String(nowSec - 301), "svix-signature": sig }, SECRET);
    expect(ok).toBe(false);
  });

  it("rejects a non-numeric timestamp", async () => {
    const ok = await verifyResendSignature(BODY, { "svix-id": "msg_123", "svix-timestamp": "not-a-number", "svix-signature": "v1,whatever" }, SECRET);
    expect(ok).toBe(false);
  });

  it("accepts when one of several space-separated signatures matches", async () => {
    const sig = await signBody(BODY, SECRET, nowSec);
    const ok = await verifyResendSignature(
      BODY,
      { "svix-id": "msg_123", "svix-timestamp": String(nowSec), "svix-signature": `v1,deadbeef ${sig}` },
      SECRET,
    );
    expect(ok).toBe(true);
  });

  it("works with a raw (non-whsec_-prefixed) base64 secret", async () => {
    const raw = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
    const sig = await signBody(BODY, raw, nowSec);
    const ok = await verifyResendSignature(BODY, { "svix-id": "msg_123", "svix-timestamp": String(nowSec), "svix-signature": sig }, raw);
    expect(ok).toBe(true);
  });
});

describe("verifySnsStructure", () => {
  it("accepts Notification and SubscriptionConfirmation payloads", () => {
    expect(verifySnsStructure({ Type: "Notification", TopicArn: "arn:aws:sns:us-east-1:123:topic" })).toBe(true);
    expect(verifySnsStructure({ Type: "SubscriptionConfirmation", TopicArn: "arn:aws:sns:us-east-1:123:topic" })).toBe(true);
  });

  it("rejects unimplemented Types", () => {
    expect(verifySnsStructure({ Type: "UnsubscribeConfirmation" })).toBe(false);
    expect(verifySnsStructure({ Type: "Whatever" })).toBe(false);
  });

  it("rejects TopicArns outside arn:aws", () => {
    expect(verifySnsStructure({ Type: "Notification", TopicArn: "arn:google:sns:x" })).toBe(false);
  });

  it("accepts payloads without Type or TopicArn (structural guard is additive)", () => {
    expect(verifySnsStructure({ Message: "hi" })).toBe(true);
    expect(verifySnsStructure({ Type: "Notification" })).toBe(true);
  });
});

describe("parseResendWebhook", () => {
  it("maps every known event type", () => {
    for (const [wire, expected] of [
      ["email.delivered", "delivered"],
      ["email.bounced", "bounced"],
      ["email.complained", "complained"],
      ["email.opened", "opened"],
      ["email.clicked", "clicked"],
    ] as const) {
      const parsed = parseResendWebhook({ type: wire, data: { email_id: "m1" } });
      expect(parsed?.type).toBe(expected);
      expect(parsed?.provider_event_id).toBe("m1");
    }
  });

  it("returns null for unknown types", () => {
    expect(parseResendWebhook({ type: "email.sent" })).toBeNull();
    expect(parseResendWebhook({ type: "email.unknown" })).toBeNull();
    expect(parseResendWebhook({})).toBeNull();
  });

  it("returns null for Object.prototype key names — the own-key guard", () => {
    // A plain map[key] answers for inherited members; the guard must not.
    expect(parseResendWebhook({ type: "constructor", data: { email_id: "m1" } })).toBeNull();
    expect(parseResendWebhook({ type: "__proto__", data: { email_id: "m1" } })).toBeNull();
    expect(parseResendWebhook({ type: "toString", data: { email_id: "m1" } })).toBeNull();
    expect(parseResendWebhook({ type: "hasOwnProperty", data: { email_id: "m1" } })).toBeNull();
  });

  it("returns null when there is no event id anywhere", () => {
    expect(parseResendWebhook({ type: "email.delivered", data: {} })).toBeNull();
    expect(parseResendWebhook({ type: "email.delivered" })).toBeNull();
  });

  it("prefers the signed envelope id over the body email_id", () => {
    const parsed = parseResendWebhook({ type: "email.delivered", data: { email_id: "from-body" } }, "from-envelope");
    expect(parsed?.provider_event_id).toBe("from-envelope");
    expect(parsed?.provider_message_id).toBe("from-body");
  });

  it("extracts recipient from an array (first) or a plain string", () => {
    const fromArray = parseResendWebhook({ type: "email.delivered", data: { email_id: "m1", to: ["a@x.com", "b@x.com"] } });
    expect(fromArray?.recipient).toBe("a@x.com");
    const fromString = parseResendWebhook({ type: "email.delivered", data: { email_id: "m1", to: "a@x.com" } });
    expect(fromString?.recipient).toBe("a@x.com");
    expect(parseResendWebhook({ type: "email.delivered", data: { email_id: "m1" } })?.recipient).toBeUndefined();
  });

  it("uses data.created_at when present and falls back to now otherwise", () => {
    const withTs = parseResendWebhook({ type: "email.delivered", data: { email_id: "m1", created_at: "2026-08-19T00:00:00Z" } });
    expect(withTs?.occurred_at).toBe("2026-08-19T00:00:00Z");
    const fallback = parseResendWebhook({ type: "email.delivered", data: { email_id: "m1" } });
    expect(fallback?.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("carries the full data object as metadata", () => {
    const parsed = parseResendWebhook({ type: "email.opened", data: { email_id: "m1", agent: "iOS" } });
    expect(parsed?.metadata).toEqual({ email_id: "m1", agent: "iOS" });
  });
});
