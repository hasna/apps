import { expect } from "bun:test";
import type { EmailStore } from "../store/email-store.js";
import { getLocalStats } from "../lib/stats.js";
import { getAnalytics } from "../lib/analytics.js";
import { getInboundStats } from "../lib/inbound-stats.js";
import type { Outcome } from "../store/outcome.js";

function value<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.value;
}

export async function checkProviderStatistics(store: EmailStore): Promise<void> {
  const before = (await getInboundStats("7d", undefined, store)).total;
  const alpha = String(value(await store.providers.create({ name: "stats-alpha", type: "sandbox" })).id);
  const beta = String(value(await store.providers.create({ name: "stats-beta", type: "sandbox" })).id);
  const now = new Date().toISOString();
  for (const [provider, count] of [[alpha, 1], [beta, 2]] as const) {
    for (let i = 0; i < count; i++) {
      const sent = value(await store.messages.createMessage({ provider_id: provider, direction: "outbound", from_addr: "sender@example.test", to_addrs: [`${provider}@example.test`], received_at: now }));
      expect(sent.provider_id).toBe(provider);
      value(await store.events.create({ provider_id: provider, type: "delivered", occurred_at: now }));
      value(await store.messages.createMessage({ provider_id: provider, direction: "inbound", from_addr: `${provider}@example.test`, to_addrs: ["inbox@example.test"], received_at: now }));
    }
  }
  value(await store.messages.createMessage({ direction: "inbound", from_addr: "unknown@example.test", to_addrs: ["inbox@example.test"], received_at: now }));
  for (const [provider, count] of [[alpha, 1], [beta, 2]] as const) {
    const stats = await getLocalStats(provider, "7d", store);
    expect(stats).toMatchObject({ sent: count, delivered: count, delivery_rate: 100 });
    const analytics = await getAnalytics(provider, "7d", { store });
    expect(analytics.dailyVolume?.reduce((sum, row) => sum + row.count, 0)).toBe(count);
    expect(analytics.topRecipients).toHaveLength(1);
    const inbound = await getInboundStats("7d", provider, store);
    expect(inbound.total).toBe(count);
    expect(inbound.top_senders).toEqual([{ from_address: `${provider}@example.test`, cnt: count }]);
  }
  expect((await getInboundStats("7d", undefined, store)).total).toBe(before + 4);
}
