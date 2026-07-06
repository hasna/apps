import { describe, expect, it } from "bun:test";
import { AnnouncementSchema, parseAnnouncement, parseReleaseRecord } from "./contracts.js";

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
