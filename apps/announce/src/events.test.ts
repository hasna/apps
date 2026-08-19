// Agent-authored (TEST-GAP protocol): the gpt-5.6-sol consult terminated
// twice without delivering a spec (session died mid-audit; resume timed out),
// so this file carries no SOL attribution.
import { describe, expect, it } from "bun:test";
import {
  ANNOUNCEMENT_SENT_CONTRACT_SCHEMA,
  ANNOUNCEMENT_SENT_EVENT_TYPE,
  EVENT_SOURCE,
  buildAnnouncementSentEvent,
} from "./events.js";
import { composeAnnouncementCampaign } from "./lib/compose.js";
import type { ReleaseRecord } from "./types.js";

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

const campaign = composeAnnouncementCampaign({
  release,
  audience: { audienceId: "developers" },
  channels: ["email", "telegram", "sms"],
  campaignId: "camp-events-1",
});

describe("buildAnnouncementSentEvent", () => {
  it("builds a well-formed announcement.sent envelope", () => {
    const event = buildAnnouncementSentEvent(campaign);
    expect(event.source).toBe(EVENT_SOURCE);
    expect(event.type).toBe(ANNOUNCEMENT_SENT_EVENT_TYPE);
    // The subject is the campaign id and the dedupe key derives from it, so a
    // duplicate send of the same campaign collapses at the event layer.
    expect(event.subject).toBe("camp-events-1");
    expect(event.dedupeKey).toBe("announcement.sent:camp-events-1");
    expect(event.metadata?.contractSchema).toBe(ANNOUNCEMENT_SENT_CONTRACT_SCHEMA);
    expect(event.data).toEqual({
      campaignId: "camp-events-1",
      appId: "open-todos",
      audienceId: "developers",
      releaseId: "@hasna/todos@1.2.3",
      channels: ["email", "telegram", "sms"],
    });
  });

  it("defaults the envelope time to the injected sentAt option", () => {
    const sentAt = "2026-07-06T10:05:00.000Z";
    const event = buildAnnouncementSentEvent(campaign, { sentAt });
    expect(event.time).toBe(sentAt);
  });

  it("lets the caller restrict the reported channels to what was actually sent", () => {
    const event = buildAnnouncementSentEvent(campaign, { channels: ["email"] });
    expect(event.data.channels).toEqual(["email"]);
    // The campaign-level channel list is untouched by the override.
    expect(campaign.channels).toEqual(["email", "telegram", "sms"]);
  });
});
