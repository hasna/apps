import { describe, expect, test } from "bun:test";
import { collectionPage, compactMessage } from "./compact-output.js";

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
});
