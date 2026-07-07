import { describe, expect, it } from "bun:test";
import { composeAnnouncementCampaign } from "./compose.js";
import type { ReleaseRecord } from "../types.js";

const release: ReleaseRecord = {
  appId: "open-todos",
  package: "@hasna/todos",
  version: "1.2.3",
  gitSha: "abc1234",
  publishedAt: "2026-07-06T09:00:00.000Z",
  publishPath: "ci",
  changelogRef: {
    kind: "document",
    id: "open-todos@1.2.3",
    uri: "https://github.com/hasna/open-todos/releases/tag/v1.2.3",
  },
  evidenceRefs: [{ id: "ev-1" }],
};

describe("composeAnnouncementCampaign", () => {
  it("composes a campaign from a release record + changelog ref", () => {
    const campaign = composeAnnouncementCampaign({
      release,
      highlights: ["Faster sync", "New CLI flags"],
      audience: { audienceId: "developers", name: "Developers" },
      channels: ["email", "telegram"],
    });
    expect(campaign.appId).toBe("open-todos");
    expect(campaign.title).toBe("open-todos 1.2.3 released");
    expect(campaign.channels).toEqual(["email", "telegram"]);
    expect(campaign.changelog?.ref.uri).toContain("releases/tag/v1.2.3");
    expect(campaign.changelog?.highlights).toEqual(["Faster sync", "New CLI flags"]);
    expect(campaign.links.map((link) => link.label)).toEqual(["Changelog", "Package"]);
    expect(campaign.campaignId).toMatch(/^camp-open-todos-1\.2\.3-/);
  });

  it("uses release.changelogRef when no explicit ref is passed", () => {
    const campaign = composeAnnouncementCampaign({
      release,
      audience: { audienceId: "developers" },
      channels: ["email"],
    });
    expect(campaign.changelog?.ref.id).toBe("open-todos@1.2.3");
  });

  it("supports deferred changelog refs (release without changelogRef)", () => {
    const campaign = composeAnnouncementCampaign({
      release: { ...release, changelogRef: undefined },
      audience: { audienceId: "developers" },
      channels: ["email"],
    });
    expect(campaign.changelog).toBeUndefined();
    expect(campaign.links.map((link) => link.label)).toEqual(["Package"]);
  });

  it("rejects invalid release records", () => {
    expect(() =>
      composeAnnouncementCampaign({
        release: { ...release, version: "not-semver" },
        audience: { audienceId: "developers" },
        channels: ["email"],
      }),
    ).toThrow();
  });

  it("rejects unsupported channels and empty channel lists", () => {
    expect(() =>
      composeAnnouncementCampaign({
        release,
        audience: { audienceId: "developers" },
        channels: ["carrier-pigeon" as never],
      }),
    ).toThrow(/Unsupported delivery channel/);
    expect(() =>
      composeAnnouncementCampaign({ release, audience: { audienceId: "developers" }, channels: [] }),
    ).toThrow(/at least one/i);
  });

  it("normalizes scheduledAt to ISO and rejects invalid datetimes", () => {
    const campaign = composeAnnouncementCampaign({
      release,
      audience: { audienceId: "developers" },
      channels: ["email"],
      scheduledAt: "2026-07-08T09:00:00Z",
    });
    expect(campaign.scheduledAt).toBe("2026-07-08T09:00:00.000Z");
    expect(() =>
      composeAnnouncementCampaign({
        release,
        audience: { audienceId: "developers" },
        channels: ["email"],
        scheduledAt: "not-a-date",
      }),
    ).toThrow(/scheduledAt/);
  });
});
