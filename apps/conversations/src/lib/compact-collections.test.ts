import { describe, expect, test } from "bun:test";
import type { AgentPresence, ChannelMember, ChannelNotificationSubscription, Session } from "../types.js";
import {
  DEFAULT_COLLECTION_MAX_BYTES,
  buildCompactCollectionEnvelope,
  summarizeAgent,
  summarizeChannelMember,
  summarizeChannelSubscription,
  summarizeSession,
} from "./compact-output.js";

const sort = { sort: "created_at", direction: "asc" } as const;

function expectBoundedPage(envelope: Record<string, any>, collection: string): void {
  const serialized = JSON.stringify(envelope);
  expect(Buffer.byteLength(serialized, "utf8")).toBe(envelope.byte_length);
  expect(envelope.byte_length).toBeLessThanOrEqual(DEFAULT_COLLECTION_MAX_BYTES);
  expect(envelope.count).toBe(envelope[collection].length);
  expect(envelope.has_more).toBe(envelope.next_cursor !== null);
  if (envelope.has_more) expect(envelope.next_cursor).toBe(envelope.cursor + envelope.count);
  expect(serialized).not.toContain("\n");
}

describe("large compact collection envelopes", () => {
  test("agents stay under 48 KiB and continue without gaps", () => {
    const agents: AgentPresence[] = Array.from({ length: 2_000 }, (_, index) => ({
      id: `agent-${index}`,
      agent: `agent-${index}-${"a".repeat(400)}`,
      session_id: `session-${index}`,
      role: `role-${"r".repeat(300)}`,
      project_id: `project-${"p".repeat(300)}`,
      status: `status-${"s".repeat(500)}`,
      last_seen_at: "2026-09-19T00:00:00.000Z",
      created_at: "2026-09-19T00:00:00.000Z",
      online: index % 2 === 0,
      metadata: { omitted: "m".repeat(10_000) },
    }));
    const first = buildCompactCollectionEnvelope({
      collection: "agents", items: agents, summarize: summarizeAgent,
      limit: 500, sort, hint: "continue",
    });
    expectBoundedPage(first, "agents");
    expect(first.limit).toBe(100);
    expect(first.limit_capped).toBe(true);
    const second = buildCompactCollectionEnvelope({
      collection: "agents", items: agents, summarize: summarizeAgent,
      cursor: first.next_cursor, limit: 100, sort, hint: "continue",
    });
    expectBoundedPage(second, "agents");
    expect(second.cursor).toBe(first.count);
  });

  test("sessions byte-trim oversized participant populations truthfully", () => {
    const sessions: Session[] = Array.from({ length: 300 }, (_, index) => ({
      session_id: `session-${index}-${"s".repeat(300)}`,
      participants: Array.from({ length: 40 }, (__, participant) => `participant-${participant}-${"p".repeat(300)}`),
      last_message_at: "2026-09-19T00:00:00.000Z",
      message_count: index + 1,
      unread_count: index % 5,
    }));
    const page = buildCompactCollectionEnvelope({
      collection: "sessions", items: sessions, summarize: summarizeSession,
      limit: 100, sort, hint: "continue",
    });
    expectBoundedPage(page, "sessions");
    expect(page.count).toBeLessThan(100);
    expect(page.has_more).toBe(true);
    expect((page.sessions as any[])[0].participants).toHaveLength(8);
    expect((page.sessions as any[])[0].participants_truncated).toBe(true);
  });

  test("members and subscriptions cap untrusted string fields", () => {
    const members: ChannelMember[] = Array.from({ length: 1_000 }, (_, index) => ({
      channel: `channel-${"c".repeat(400)}`,
      agent: `agent-${index}-${"a".repeat(400)}`,
      joined_at: "2026-09-19T00:00:00.000Z",
    }));
    const subscriptions: ChannelNotificationSubscription[] = members.map((member, index) => ({
      channel: member.channel,
      agent: member.agent,
      created_at: member.joined_at,
      preview_chars: 160,
      since_message_id: index,
    }));
    const memberPage = buildCompactCollectionEnvelope({
      collection: "members", items: members, summarize: summarizeChannelMember,
      limit: 100, sort, hint: "continue",
    });
    const subscriptionPage = buildCompactCollectionEnvelope({
      collection: "subscriptions", items: subscriptions, summarize: summarizeChannelSubscription,
      limit: 100, sort, hint: "continue",
    });
    expectBoundedPage(memberPage, "members");
    expectBoundedPage(subscriptionPage, "subscriptions");
    expect((memberPage.members as any[])[0].agent.length).toBeLessThanOrEqual(96);
    expect((subscriptionPage.subscriptions as any[])[0].channel.length).toBeLessThanOrEqual(96);
  });
});
