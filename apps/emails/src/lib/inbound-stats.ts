import type { EmailStore } from "../store/email-store.js";
import { createConfiguredEmailStore } from "../store-resolution.js";
import { enumerateStorePages } from "./status-facts-enumeration.js";

export interface InboundStats {
  period: string;
  total: number;
  with_attachments: number;
  top_senders: Array<{ from_address: string; cnt: number }>;
  complete: boolean;
}

/** Count the unified inbound stream, following API cursors instead of opening a client DB. */
export async function getInboundStats(period = "30d", providerId?: string, store: EmailStore = createConfiguredEmailStore()): Promise<InboundStats> {
  if (!/^[1-9]\d*d$/.test(period)) throw new Error("Period must be a positive number of days, for example 7d or 30d.");
  if (providerId) throw new Error("Inbound messages do not carry a provider ID; omit --provider to report all inbound mail.");
  const since = new Date(Date.now() - Number(period.slice(0, -1)) * 86_400_000).toISOString();
  const result = await enumerateStorePages(
    (page) => store.messages.listMessages({ ...page, direction: "inbound", since }),
    { idOf: (row) => row.id },
  );
  if (result.refusal) throw new Error(result.refusal.message);
  if (result.fault) throw new Error(result.fault);
  const senders = new Map<string, number>();
  for (const row of result.rows) senders.set(row.from_addr, (senders.get(row.from_addr) ?? 0) + 1);
  return {
    period,
    total: result.rows.length,
    with_attachments: result.rows.filter((row) => row.attachment_count > 0).length,
    top_senders: [...senders].map(([from_address, cnt]) => ({ from_address, cnt }))
      .sort((a, b) => b.cnt - a.cnt || a.from_address.localeCompare(b.from_address)).slice(0, 5),
    complete: result.complete,
  };
}

export function formatInboundStats(report: InboundStats): string {
  const count = (value: number) => `${report.complete ? "" : "≥"}${value}`;
  return ["\nInbound Email Stats:", `  Period: ${report.period}`,
    `  Total received: ${count(report.total)}`, `  With attachments: ${count(report.with_attachments)}`,
    "", "  Top senders:", ...report.top_senders.map((row) => `    ${row.from_address}: ${count(row.cnt)}`),
    ...(report.complete ? [] : ["  Partial inventory: counts are lower bounds; sender rankings may change."]), ""].join("\n");
}
