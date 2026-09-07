import { expect, it } from "bun:test";
import type { EmailStore } from "../store/email-store.js";
import type { MessageListRecord } from "../store/records.js";
import { getInboundStats, formatInboundStats } from "./inbound-stats.js";

it("follows cursors, applies the window, and counts attachments once per message", async () => {
  const calls: unknown[] = [];
  const store = { messages: { listMessages: async (options: Record<string, unknown>) => {
    calls.push(options);
    return { ok: true, value: { items: [{ id: options.cursor ? "two" : "one", from_addr: "sender@example.test", attachment_count: options.cursor ? 2 : 0 } as MessageListRecord], next_cursor: options.cursor ? null : "next-page" } };
  } } } as unknown as EmailStore;
  const report = await getInboundStats("7d", undefined, store);
  expect(report).toMatchObject({ total: 2, with_attachments: 1, complete: true, top_senders: [{ from_address: "sender@example.test", cnt: 2 }] });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ direction: "inbound", cursor: "next-page", since: expect.any(String) });
});

it("does not turn transport failure into an empty inbox", async () => {
  const store = { messages: { listMessages: async () => { throw new Error("network offline"); } } } as unknown as EmailStore;
  await expect(getInboundStats("30d", undefined, store)).rejects.toThrow("network offline");
});

it("does not invent provider scope or accept malformed periods", async () => {
  const store = {} as EmailStore;
  await expect(getInboundStats("30d", "provider-a", store)).rejects.toThrow("omit --provider");
  await expect(getInboundStats("7garbage", undefined, store)).rejects.toThrow("positive number of days");
});

it("labels truncated counts and sender rankings as partial", () => {
  expect(formatInboundStats({ period: "7d", total: 500, with_attachments: 2, top_senders: [], complete: false })).toContain("≥500");
  expect(formatInboundStats({ period: "7d", total: 500, with_attachments: 2, top_senders: [], complete: false })).toContain("rankings may change");
});
