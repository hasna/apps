// Agent-authored (TEST-GAP protocol): the gpt-5.6-sol consult terminated
// twice without delivering a spec (session died mid-audit; resume timed out),
// so this file carries no SOL attribution.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeAnnouncementCampaign } from "./compose.js";
import { CampaignStore } from "./campaigns.js";
import type { AnnouncementCampaign, ReleaseRecord } from "../types.js";

const release: ReleaseRecord = {
  appId: "open-todos",
  package: "@hasna/todos",
  version: "1.2.3",
  gitSha: "abc1234",
  publishedAt: "2026-07-06T09:00:00.000Z",
  publishPath: "ci",
  changelogRef: { kind: "document", id: "open-todos@1.2.3", uri: "https://example.com/changelog" },
  evidenceRefs: [{ id: "ev-1" }],
};

function makeCampaign(campaignId = "camp-store-1"): AnnouncementCampaign {
  return composeAnnouncementCampaign({
    release,
    highlights: ["Faster sync"],
    audience: { audienceId: "developers", name: "Developers" },
    channels: ["email", "telegram"],
    campaignId,
  });
}

function tempStore(): CampaignStore {
  return new CampaignStore({ dataDir: mkdtempSync(join(tmpdir(), "announce-store-")) });
}

describe("CampaignStore", () => {
  it("round-trips a campaign through save and load with full fidelity", async () => {
    const store = tempStore();
    const campaign = makeCampaign();
    const savedTo = await store.save(campaign);
    expect(savedTo.endsWith(`${campaign.campaignId}.json`)).toBe(true);

    const loaded = await store.load(campaign.campaignId);
    expect(loaded).toEqual(campaign);
  });

  it("returns null for a campaign that was never saved", async () => {
    const store = tempStore();
    expect(await store.load("never-saved")).toBeNull();
  });

  it("lists only stored campaign ids, sorted", async () => {
    const store = tempStore();
    await store.save(makeCampaign("camp-z"));
    await store.save(makeCampaign("camp-a"));
    await store.save(makeCampaign("camp-m"));
    // A non-JSON file in the campaigns dir must not appear in the listing.
    writeFileSync(join(store.dir, "notes.txt"), "not a campaign\n", "utf8");
    expect(await store.list()).toEqual(["camp-a", "camp-m", "camp-z"]);
  });

  it("rejects campaign ids that could escape the campaigns directory", async () => {
    const store = tempStore();
    const campaign = makeCampaign();
    for (const badId of ["../evil", "has space", "-leading-dash", ".hidden", "a/b"]) {
      await expect(store.save({ ...campaign, campaignId: badId })).rejects.toThrow(/Invalid campaign id/);
      await expect(store.load(badId)).rejects.toThrow(/Invalid campaign id/);
    }
  });

  it("persists pretty-printed JSON with a trailing newline", async () => {
    const store = tempStore();
    const campaign = makeCampaign("camp-pretty");
    await store.save(campaign);
    const raw = readFileSync(join(store.dir, "camp-pretty.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain(`"campaignId": "camp-pretty"`);
    expect(JSON.parse(raw)).toEqual(campaign);
  });

  it("propagates a parse error for corrupt JSON instead of returning a fake empty result", async () => {
    const store = tempStore();
    writeFileSync(join(store.dir, "camp-corrupt.json"), "{not json\n", "utf8");
    await expect(store.load("camp-corrupt")).rejects.toThrow();
  });

  it("rejects stored campaigns that no longer validate against the campaign schema", async () => {
    const store = tempStore();
    // Valid JSON, but the campaign schema requires at least one channel.
    writeFileSync(
      join(store.dir, "camp-invalid.json"),
      JSON.stringify({ ...makeCampaign("camp-invalid"), channels: [] }),
      "utf8",
    );
    await expect(store.load("camp-invalid")).rejects.toThrow();
  });
});
