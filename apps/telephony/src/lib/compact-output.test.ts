import { describe, expect, test } from "bun:test";
import { collectionPage, compactMessage, windowPage } from "./compact-output.js";

describe("telephony compact output", () => {
  test("bounds message lists and omits verbose duplicate fields", () => {
    const rows = Array.from({ length: 75 }, (_, i) => ({
      id: `m-${i}`, type: "sms_inbound" as const, from_number: "+1", to_number: "+2",
      body: "b".repeat(500), media_url: "https://example.test/" + "x".repeat(200),
      object_key: "media/key", sha256: "a".repeat(64), status: "received" as const,
      agent_id: null, project_id: null, twilio_sid: "SM" + "1".repeat(32),
      error_message: null, metadata: { large: "m".repeat(500) },
      created_at: "2026-09-18T00:00:00Z", updated_at: "2026-09-18T00:00:00Z",
    }));
    const page = collectionPage("messages", rows, {}, compactMessage);
    expect(page.messages).toHaveLength(20);
    expect(page.total).toBe(75);
    expect(page.messages[0]!.metadata).toBeUndefined();
    expect(JSON.stringify(page)).not.toContain("b".repeat(300));
  });
  test("uses an authoritative hosted total for continuation and completeness", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `m-${i}`, type: "sms_inbound" as const, from_number: "+1", to_number: "+2", body: "body",
      media_url: null, object_key: null, sha256: null, status: "received" as const, agent_id: null,
      project_id: null, twilio_sid: null, error_message: null, metadata: {},
      created_at: "2026-09-18T00:00:00Z", updated_at: "2026-09-18T00:00:00Z",
    }));
    const first = windowPage("messages", rows, { limit: 20, cursor: 0, total: 45 }, compactMessage);
    expect(first.total).toBe(45);
    expect(first.has_more).toBe(true);
    expect(first.next_cursor).toBe(20);

    const terminal = windowPage("messages", rows.slice(0, 5), { limit: 20, cursor: 40, total: 45 }, compactMessage);
    expect(terminal.total).toBe(45);
    expect(terminal.has_more).toBe(false);
    expect(terminal.next_cursor).toBeNull();
  });

});
