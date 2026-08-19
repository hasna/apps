// Agent-authored (TEST-GAP protocol): the gpt-5.6-sol consult terminated twice without delivering a spec (session died mid-audit; resume timed out), so the additions to this file carry no SOL attribution.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DATA_DIR, DeliveryLedger, resolveAnnounceDataDir } from "./ledger.js";

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

  it("derives the announcement sentAt from the newest delivery across channels", async () => {
    const ledger = tempLedger();
    await ledger.append({
      campaignId: "c-sentat",
      appId: "a",
      channel: "email",
      status: "sent",
      at: "2026-07-06T10:00:00.000Z",
      deliveredAt: "2026-07-06T10:01:00.000Z",
    });
    await ledger.append({
      campaignId: "c-sentat",
      appId: "a",
      channel: "telegram",
      status: "sent",
      at: "2026-07-06T10:05:00.000Z",
      deliveredAt: "2026-07-06T10:06:00.000Z",
    });
    await ledger.append({
      campaignId: "c-sentat",
      appId: "a",
      channel: "sms",
      status: "failed",
      detail: "no adapter",
      at: "2026-07-06T10:09:00.000Z",
    });
    const document = await ledger.toAnnouncementDocument({
      campaignId: "c-sentat",
      appId: "a",
      release: {
        appId: "a",
        package: "@hasna/todos",
        version: "1.0.0",
        gitSha: "abc1234",
        publishedAt: new Date().toISOString(),
        publishPath: "backfilled",
      },
      audience: { audienceId: "developers" },
      channels: ["email", "telegram", "sms"],
      title: "t",
      links: [],
      createdAt: "2026-07-06T09:00:00.000Z",
    });
    expect(document.sentAt).toBe("2026-07-06T10:09:00.000Z");
    expect(document.metadata?.deliveryChannels).toEqual(["email", "telegram", "sms"]);
    expect(document.metadata?.simulated).toBe(false);
    // Failed channels carry their detail; sent channels carry deliveredAt.
    const sms = document.channels.find((channel) => channel.channel === "other")!;
    expect(sms.status).toBe("failed");
    expect(sms.detail).toBe("no adapter");
  });

  it("surfaces a hand-written corrupt JSONL line instead of silently dropping it", async () => {
    // The JSONL contract is enforced at append time; a hand-written corrupt
    // line must surface on read (throw) rather than silently shortening the
    // ledger, which would make engagement totals quietly wrong.
    const ledger = tempLedger();
    writeFileSync(
      ledger.filePath,
      JSON.stringify({ campaignId: "c-bad", appId: "a", channel: "email", status: "sent", deliveredAt: "2026-07-06T10:00:00.000Z", simulated: false, at: "2026-07-06T10:00:00.000Z" }) + "\n" + "{truncated json line\n",
      "utf8",
    );
    await expect(ledger.list("c-bad")).rejects.toThrow();
  });
});

describe("resolveAnnounceDataDir", () => {
  it("uses the env value only when it trims to non-empty, and falls back to the default otherwise", () => {
    expect(resolveAnnounceDataDir("/tmp/announce-dir")).toBe("/tmp/announce-dir");
    expect(resolveAnnounceDataDir("   ")).toBe(DEFAULT_DATA_DIR);
    expect(resolveAnnounceDataDir("")).toBe(DEFAULT_DATA_DIR);
    expect(resolveAnnounceDataDir(undefined)).toBe(DEFAULT_DATA_DIR);
  });

  it("PINNED BEHAVIOR: passes a whitespace-padded value through untrimmed", () => {
    // The guard trims for the emptiness check but returns the raw value, so a
    // padded ANNOUNCE_DATA_DIR lands on disk with the padding intact. Pinned
    // so a normalization fix is a visible behavior change.
    expect(resolveAnnounceDataDir("  /tmp/announce-dir  ")).toBe("  /tmp/announce-dir  ");
  });
});
