import { describe, expect, it } from "bun:test";
import { AnnouncementSchema, ResourcePointerSchema, parseAnnouncement, parseReleaseRecord } from "./contracts.js";

const validAnnouncement = {
  schema: "hasna.announcement.v1",
  id: "ann-1",
  createdAt: "2026-07-06T10:00:00.000Z",
  campaignId: "camp-1",
  appId: "open-todos",
  releaseRef: { kind: "release", id: "@hasna/todos@1.2.3" },
  channels: [{ channel: "email", status: "sent", deliveredAt: "2026-07-06T10:05:00.000Z" }],
  audienceRef: { kind: "audience", id: "developers" },
  sentAt: "2026-07-06T10:05:00.000Z",
};

const validRelease = {
  appId: "open-todos",
  package: "@hasna/todos",
  version: "1.2.3",
  gitSha: "abc1234",
  publishedAt: "2026-07-06T09:00:00.000Z",
  publishPath: "ci",
  evidenceRefs: [{ id: "ev-1", summary: "bun test green" }],
};

describe("AnnouncementSchema (hasna.announcement.v1 mirror)", () => {
  it("accepts a valid announcement document", () => {
    expect(parseAnnouncement(validAnnouncement).campaignId).toBe("camp-1");
  });

  it("rejects unknown keys (strict contract)", () => {
    expect(() => parseAnnouncement({ ...validAnnouncement, extra: true })).toThrow();
  });

  it("requires deliveredAt when a channel status is sent", () => {
    const doc = { ...validAnnouncement, channels: [{ channel: "email", status: "sent" }] };
    expect(() => parseAnnouncement(doc)).toThrow(/deliveredAt/);
  });

  it("requires detail when a channel status is failed", () => {
    const doc = { ...validAnnouncement, channels: [{ channel: "telegram", status: "failed" }] };
    expect(() => parseAnnouncement(doc)).toThrow(/detail/);
  });

  it("requires releaseRef.kind to be release", () => {
    const doc = { ...validAnnouncement, releaseRef: { kind: "app", id: "x" } };
    expect(() => parseAnnouncement(doc)).toThrow(/releaseRef/);
  });

  it("requires audienceRef.kind to be audience", () => {
    const doc = { ...validAnnouncement, audienceRef: { kind: "release", id: "x" } };
    expect(() => parseAnnouncement(doc)).toThrow(/audienceRef/);
  });

  it("requires at least one channel", () => {
    const result = AnnouncementSchema.safeParse({ ...validAnnouncement, channels: [] });
    expect(result.success).toBe(false);
  });

  it("rejects non-UTC timestamps (canonical timestamps are UTC-only)", () => {
    expect(() => parseAnnouncement({ ...validAnnouncement, sentAt: "2026-07-06T13:05:00.000+03:00" })).toThrow();
    expect(() =>
      parseReleaseRecord({ ...validRelease, publishedAt: "2026-07-06T12:00:00.000+03:00" }),
    ).toThrow();
  });
});

describe("ResourcePointerSchema (canonical mirror)", () => {
  it("requires both sourcePackage and externalId when a package locator is used without a uri", () => {
    // The exact drift class the vendored mirror previously let through.
    const sourceOnly = ResourcePointerSchema.safeParse({
      kind: "release",
      id: "@hasna/todos@1.2.3",
      sourcePackage: "@hasna/todos",
    });
    expect(sourceOnly.success).toBe(false);
    const externalOnly = ResourcePointerSchema.safeParse({
      kind: "release",
      id: "@hasna/todos@1.2.3",
      externalId: "@hasna/todos@1.2.3",
    });
    expect(externalOnly.success).toBe(false);
    const both = ResourcePointerSchema.safeParse({
      kind: "release",
      id: "@hasna/todos@1.2.3",
      sourcePackage: "@hasna/todos",
      externalId: "@hasna/todos@1.2.3",
    });
    expect(both.success).toBe(true);
    const idOnly = ResourcePointerSchema.safeParse({ kind: "audience", id: "developers" });
    expect(idOnly.success).toBe(true);
  });

  it("rejects non-canonical resource kinds (e.g. \"changelog\") and non-allowlisted uri schemes", () => {
    expect(
      ResourcePointerSchema.safeParse({ kind: "changelog", id: "open-todos@1.2.3" }).success,
    ).toBe(false);
    expect(
      ResourcePointerSchema.safeParse({ kind: "document", id: "x", uri: "ftp://example.com/changelog" }).success,
    ).toBe(false);
    expect(
      ResourcePointerSchema.safeParse({ kind: "document", id: "x", uri: "https://example.com/changelog" }).success,
    ).toBe(true);
  });
});

describe("cross-validation against @hasna/contracts examples", () => {
  // Mirror of examples/announcement.valid.json on open-contracts
  // feat/distribution-schemas (commit 2dc7de12cbc014f382a43db4a6407ad3c9f0b36e).
  const canonicalValidExample = {
    schema: "hasna.announcement.v1",
    id: "announcement_open_todos_0_11_63",
    createdAt: "2026-07-06T11:00:00.000Z",
    campaignId: "campaign_release_open_todos_0_11_63",
    appId: "open-todos",
    releaseRef: {
      kind: "release",
      id: "release_open_todos_0_11_63",
      sourcePackage: "@hasna/contracts",
      externalId: "release_open_todos_0_11_63",
    },
    channels: [
      { channel: "email", status: "sent", deliveredAt: "2026-07-06T11:05:00.000Z" },
      { channel: "telegram", status: "skipped", detail: "audience has no telegram members" },
    ],
    audienceRef: { kind: "audience", id: "audience_oss_operators" },
    sentAt: "2026-07-06T11:05:00.000Z",
  };

  // Mirror of examples/announcement.invalid.json (bad audienceRef kind).
  const canonicalInvalidExample = {
    schema: "hasna.announcement.v1",
    id: "announcement_bad_audience_ref_kind",
    createdAt: "2026-07-06T11:00:00.000Z",
    campaignId: "campaign_release_open_todos_0_11_63",
    appId: "open-todos",
    channels: [{ channel: "email", status: "sent", deliveredAt: "2026-07-06T11:05:00.000Z" }],
    audienceRef: { kind: "task", id: "audience_oss_operators" },
    sentAt: "2026-07-06T11:05:00.000Z",
  };

  it("accepts the canonical valid announcement example", () => {
    expect(parseAnnouncement(canonicalValidExample).campaignId).toBe("campaign_release_open_todos_0_11_63");
  });

  it("rejects the canonical invalid announcement example", () => {
    expect(AnnouncementSchema.safeParse(canonicalInvalidExample).success).toBe(false);
  });
});

describe("ReleaseRecordSchema (hasna.release.v1 mirror)", () => {
  it("accepts a valid release record", () => {
    expect(parseReleaseRecord(validRelease).version).toBe("1.2.3");
  });

  it("rejects a non-slug appId", () => {
    expect(() => parseReleaseRecord({ ...validRelease, appId: "Open Todos" })).toThrow();
  });

  it("rejects a non-semver version", () => {
    expect(() => parseReleaseRecord({ ...validRelease, version: "1.2" })).toThrow();
  });

  it("requires evidenceRefs unless backfilled", () => {
    expect(() => parseReleaseRecord({ ...validRelease, evidenceRefs: [] })).toThrow(/evidenceRefs/);
    expect(
      parseReleaseRecord({ ...validRelease, publishPath: "backfilled", evidenceRefs: [] }).publishPath,
    ).toBe("backfilled");
  });
});
