import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryLedger } from "./ledger.js";

function tempLedger(): DeliveryLedger {
  return new DeliveryLedger({ dataDir: mkdtempSync(join(tmpdir(), "announce-ledger-")) });
}

describe("DeliveryLedger", () => {
  it("appends and lists entries per campaign", async () => {
    const ledger = tempLedger();
    await ledger.append({ campaignId: "c1", appId: "open-todos", channel: "email", status: "pending" });
    await ledger.append({ campaignId: "c2", appId: "open-todos", channel: "email", status: "pending" });
    expect(await ledger.list("c1")).toHaveLength(1);
    expect(await ledger.list()).toHaveLength(2);
  });

  it("channelStatus returns the latest entry per channel", async () => {
    const ledger = tempLedger();
    await ledger.append({ campaignId: "c1", appId: "a", channel: "email", status: "pending" });
    await ledger.append({
      campaignId: "c1",
      appId: "a",
      channel: "email",
      status: "sent",
      deliveredAt: new Date().toISOString(),
    });
    await ledger.append({ campaignId: "c1", appId: "a", channel: "telegram", status: "queued" });
    const status = await ledger.channelStatus("c1");
    expect(status.get("email")!.status).toBe("sent");
    expect(status.get("telegram")!.status).toBe("queued");
  });

  it("enforces the contract delivery rules at write time", async () => {
    const ledger = tempLedger();
    await expect(
      ledger.append({ campaignId: "c1", appId: "a", channel: "email", status: "sent" }),
    ).rejects.toThrow(/deliveredAt/);
    await expect(
      ledger.append({ campaignId: "c1", appId: "a", channel: "email", status: "failed" }),
    ).rejects.toThrow(/detail/);
  });

  it("throws when building a document for an unknown campaign", async () => {
    const ledger = tempLedger();
    await expect(
      ledger.toAnnouncementDocument({
        campaignId: "missing",
        appId: "open-todos",
        release: {
          appId: "open-todos",
          package: "@hasna/todos",
          version: "1.0.0",
          gitSha: "abc1234",
          publishedAt: new Date().toISOString(),
          publishPath: "backfilled",
        },
        audience: { audienceId: "developers" },
        channels: ["email"],
        title: "t",
        links: [],
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/No ledger entries/);
  });
});
