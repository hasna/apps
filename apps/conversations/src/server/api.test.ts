import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startApiServer, type ApiServerDeps } from "./api.js";
import { mintApiKey } from "@hasna/contracts/auth";
import { verifyApiKey, ApiKeyStore, type ApiKeyStatus } from "@hasna/contracts/auth";
import { gzipSync } from "node:zlib";
import { createHasnaHttpTransport } from "../lib/contracts-client/transport.js";
import { createHasnaStorageClient } from "../lib/contracts-client/storage.js";
import { ApiStore } from "../lib/store/api-store.js";

// In-memory query shim standing in for the vendored kit's TypedQueryClient.
// Exercises the router + auth without a live Postgres.
function makeFakeClient(
  initialProjects: Array<Record<string, any>> = [
    { id: "proj-valid", name: "Chief of Harness" },
  ],
  opts: { messageCreatedAtAsDate?: boolean } = {},
) {
  const channels: Record<string, any> = {};
  const channelAliases: Record<string, string> = {};
  const channelMembers = new Set<string>();
  const messages: any[] = [];
  const reactions: any[] = [];
  const messageAttachments: any[] = [];
  const messageMentions: any[] = [];
  const channelSubscriptions: any[] = [];
  const channelNotificationReads: any[] = [];
  const tasks: any[] = [];
  const graphEdges: any[] = [];
  const resourceLocks: any[] = [];
  const linkageReceipts: any[] = [];
  const agentPresence = new Map<string, any>();
  const manyCalls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const queryCalls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const scopeRewriteCalls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const projects: Record<string, any> = Object.fromEntries(
    initialProjects.map((project) => [project.id, { ...project }]),
  );
  let nextId = 1;
  let nextMessageCreatedAtAsDate = false;
  let failRenameAt: RegExp | null = null;
  let failChannelMemberInsert = false;
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  };
  let transactionTail = Promise.resolve();
  let pendingTransactions = 0;
  let linkageBulkRace: null | {
    paused: ReturnType<typeof deferred>;
    release: ReturnType<typeof deferred>;
    concurrentAttempt: ReturnType<typeof deferred>;
    pauseConsumed: boolean;
  } = null;
  const client = {
    async many(sql: string, _p: readonly unknown[] = []): Promise<any[]> {
      manyCalls.push({ sql, params: [..._p] });
      if (/SELECT td\.depends_on_id, t\.subject, t\.status FROM task_dependencies/i.test(sql)) {
        // start-action blocked-dependency check: return incomplete deps of the task.
        const taskId = Number(_p[0]);
        const task = tasks.find((t) => Number(t.id) === taskId);
        const deps: number[] = task?.depends_on ?? [];
        return deps
          .map((depId) => tasks.find((t) => Number(t.id) === Number(depId)))
          .filter((dep): dep is any => dep !== undefined && dep.status !== "completed")
          .map((dep) => ({ depends_on_id: Number(dep.id), subject: dep.subject, status: dep.status }));
      }
      if (/SELECT td\.task_id, t\.status FROM task_dependencies/i.test(sql)) {
        // unblockDependents dependent list: tasks that depend on the completed id.
        const depId = Number(_p[0]);
        return tasks
          .filter((t) => (t.depends_on ?? []).some((id: number) => Number(id) === depId))
          .map((t) => ({ task_id: Number(t.id), status: t.status }));
      }
      if (/SELECT uuid FROM messages WHERE uuid = ANY/i.test(sql)) {
        const uuids = new Set((_p[0] as string[] | undefined) ?? []);
        return messages
          .filter((message) => uuids.has(String(message.uuid)))
          .map((message) => ({ uuid: message.uuid }));
      }
      if (/SELECT id, channel, session_id FROM messages WHERE id = ANY/i.test(sql)) {
        const ids = new Set((_p[0] as number[] | undefined) ?? []);
        return messages
          .filter((message) => ids.has(Number(message.id)))
          .map((message) => ({
            id: message.id,
            channel: message.channel ?? null,
            session_id: message.session_id,
          }));
      }
      if (/FROM resource_locks(?:\s+l)?/i.test(sql)) {
        let rows = resourceLocks.slice();
        const resourceTypeParam = sql.match(/(?:l\.)?resource_type = \$(\d+)/i);
        const resourceIdParam = sql.match(/(?:l\.)?resource_id = \$(\d+)/i);
        // Holder-identity filters mirror the SQL shape: LOWER() comparisons are
        // case-insensitive (the server's canonical form since 13425e5c), the
        // bare `agent_id = $n` form is case-sensitive like Postgres.
        const lowerAgentIdParam = sql.match(/LOWER\((?:l\.)?agent_id\)\s*=\s*LOWER\(\$(\d+)\)/i);
        const exactAgentIdParam = sql.match(/(?:l\.)?agent_id = \$(\d+)/i);
        if (resourceTypeParam) rows = rows.filter((row) => row.resource_type === _p[Number(resourceTypeParam[1]) - 1]);
        if (resourceIdParam) rows = rows.filter((row) => row.resource_id === _p[Number(resourceIdParam[1]) - 1]);
        if (lowerAgentIdParam) {
          const agentParam = String(_p[Number(lowerAgentIdParam[1]) - 1]).toLowerCase();
          rows = rows.filter((row) => String(row.agent_id).toLowerCase() === agentParam);
        } else if (exactAgentIdParam) {
          rows = rows.filter((row) => row.agent_id === _p[Number(exactAgentIdParam[1]) - 1]);
        }
        rows.sort((a, b) => String(a.locked_at).localeCompare(String(b.locked_at)));
        if (/LEFT JOIN agent_presence/i.test(sql)) {
          const now = Date.now();
          return rows.map((row) => {
            const presence = agentPresence.get(String(row.agent_id).toLowerCase());
            const lastSeen = presence?.last_seen_at ? Date.parse(String(presence.last_seen_at)) : Number.NaN;
            return {
              ...row,
              locked_seconds_ago: Math.round((now - Date.parse(String(row.locked_at))) / 1000),
              expires_in_seconds: Math.round((Date.parse(String(row.expires_at)) - now) / 1000),
              p_role: presence?.role ?? null,
              p_status: presence?.status ?? null,
              p_last_seen: presence?.last_seen_at ?? null,
              p_project: presence?.project_id ?? null,
              p_online: Number.isFinite(lastSeen) && now - lastSeen < 60_000,
            };
          });
        }
        return rows;
      }
      // Project list SQL contains a channel-count subquery, so identify the
      // outer projects query before the broader channel matcher below.
      if (/FROM projects/i.test(sql)) {
        let rows = Object.values(projects);
        if (/ORDER BY p\.name ASC/i.test(sql)) {
          rows = rows.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
        }

        const parameterValue = (keyword: "LIMIT" | "OFFSET"): number | undefined => {
          const match = sql.match(new RegExp(`${keyword}\\s+\\$(\\d+)`, "i"));
          if (!match) return undefined;
          const value = Number(_p[Number(match[1]) - 1]);
          return Number.isFinite(value) ? value : undefined;
        };
        const literalValue = (keyword: "LIMIT" | "OFFSET"): number | undefined => {
          const match = sql.match(new RegExp(`${keyword}\\s+(\\d+)`, "i"));
          return match ? Number(match[1]) : undefined;
        };
        const offset = parameterValue("OFFSET") ?? literalValue("OFFSET") ?? 0;
        const limit = parameterValue("LIMIT") ?? literalValue("LIMIT");
        return limit === undefined ? rows.slice(offset) : rows.slice(offset, offset + limit);
      }
      if (/FROM channels/i.test(sql)) {
        return Object.values(channels).map((row) => ({
          ...row,
          member_count: [...channelMembers].filter((entry) => entry.startsWith(`${row.name}:`)).length,
          message_count: messages.filter((message) => message.channel === row.name).length,
        }));
      }
      if (/FROM channel_members/i.test(sql)) {
        const channel = String((_p as any[])[0] ?? "");
        return [...channelMembers]
          .filter((entry) => entry.startsWith(`${channel}:`))
          .map((entry) => {
            const [, agent] = entry.split(":");
            return { channel, agent, joined_at: "2026-07-23T08:15:39.781Z" };
          });
      }
      if (/FROM messages WHERE channel = \$1 ORDER BY id ASC/i.test(sql)) {
        return messages.filter((message) => message.channel === _p[0]).slice().sort((a, b) => a.id - b.id);
      }
      // Work-status dedupe read: apply the channel / reply_to / created_at
      // predicates (the window is bounded on both sides) so the hosted
      // timestamp-window behaviour is actually exercised rather than returning
      // every message.
      if (/FROM messages\s+WHERE channel = \$1 AND reply_to IS NULL/i.test(sql)) {
        const channel = String(_p[0] ?? "");
        const cutoffMatch = sql.match(/created_at >= \$(\d+)/i);
        const upperMatch = sql.match(/created_at <= \$(\d+)/i);
        let rows = messages.filter((row) => row.channel === channel && row.reply_to == null);
        if (cutoffMatch) {
          const cutoff = String(_p[Number(cutoffMatch[1]) - 1]);
          rows = rows.filter((row) => row.created_at >= cutoff);
        }
        if (upperMatch) {
          const upper = String(_p[Number(upperMatch[1]) - 1]);
          rows = rows.filter((row) => row.created_at <= upper);
        }
        return rows.slice().sort((a, b) => b.id - a.id);
      }
      if (/FROM messages/i.test(sql)) return messages.slice().reverse();
      if (/revoked_at IS NOT NULL/i.test(sql)) return [];
      if (/SELECT id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata[\s\S]*AS online\s+FROM agent_presence/i.test(sql)) {
        const onlineOnly = /WHERE last_seen_at > NOW\(\) - interval '60 seconds'/i.test(sql);
        return [...agentPresence.values()]
          .map((row) => ({ ...row, online: Date.parse(String(row.last_seen_at)) > Date.now() - 60_000 }))
          .filter((row) => !onlineOnly || row.online)
          .sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)));
      }
      if (/SELECT id, agent FROM agent_presence[\s\S]*EXTRACT\(EPOCH FROM \(last_seen_at - created_at\)\)/i.test(sql)) {
        const m = sql.match(/interval '(\d+) seconds'/i);
        const olderThanMs = m ? Number(m[1]) * 1000 : 7 * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - olderThanMs;
        return [...agentPresence.values()]
          .filter((row) => {
            const last = Date.parse(String(row.last_seen_at));
            const created = Date.parse(String(row.created_at));
            return Number.isFinite(last) && Number.isFinite(created)
              && last < cutoff
              && Math.abs(last - created) < 60_000;
          })
          .sort((a, b) => String(a.last_seen_at).localeCompare(String(b.last_seen_at)))
          .map((row) => ({ id: row.id, agent: row.agent }));
      }
      if (/SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions WHERE agent = \$1/i.test(sql)) {
        return channelSubscriptions
          .filter((subscription) => subscription.agent === _p[0])
          .slice()
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.channel).localeCompare(String(b.channel)));
      }
      if (/SELECT channel FROM channel_subscriptions WHERE agent = \$1/i.test(sql)) {
        return channelSubscriptions
          .filter((subscription) => subscription.agent === _p[0])
          .map((subscription) => ({ channel: subscription.channel }));
      }
      if (/FROM channel_subscriptions ORDER BY agent ASC, channel ASC/i.test(sql)) {
        return channelSubscriptions.slice().sort(
          (a, b) => String(a.agent).localeCompare(String(b.agent)) || String(a.channel).localeCompare(String(b.channel)),
        );
      }
      if (/FROM reactions\s+WHERE message_id = ANY/i.test(sql)) {
        // Envelope grouped query: message_id = ANY($1::bigint[]) GROUP BY message_id, emoji
        const ids = new Set<number>(((_p as any[])[0] as number[] | undefined) ?? []);
        const byMessage = new Map<number, { emoji: string; agents: string[] }[]>();
        for (const reaction of reactions) {
          const messageId = Number(reaction.message_id);
          if (!ids.has(messageId)) continue;
          const list = byMessage.get(messageId) ?? [];
          const existing = list.find((entry) => entry.emoji === String(reaction.emoji));
          if (existing) existing.agents.push(String(reaction.agent));
          else list.push({ emoji: String(reaction.emoji), agents: [String(reaction.agent)] });
          byMessage.set(messageId, list);
        }
        return [...byMessage.entries()].flatMap(([messageId, list]) =>
          list.map((entry) => ({ message_id: messageId, emoji: entry.emoji, agents: entry.agents.join(","), count: entry.agents.length })),
        );
      }
      if (/FROM reactions/i.test(sql) && /GROUP BY/i.test(sql)) {
        // Grouped summary: SELECT emoji, string_agg(agent, ',') ... GROUP BY emoji
        const messageId = Number((_p as any[])[0] ?? 0);
        const grouped = new Map<string, { emoji: string; agents: string[] }>();
        for (const reaction of reactions) {
          if (Number(reaction.message_id) !== messageId) continue;
          const entry = grouped.get(String(reaction.emoji)) ?? { emoji: String(reaction.emoji), agents: [] as string[] };
          entry.agents.push(String(reaction.agent));
          grouped.set(String(reaction.emoji), entry);
        }
        return [...grouped.values()]
          .map((entry) => ({ emoji: entry.emoji, agents: entry.agents.join(","), count: entry.agents.length }))
          .sort((a, b) => b.count - a.count);
      }
      if (/FROM reactions/i.test(sql)) {
        const messageId = Number((_p as any[])[0] ?? 0);
        return reactions
          .filter((reaction) => Number(reaction.message_id) === messageId)
          .slice()
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id));
      }
      return [];
    },
    async query(sql: string, p: readonly unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
      queryCalls.push({ sql, params: [...p] });
      if (/INSERT INTO conversations_event_outbox/i.test(sql)) {
        const createdAt = p[4];
        if (typeof createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)) {
          throw new Error(`invalid input syntax for type timestamp with time zone: ${String(createdAt)}`);
        }
        return { rows: [], rowCount: 1 };
      }
      if (/DELETE FROM resource_locks WHERE expires_at < NOW\(\)/i.test(sql)) {
        const before = resourceLocks.length;
        const now = Date.now();
        for (let index = resourceLocks.length - 1; index >= 0; index--) {
          if (Date.parse(String(resourceLocks[index].expires_at)) < now) resourceLocks.splice(index, 1);
        }
        return { rows: [], rowCount: before - resourceLocks.length };
      }
      if (/DELETE FROM resource_locks[\s\S]*LOWER\(agent_id\) IN/i.test(sql)) {
        const before = resourceLocks.length;
        const now = Date.now();
        const cutoff = now - 30 * 60 * 1000;
        const requiresStaleLock = /locked_at\s*<\s*NOW\(\)/i.test(sql);
        for (let index = resourceLocks.length - 1; index >= 0; index--) {
          const lock = resourceLocks[index];
          const presence = agentPresence.get(String(lock.agent_id).toLowerCase());
          const stalePresence = presence?.last_seen_at && Date.parse(String(presence.last_seen_at)) < cutoff;
          const staleLock = Date.parse(String(lock.locked_at)) < cutoff;
          if (stalePresence && (!requiresStaleLock || staleLock)) resourceLocks.splice(index, 1);
        }
        return { rows: [], rowCount: before - resourceLocks.length };
      }
      // Canonical release SQL since 13425e5c: LOWER() holder compare (case-insensitive).
      if (/DELETE FROM resource_locks WHERE resource_type = \$1 AND resource_id = \$2 AND LOWER\(agent_id\) = LOWER\(\$3\)/i.test(sql)) {
        const [resourceType, resourceId, agentId] = p as any[];
        const before = resourceLocks.length;
        const agentParam = String(agentId).toLowerCase();
        for (let index = resourceLocks.length - 1; index >= 0; index--) {
          const row = resourceLocks[index];
          if (row.resource_type === resourceType && row.resource_id === resourceId && String(row.agent_id).toLowerCase() === agentParam) {
            resourceLocks.splice(index, 1);
          }
        }
        return { rows: [], rowCount: before - resourceLocks.length };
      }
      // Pre-13425e5c exact-match shape, kept as a mirror: Postgres `agent_id = $3`
      // is case-sensitive, so this branch filters case-sensitively.
      if (/DELETE FROM resource_locks WHERE resource_type = \$1 AND resource_id = \$2 AND agent_id = \$3/i.test(sql)) {
        const [resourceType, resourceId, agentId] = p as any[];
        const before = resourceLocks.length;
        for (let index = resourceLocks.length - 1; index >= 0; index--) {
          const row = resourceLocks[index];
          if (row.resource_type === resourceType && row.resource_id === resourceId && row.agent_id === agentId) {
            resourceLocks.splice(index, 1);
          }
        }
        return { rows: [], rowCount: before - resourceLocks.length };
      }
      if (/DELETE FROM reactions/i.test(sql)) {
        const [messageId, who, emoji] = p as any[];
        const before = reactions.length;
        for (let index = reactions.length - 1; index >= 0; index--) {
          const reaction = reactions[index];
          if (Number(reaction.message_id) === Number(messageId)
            && String(reaction.agent) === String(who)
            && String(reaction.emoji) === String(emoji)) {
            reactions.splice(index, 1);
          }
        }
        return { rows: [], rowCount: before - reactions.length };
      }
      if (/DELETE FROM agent_presence\s+WHERE id = ANY/i.test(sql)) {
        const ids = new Set((p[0] as string[]) ?? []);
        const m = sql.match(/interval '(\d+) seconds'/i);
        const olderThanMs = m ? Number(m[1]) * 1000 : 7 * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - olderThanMs;
        const before = agentPresence.size;
        for (const [agent, row] of [...agentPresence.entries()]) {
          if (ids.has(String(row.id)) && Date.parse(String(row.last_seen_at)) < cutoff) {
            agentPresence.delete(agent);
            activeFakeClient!.__debug.agentPresenceReapArchive.push({ reaped_at: new Date().toISOString(), ...row });
          }
        }
        return { rows: [], rowCount: before - agentPresence.size };
      }
      if (/UPDATE resource_locks SET expires_at = \$4, locked_at = NOW\(\)/i.test(sql)) {
        const [resourceType, resourceId, lockType, expiresAt] = p as any[];
        const row = resourceLocks.find((lock) =>
          lock.resource_type === resourceType &&
          lock.resource_id === resourceId &&
          lock.lock_type === lockType
        );
        if (!row) return { rows: [], rowCount: 0 };
        row.expires_at = expiresAt;
        row.locked_at = new Date().toISOString();
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO resource_locks/i.test(sql)) {
        const [resourceType, resourceId, agentId, lockType, expiresAt] = p as any[];
        resourceLocks.push({
          resource_type: resourceType,
          resource_id: resourceId,
          agent_id: agentId,
          lock_type: lockType,
          locked_at: new Date().toISOString(),
          expires_at: expiresAt,
        });
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO messages/i.test(sql) && /ON CONFLICT/i.test(sql)) {
        // One COALESCE(...) is emitted per row (for created_at) → row count.
        const numRows = (sql.match(/COALESCE\(/g) || []).length || 1;
        const perRow = p.length / numRows;
        let inserted = 0;
        const rows: any[] = [];
        for (let i = 0; i < numRows; i++) {
          const values = (p as any[]).slice(i * perRow, (i + 1) * perRow);
          const [
            uuid, session_id, from_agent, to_agent, channel, project_id,
            content, priority, working_dir, repository, branch, metadata,
            edited_at, pinned_at, blocking, attachments, reply_to,
            created_at, read_at,
          ] = values;
          if (!messages.find((m) => m.uuid === uuid)) {
            const row = {
              id: nextId++, uuid, session_id, from_agent, to_agent, channel,
              project_id, content, priority, working_dir, repository, branch,
              metadata, edited_at, pinned_at, blocking, attachments, reply_to,
              created_at: created_at ?? new Date().toISOString(), read_at,
            };
            messages.push(row);
            rows.push(row);
            inserted++;
          }
        }
        linkageBulkRace?.concurrentAttempt.resolve();
        return { rows, rowCount: inserted };
      }
      if (/INSERT INTO message_mentions/i.test(sql)) {
        const [message_id, mentioned_agent, from_agent, channel] = p as any[];
        const row = { id: messageMentions.length + 1, message_id, mentioned_agent, from_agent, channel };
        messageMentions.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (/INSERT INTO messages/i.test(sql) && /priority, metadata/i.test(sql)) {
        const [uuid, session_id, from_agent, to_agent, content, metadata] = p as any[];
        const row = {
          id: nextId++, uuid, session_id, from_agent, to_agent, channel: null,
          project_id: null, content, priority: "normal", metadata,
          created_at: new Date().toISOString(),
        };
        messages.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (/INSERT INTO channel_members/i.test(sql)) {
        if (failChannelMemberInsert) {
          failChannelMemberInsert = false;
          throw new Error("injected channel member insert failure");
        }
        const [channel, agent] = p as any[];
        channelMembers.add(`${channel}:${agent}`);
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO channel_subscriptions/i.test(sql)) {
        const [channel, agent, previewChars, sinceMessageId] = p as any[];
        const existing = channelSubscriptions.find((row) => row.channel === channel && row.agent === agent);
        if (existing) {
          existing.preview_chars = previewChars;
        } else {
          channelSubscriptions.push({
            channel,
            agent,
            preview_chars: previewChars,
            since_message_id: sinceMessageId,
            created_at: new Date().toISOString(),
          });
        }
        return { rows: [], rowCount: 1 };
      }
      if (/DELETE FROM channel_subscriptions WHERE channel = \$1 AND agent = \$2/i.test(sql)) {
        const [channel, agent] = p as any[];
        const before = channelSubscriptions.length;
        for (let index = channelSubscriptions.length - 1; index >= 0; index--) {
          const row = channelSubscriptions[index];
          if (row.channel === channel && row.agent === agent) channelSubscriptions.splice(index, 1);
        }
        return { rows: [], rowCount: before - channelSubscriptions.length };
      }
      if (/INSERT INTO channel_notification_reads/i.test(sql)) {
        const [agent, messageIds] = p as any[];
        const ids = Array.isArray(messageIds) ? (messageIds as any[]).map(Number) : [];
        let added = 0;
        for (const messageId of ids) {
          const key = `${agent}:${messageId}`;
          if (!channelNotificationReads.some((row) => `${row.agent}:${row.message_id}` === key)) {
            channelNotificationReads.push({ agent, message_id: messageId });
            added++;
          }
        }
        return { rows: [], rowCount: added };
      }
      if (/UPDATE message_mentions SET notified_at/i.test(sql)) {
        const notifiedAt = new Date().toISOString();
        let changed = 0;
        if (/id = ANY\(\$2::bigint\[\]\)/i.test(sql)) {
          const [mentionedAgent, ids] = p as any[];
          const idSet = new Set((ids as any[]).map(Number));
          for (const mention of messageMentions) {
            if (mention.mentioned_agent === mentionedAgent && idSet.has(Number(mention.id)) && !mention.notified_at) {
              mention.notified_at = notifiedAt;
              changed++;
            }
          }
        } else if (/AND channel = \$2/i.test(sql)) {
          const [mentionedAgent, channel] = p as any[];
          for (const mention of messageMentions) {
            if (mention.mentioned_agent === mentionedAgent && mention.channel === channel && !mention.notified_at) {
              mention.notified_at = notifiedAt;
              changed++;
            }
          }
        } else {
          const [mentionedAgent] = p as any[];
          for (const mention of messageMentions) {
            if (mention.mentioned_agent === mentionedAgent && !mention.notified_at) {
              mention.notified_at = notifiedAt;
              changed++;
            }
          }
        }
        return { rows: [], rowCount: changed };
      }
      return { rows: [], rowCount: 0 };
    },
    async get(sql: string, p: readonly unknown[] = []): Promise<any> {
      if (/set_config\('hasna\.conversations\.channel_scope_rewrite'/i.test(sql)) {
        scopeRewriteCalls.push({ sql, params: [...p] });
      }
      if (/SELECT id FROM tasks WHERE/i.test(sql)) {
        const key = p[0];
        const task = tasks.find((t) =>
          typeof key === "number" || /^\d+$/.test(String(key))
            ? Number(t.id) === Number(key)
            : t.uuid === key
        );
        return task ? { id: Number(task.id) } : null;
      }
      if (/SELECT status, priority, reporter FROM tasks WHERE id = \$1/i.test(sql)) {
        const task = tasks.find((t) => Number(t.id) === Number(p[0]));
        return task ? { status: task.status, priority: task.priority, reporter: task.reporter } : null;
      }
      if (/SELECT id, uuid, subject, status, priority, assignee, project_id FROM tasks WHERE id = \$1/i.test(sql)) {
        const task = tasks.find((t) => Number(t.id) === Number(p[0]));
        if (!task) return null;
        return {
          id: Number(task.id),
          uuid: task.uuid,
          subject: task.subject,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee ?? null,
          project_id: task.project_id ?? null,
        };
      }
      if (/SELECT \* FROM tasks WHERE id = \$1/i.test(sql)) {
        return tasks.find((t) => Number(t.id) === Number(p[0])) ?? null;
      }
      if (/SELECT COUNT\(\*\)::int AS c FROM task_dependencies/i.test(sql)) {
        const taskId = Number(p[0]);
        const task = tasks.find((t) => Number(t.id) === taskId);
        const deps: number[] = task?.depends_on ?? [];
        const incomplete = deps.filter((depId: number) => {
          const dep = tasks.find((t) => Number(t.id) === Number(depId));
          return dep !== undefined && dep.status !== "completed";
        });
        return { c: incomplete.length };
      }
      if (/SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions WHERE channel = \$1 AND agent = \$2/i.test(sql)) {
        return channelSubscriptions.find((row) => row.channel === p[0] && row.agent === p[1]) ?? null;
      }
      if (/SELECT 1 AS ok/i.test(sql)) return { ok: 1 };
      if (/SELECT \* FROM resource_locks/i.test(sql)) {
        const [resourceType, resourceId, lockType] = p as any[];
        return resourceLocks
          .filter((row) =>
            row.resource_type === resourceType &&
            row.resource_id === resourceId &&
            (lockType === undefined || row.lock_type === lockType)
          )
          .sort((a, b) => String(a.locked_at).localeCompare(String(b.locked_at)))[0] ?? null;
      }
      if (/FROM channel_project_linkage_receipts WHERE idempotency_key/i.test(sql)) {
        return linkageReceipts.find((receipt) => receipt.idempotency_key === p[0]) ?? null;
      }
      if (/FROM channel_project_linkage_receipts WHERE id =/i.test(sql)) {
        return linkageReceipts.find((receipt) => receipt.id === p[0]) ?? null;
      }
      if (/SELECT id FROM projects WHERE id/i.test(sql)) {
        return projects[(p as any[])[0]] ?? null;
      }
      if (/FROM agent_presence WHERE LOWER\(agent\) = \$1/i.test(sql)) {
        const row = agentPresence.get(String((p as any[])[0]).toLowerCase());
        return row ? { ...row, active: true, online: true } : null;
      }
      if (/UPDATE agent_presence/i.test(sql) && /RETURNING id, agent/i.test(sql)) {
        const [name, session_id, role, project_id] = p as any[];
        const key = String(name).toLowerCase();
        const row = agentPresence.get(key);
        if (!row) return null;
        Object.assign(row, {
          session_id,
          role,
          project_id,
          status: "online",
          last_seen_at: new Date().toISOString(),
          online: true,
        });
        return { ...row };
      }
      if (/INSERT INTO agent_presence/i.test(sql) && /ON CONFLICT/i.test(sql)) {
        const [
          id,
          rawAgent,
          session_id,
          project_id,
          status,
          metadata,
          replaceProjectId = true,
          replaceMetadata = true,
        ] = p as any[];
        const agent = String(rawAgent).toLowerCase();
        const existing = agentPresence.get(agent);
        const conditionallyReplacesProjectId =
          /project_id\s*=\s*CASE WHEN \$7 THEN EXCLUDED\.project_id ELSE agent_presence\.project_id END/i.test(sql);
        const conditionallyReplacesMetadata =
          /metadata\s*=\s*CASE WHEN \$8 THEN EXCLUDED\.metadata ELSE agent_presence\.metadata END/i.test(sql);

        // Production also has idx_agent_presence_agent_unique. An upsert whose
        // arbiter is only the composite primary key does not handle that
        // independent unique-agent conflict, which is the shipped failure.
        if (existing && /ON CONFLICT \(agent, project_id\)/i.test(sql)) {
          throw new Error("duplicate key value violates unique constraint idx_agent_presence_agent_unique");
        }

        const row = existing ?? {
          id,
          agent,
          role: "agent",
          created_at: new Date().toISOString(),
        };
        Object.assign(row, {
          session_id: session_id ?? row.session_id ?? null,
          status,
          last_seen_at: new Date().toISOString(),
          online: true,
        });
        if (!existing || !conditionallyReplacesProjectId || replaceProjectId) row.project_id = project_id;
        if (!existing || !conditionallyReplacesMetadata || replaceMetadata) row.metadata = metadata;
        agentPresence.set(agent, row);
        return { ...row };
      }
      if (/INSERT INTO agent_presence/i.test(sql)) {
        const [id, rawAgent, session_id, role, project_id] = p as any[];
        const agent = String(rawAgent).toLowerCase();
        const row = {
          id,
          agent,
          session_id,
          role,
          project_id,
          status: "online",
          last_seen_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          metadata: null,
          online: true,
        };
        agentPresence.set(agent, row);
        return { ...row };
      }
      // Match only the standalone message-count query, not channel/project
      // GETs that carry COUNT(*) subqueries for member_count/message_count.
      if (/count\(\*\)::bigint\s+as\s+n/i.test(sql)) return { n: messages.length };
      if (/SELECT current_channel FROM channel_rename_aliases/i.test(sql)) {
        const currentChannel = channelAliases[String((p as any[])[0])];
        return currentChannel ? { current_channel: currentChannel } : null;
      }
      if (/INSERT INTO channels/i.test(sql)) {
        const [id, name, description, topic, project_id, created_by, metadata, tags] = p as any[];
        const row = {
          id,
          name,
          description,
          topic,
          project_id,
          created_by,
          metadata,
          tags,
          archived_at: null,
          created_at: new Date().toISOString(),
        };
        channels[name] = row;
        return row;
      }
      if (/SELECT name FROM channels WHERE name/i.test(sql)) {
        return channels[(p as any[])[0]] ? { name: (p as any[])[0] } : null;
      }
      if (/SELECT name, project_id.*FROM channels WHERE name/i.test(sql)) {
        const row = channels[(p as any[])[0]];
        return row ? { name: row.name, project_id: row.project_id ?? null, archived_at: row.archived_at ?? null } : null;
      }
      if (/SELECT 1 AS ok FROM channel_members/i.test(sql)) {
        const [channel, agent] = p as any[];
        return channelMembers.has(`${channel}:${agent}`) ? { ok: 1 } : null;
      }
      if (/SELECT \* FROM messages WHERE id/i.test(sql)) {
        return messages.find((row) => row.id === (p as any[])[0]) ?? null;
      }
      if (/SELECT \* FROM messages WHERE uuid/i.test(sql)) {
        return messages.find((row) => row.uuid === (p as any[])[0]) ?? null;
      }
      if (/FROM message_attachments WHERE message_id/i.test(sql)) {
        return messageAttachments.find((row) => row.message_id === p[0] && row.name === p[1]) ?? null;
      }
      if (/FROM messages WHERE id = \$1 AND uuid = \$2/i.test(sql)) {
        return messages.find((row) => row.id === p[0] && row.uuid === p[1]) ?? null;
      }
      if (/SELECT id, uuid, session_id, channel, reply_to, thread_id FROM messages WHERE uuid/i.test(sql)) {
        const found = messages.find((row) => row.uuid === (p as any[])[0]);
        return found
          ? {
              id: found.id,
              uuid: found.uuid,
              session_id: found.session_id,
              channel: found.channel,
              reply_to: found.reply_to ?? null,
              thread_id: found.thread_id ?? null,
            }
          : null;
      }
      // Parent-existence probe for reply_to validation on POST /messages.
      if (/SELECT id FROM messages WHERE id/i.test(sql)) {
        const found = messages.find((row) => row.id === (p as any[])[0]);
        return found ? { id: found.id } : null;
      }
      if (/FROM channels c WHERE c\.name/i.test(sql) || /SELECT \* FROM channels WHERE name/i.test(sql) || /SELECT name, description/i.test(sql) || /SELECT name FROM channels WHERE name = \$1/i.test(sql)) {
        const row = channels[(p as any[])[0]];
        return row
          ? {
              ...row,
              member_count: [...channelMembers].filter((entry) => entry.startsWith(`${row.name}:`)).length,
              message_count: messages.filter((message) => message.channel === row.name).length,
            }
          : null;
      }
      if (/UPDATE channels SET/i.test(sql)) {
        const setMatch = sql.match(/UPDATE channels SET (.+) WHERE name = \$(\d+) RETURNING \*/i);
        if (!setMatch) return null;
        const name = String(p[Number(setMatch[2]) - 1]);
        const row = channels[name];
        if (!row) return null;
        for (const assignment of setMatch[1].matchAll(/(\w+)\s*=\s*\$(\d+)/g)) {
          row[assignment[1]] = p[Number(assignment[2]) - 1];
        }
        return row;
      }
      if (/INSERT INTO messages/i.test(sql)) {
        // Destructured positionally, so this must track the column list in the
        // INSERT. metadata and reply_to are positional; a column missing from
        // the statement is exactly how cloud-only fields were dropped.
        const [
          uuid,
          session_id,
          from_agent,
          to_agent,
          channel,
          project_id,
          content,
          priority,
          working_dir,
          repository,
          branch,
          metadata,
          blocking,
          reply_to,
          thread_id,
        ] = p as any[];
        const createdAt = opts.messageCreatedAtAsDate
          ? new Date()
          : nextMessageCreatedAtAsDate
            ? new Date("2026-08-24T17:30:31.000Z")
            : new Date().toISOString();
        nextMessageCreatedAtAsDate = false;
        const row = {
          id: nextId++,
          uuid,
          session_id,
          from_agent,
          to_agent,
          channel,
          project_id,
          content,
          priority,
          working_dir,
          repository,
          branch,
          metadata,
          blocking,
          reply_to: reply_to ?? null,
          thread_id: thread_id ?? null,
          thread_status: null,
          // The real server reads TIMESTAMPTZ through `pg`, which hands back a
          // JS Date object (see src/lib/content-safety.ts). The default fake
          // returns an ISO string; `messageCreatedAtAsDate` mimics pg so the
          // timestamp-serialization path is exercised like production.
          created_at: createdAt,
        };
        messages.push(row);
        return row;
      }
      if (/INSERT INTO reactions/i.test(sql) && /ON CONFLICT/i.test(sql)) {
        const [messageId, who, emoji] = p as any[];
        const existing = reactions.find(
          (reaction) => Number(reaction.message_id) === Number(messageId)
            && String(reaction.agent) === String(who)
            && String(reaction.emoji) === String(emoji),
        );
        if (existing) return undefined; // ON CONFLICT DO NOTHING -> no row (toggle removes)
        const row = {
          id: nextId++,
          message_id: Number(messageId),
          agent: String(who),
          emoji: String(emoji),
          created_at: new Date().toISOString(),
        };
        reactions.push(row);
        return row;
      }
      if (/SELECT \* FROM reactions WHERE message_id = \$1/i.test(sql)) {
        const messageId = Number(p[0] ?? 0);
        return reactions
          .filter((reaction) => Number(reaction.message_id) === messageId)
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id));
      }
      if (/INSERT INTO channel_project_linkage_receipts/i.test(sql)) {
        const rollback = /'rollback'/i.test(sql);
        const row = rollback
          ? {
              id: p[0], idempotency_key: p[1], operation: "rollback", channel: p[2], project_id: p[3],
              source_receipt_id: p[4], request_hash: p[5], payload: p[6], created_at: p[7],
            }
          : {
              id: p[0], idempotency_key: p[1], operation: "apply", channel: p[2], project_id: p[3],
              source_receipt_id: null, request_hash: p[4], payload: p[5], created_at: p[6],
            };
        if (linkageReceipts.some((receipt) => receipt.idempotency_key === row.idempotency_key)) {
          throw new Error("duplicate idempotency key");
        }
        linkageReceipts.push(row);
        return { id: row.id };
      }
      if (/INSERT INTO projects/i.test(sql)) {
        const [id, name, description, path, repository, created_by] = p as any[];
        const row = { id, name, description, path, repository, created_by, status: "active", created_at: new Date().toISOString() };
        projects[id] = row;
        return row;
      }
      return null;
    },
    async execute(sql: string, p: readonly unknown[] = []): Promise<void> {
      if (/INSERT INTO channel_members/i.test(sql)) {
        const [channel, agent] = p as any[];
        channelMembers.add(`${channel}:${agent}`);
      }
    },
    async transaction<T>(fn: (tx: { query: (sql: string, p?: readonly unknown[]) => Promise<{ rows: any[]; rowCount: number }> }) => Promise<T>): Promise<T> {
      const waitForPrevious = transactionTail;
      const releaseTransaction = deferred();
      transactionTail = releaseTransaction.promise;
      if (pendingTransactions > 0) linkageBulkRace?.concurrentAttempt.resolve();
      pendingTransactions++;
      await waitForPrevious;
      const channelSnapshot = Object.fromEntries(Object.entries(channels).map(([key, value]) => [key, { ...value }]));
      const memberSnapshot = new Set(channelMembers);
      const messageSnapshot = messages.map((message) => ({ ...message }));
      const attachmentSnapshot = messageAttachments.map((attachment) => ({ ...attachment }));
      const mentionSnapshot = messageMentions.map((mention) => ({ ...mention }));
      const subscriptionSnapshot = channelSubscriptions.map((subscription) => ({ ...subscription }));
      const taskSnapshot = tasks.map((task) => ({ ...task }));
      const edgeSnapshot = graphEdges.map((edge) => ({ ...edge }));
      const lockSnapshot = resourceLocks.map((lock) => ({ ...lock }));
      let channelIdConstraintDeferred = false;
      const linkageReceiptSnapshot = linkageReceipts.map((receipt) => ({ ...receipt }));
      const tx = {
        async query(sql: string, p: readonly unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
          const [first, second] = p as any[];
          if (/INSERT INTO conversations_event_outbox/i.test(sql)) {
            // The Conversations→Events outbox INSERT runs inside the task
            // transaction; record it so tests can assert hosted outbox emission.
            queryCalls.push({ sql, params: [...p] });
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE tasks SET status/i.test(sql)) {
            // The id is the LAST param: `SET status='x' ... WHERE id = $1` has
            // one param, the transition form `SET status='x', ... WHERE id = $2`
            // has two.
            const task = tasks.find((t) => Number(t.id) === Number(p[p.length - 1]));
            if (!task) return { rows: [], rowCount: 0 };
            const statusMatch = sql.match(/SET status = '([^']+)'/);
            if (statusMatch) task.status = statusMatch[1];
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE tasks SET priority/i.test(sql)) {
            const task = tasks.find((t) => Number(t.id) === Number(p[p.length - 1]));
            if (!task) return { rows: [], rowCount: 0 };
            task.priority = first;
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE tasks SET assignee/i.test(sql)) {
            const task = tasks.find((t) => Number(t.id) === Number(p[p.length - 1]));
            if (!task) return { rows: [], rowCount: 0 };
            task.assignee = first ?? null;
            return { rows: [], rowCount: 1 };
          }
          if (/INSERT INTO message_attachments/i.test(sql)) {
            let inserted = 0;
            for (let index = 0; index < p.length; index += 5) {
              const [message_id, name, mime_type, size, content] = (p as any[]).slice(index, index + 5);
              messageAttachments.push({ message_id, name, mime_type, size, content });
              inserted++;
            }
            return { rows: [], rowCount: inserted };
          }
          if (/UPDATE messages SET attachments = \$1 WHERE id = \$2/i.test(sql)) {
            const message = messages.find((row) => row.id === second);
            if (!message) return { rows: [], rowCount: 0 };
            message.attachments = first;
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE messages SET thread_status = \$1 WHERE id = \$2/i.test(sql)) {
            const message = messages.find((row) => row.id === second);
            if (!message) return { rows: [], rowCount: 0 };
            message.thread_status = first;
            return { rows: [], rowCount: 1 };
          }
          if (/INSERT INTO messages/i.test(sql) && /ON CONFLICT/i.test(sql)) {
            return client.query(sql, p);
          }
          if (/INSERT INTO channel_members/i.test(sql)) {
            return client.query(sql, p);
          }
          if (failRenameAt?.test(sql)) {
            failRenameAt = null;
            throw new Error("injected channel rename failure");
          }
          if (/SET CONSTRAINTS channels_id_unique DEFERRED/i.test(sql)) {
            channelIdConstraintDeferred = true;
            return { rows: [], rowCount: 0 };
          }
          if (/INSERT INTO channels/i.test(sql) && /SELECT\s+(?:id,\s*)?\$1/i.test(sql)) {
            if (!channelIdConstraintDeferred) throw new Error("duplicate key value violates unique constraint channels_id_unique");
            channels[first] = { ...channels[second], name: first };
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE channel_members/i.test(sql)) {
            for (const entry of [...channelMembers]) {
              if (entry.startsWith(`${second}:`)) {
                const [, agent] = entry.split(":");
                channelMembers.delete(entry);
                channelMembers.add(`${first}:${agent}`);
              }
            }
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE channel_subscriptions/i.test(sql)) {
            for (const subscription of channelSubscriptions) {
              if (subscription.channel === second) subscription.channel = first;
            }
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE messages SET channel/i.test(sql)) {
            for (const message of messages) {
              if (message.channel === second) {
                message.channel = first;
                if (message.to_agent === second) message.to_agent = first;
              }
            }
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE messages SET session_id/i.test(sql)) {
            for (const message of messages) {
              if (message.session_id === second) message.session_id = first;
            }
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE message_mentions/i.test(sql)) {
            for (const mention of messageMentions) {
              if (mention.channel === second) mention.channel = first;
            }
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE tasks SET channel/i.test(sql)) {
            for (const task of tasks) {
              if (task.channel === second) task.channel = first;
            }
            return { rows: [], rowCount: 1 };
          }
          if (
            /DELETE FROM resource_locks WHERE expires_at < NOW\(\)/i.test(sql) ||
            /DELETE FROM resource_locks[\s\S]*LOWER\(agent_id\) IN/i.test(sql) ||
            /UPDATE resource_locks SET expires_at = \$4, locked_at = NOW\(\)/i.test(sql) ||
            /INSERT INTO resource_locks/i.test(sql)
          ) {
            return client.query(sql, p);
          }
          if (/DELETE FROM graph_edges AS source/i.test(sql)) {
            const fromDirection = /source\.from_id = \$2/i.test(sql);
            const toDirection = /source\.to_id = \$2/i.test(sql);
            for (let index = graphEdges.length - 1; index >= 0; index--) {
              const edge = graphEdges[index];
              const duplicate = fromDirection
                ? edge.from_type === "channel" &&
                  edge.from_id === second &&
                  graphEdges.some((target) =>
                    target.from_type === "channel" &&
                    target.from_id === first &&
                    target.to_type === edge.to_type &&
                    target.to_id === edge.to_id &&
                    target.relation === edge.relation
                  )
                : toDirection
                  ? edge.to_type === "channel" &&
                    edge.to_id === second &&
                    graphEdges.some((target) =>
                      target.to_type === "channel" &&
                      target.to_id === first &&
                      target.from_type === edge.from_type &&
                      target.from_id === edge.from_id &&
                      target.relation === edge.relation
                    )
                  : false;
              if (duplicate) graphEdges.splice(index, 1);
            }
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE graph_edges AS target SET/i.test(sql)) {
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE graph_edges SET from_id/i.test(sql)) {
            const collision = graphEdges.some((edge) =>
              edge.from_type === "channel" &&
              edge.from_id === second &&
              graphEdges.some((target) =>
                target.from_type === "channel" &&
                target.from_id === first &&
                target.to_type === edge.to_type &&
                target.to_id === edge.to_id &&
                target.relation === edge.relation
              )
            );
            if (collision) {
              throw new Error('duplicate key value violates unique constraint "graph_edges_from_to_relation_key"');
            }
            for (const edge of graphEdges) {
              if (edge.from_type === "channel" && edge.from_id === second) edge.from_id = first;
            }
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE graph_edges SET to_id/i.test(sql)) {
            const collision = graphEdges.some((edge) =>
              edge.to_type === "channel" &&
              edge.to_id === second &&
              graphEdges.some((target) =>
                target.to_type === "channel" &&
                target.to_id === first &&
                target.from_type === edge.from_type &&
                target.from_id === edge.from_id &&
                target.relation === edge.relation
              )
            );
            if (collision) {
              throw new Error('duplicate key value violates unique constraint "graph_edges_from_to_relation_key"');
            }
            for (const edge of graphEdges) {
              if (edge.to_type === "channel" && edge.to_id === second) edge.to_id = first;
            }
            return { rows: [], rowCount: 1 };
          }
          if (/DELETE FROM resource_locks AS source/i.test(sql)) {
            for (let index = resourceLocks.length - 1; index >= 0; index--) {
              const lock = resourceLocks[index];
              if (
                lock.resource_type === "channel" &&
                lock.resource_id === second &&
                resourceLocks.some((target) =>
                  target.resource_type === "channel" &&
                  target.resource_id === first &&
                  target.lock_type === lock.lock_type
                )
              ) {
                resourceLocks.splice(index, 1);
              }
            }
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE resource_locks/i.test(sql)) {
            for (const lock of resourceLocks) {
              if (lock.resource_type === "channel" && lock.resource_id === second) lock.resource_id = first;
            }
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE messages SET project_id = \$1/i.test(sql)) {
            const [projectId, id, uuid, channel, expectedProjectId] = p as any[];
            const message = messages.find((row) =>
              row.id === id && row.uuid === uuid && row.channel === channel &&
              (/project_id IS NULL/i.test(sql) ? row.project_id == null : row.project_id === expectedProjectId)
            );
            if (!message) return { rows: [], rowCount: 0 };
            message.project_id = projectId ?? null;
            return { rows: [{ id }], rowCount: 1 };
          }
          if (/DELETE FROM channels/i.test(sql)) {
            delete channels[first];
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
        async many(sql: string, p: readonly unknown[] = []): Promise<any[]> {
          return client.many(sql, p);
        },
        async get(sql: string, p: readonly unknown[] = []): Promise<any> {
          if (
            linkageBulkRace &&
            !linkageBulkRace.pauseConsumed &&
            /INSERT INTO channel_project_linkage_receipts/i.test(sql) &&
            /'apply'/i.test(sql)
          ) {
            linkageBulkRace.pauseConsumed = true;
            linkageBulkRace.paused.resolve();
            await linkageBulkRace.release.promise;
          }
          return client.get(sql, p);
        },
        async one(sql: string, p: readonly unknown[] = []): Promise<any> {
          const row = await client.get(sql, p);
          if (!row) throw new Error("Expected exactly one row, got 0.");
          return row;
        },
        async execute(sql: string, p: readonly unknown[] = []): Promise<void> {
          await client.execute(sql, p);
        },
      };
      try {
        return await fn(tx);
      } catch (error) {
        for (const key of Object.keys(channels)) delete channels[key];
        Object.assign(channels, channelSnapshot);
        channelMembers.clear();
        for (const entry of memberSnapshot) channelMembers.add(entry);
        messages.splice(0, messages.length, ...messageSnapshot);
        messageAttachments.splice(0, messageAttachments.length, ...attachmentSnapshot);
        messageMentions.splice(0, messageMentions.length, ...mentionSnapshot);
        channelSubscriptions.splice(0, channelSubscriptions.length, ...subscriptionSnapshot);
        tasks.splice(0, tasks.length, ...taskSnapshot);
        graphEdges.splice(0, graphEdges.length, ...edgeSnapshot);
        resourceLocks.splice(0, resourceLocks.length, ...lockSnapshot);
        linkageReceipts.splice(0, linkageReceipts.length, ...linkageReceiptSnapshot);
        throw error;
      } finally {
        pendingTransactions--;
        releaseTransaction.resolve();
      }
    },
      __debug: {
        channels,
        channelAliases,
      channelMembers,
      messages,
      reactions,
      messageAttachments,
      messageMentions,
      agentPresence,
      agentPresenceReapArchive: [] as Array<Record<string, unknown>>,
      manyCalls,
      queryCalls,
      scopeRewriteCalls,
      projects,
      seedChannel(input: Record<string, any>, members: string[], channelMessages: any[]) {
        channels[input.name] = { ...input };
        for (const agent of members) channelMembers.add(`${input.name}:${agent}`);
        messages.push(...channelMessages);
      },
      failRenameWhen(pattern: RegExp) {
        failRenameAt = pattern;
      },
      failNextChannelMemberInsert() {
        failChannelMemberInsert = true;
      },
      returnNextMessageCreatedAtAsDate() {
        nextMessageCreatedAtAsDate = true;
      },
      armProjectLinkageBulkRace() {
        const race = {
          paused: deferred(),
          release: deferred(),
          concurrentAttempt: deferred(),
          pauseConsumed: false,
        };
        linkageBulkRace = race;
        return {
          paused: race.paused.promise,
          concurrentAttempt: race.concurrentAttempt.promise,
          release: race.release.resolve,
        };
      },
      channelSubscriptions,
      channelNotificationReads,
      tasks,
      graphEdges,
      resourceLocks,
      linkageReceipts,
    },
  };
  return client;
}

const SIGNING = "test-signing-secret-0123456789";
let activeFakeClient: ReturnType<typeof makeFakeClient> | null = null;

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "api_user:synthetic-password", "@db.example.invalid/app"].join("");
}

function makeDeps(): ApiServerDeps {
  const client = makeFakeClient();
  activeFakeClient = client;
  const keys = new ApiKeyStore(client as any);
  // @hasna/contracts >= 0.10.6 rejects a bare `isRevoked` boolean predicate
  // (it cannot refuse an unregistered key). The fake store's `keyStatus`
  // resolves "unknown" for minted keys it has no record of, so the stub pins
  // every cryptographically valid token to "active" — exactly what the old
  // `isRevoked: async () => false` meant, expressed through the strict hook.
  const verifier = verifyApiKey({ app: "conversations", signingSecret: SIGNING, keyStatus: async (): Promise<ApiKeyStatus> => "active" });
  return { client: client as any, keys, verifier };
}

let server: ReturnType<typeof startApiServer>;
let base: string;
let rwKey: string;
let roKey: string;

beforeAll(() => {
  server = startApiServer({ port: 0, host: "127.0.0.1", deps: makeDeps() });
  base = `http://127.0.0.1:${server.port}`;
  rwKey = mintApiKey({ app: "conversations", agent: "test", scopes: ["conversations:read", "conversations:write"], signingSecret: SIGNING }).token;
  roKey = mintApiKey({ app: "conversations", agent: "ro", scopes: ["conversations:read"], signingSecret: SIGNING }).token;
});

afterAll(() => { server.stop(true); });

describe("conversations-serve", () => {
  test("GET /v1/channels/:name/members distinguishes missing from existing empty channels", async () => {
    activeFakeClient!.__debug.seedChannel({
      id: "chn_00000000000000000000000000000053",
      name: "existing-empty-members",
      description: null,
      topic: null,
      project_id: null,
      created_by: "alice",
      created_at: "2026-08-09T00:00:00.000Z",
      archived_at: null,
      metadata: null,
      tags: null,
    }, [], []);

    const existing = await fetch(`${base}/v1/channels/existing-empty-members/members`, {
      headers: { "x-api-key": rwKey },
    });
    expect(existing.status).toBe(200);
    expect(await existing.json()).toEqual({ members: [] });

    const missing = await fetch(`${base}/v1/channels/missing-members-channel/members`, {
      headers: { "x-api-key": rwKey },
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Channel not found: missing-members-channel" });
  });

  test("POST /v1/channel-notifications/baseline executes one atomic snapshot statement", async () => {
    const store = new ApiStore(createHasnaStorageClient(
      "conversations",
      createHasnaHttpTransport({
        name: "conversations",
        baseUrl: `${base}/v1`,
        apiKey: rwKey,
        retry: false,
      }),
    ));

    expect(await store.baselineChannelNotifications("watcher")).toBe(0);
    const query = activeFakeClient!.__debug.queryCalls.at(-1)!;
    expect(query.sql).toContain("INSERT INTO channel_notification_reads");
    expect(query.sql).toContain("INNER JOIN channel_subscriptions");
    expect(query.sql).toContain("ON CONFLICT DO NOTHING");
    expect(query.params).toEqual(["watcher", "watcher"]);
  });

  test("GET /v1/projects pages three stable ids without overlap and reports continuation", async () => {
    const projectClient = makeFakeClient([
      { id: "project-alpha", name: "Alpha", created_at: "2026-08-07T00:00:00.000Z", status: "active" },
      { id: "project-bravo", name: "Bravo", created_at: "2026-08-07T00:00:01.000Z", status: "active" },
      { id: "project-charlie", name: "Charlie", created_at: "2026-08-07T00:00:02.000Z", status: "active" },
    ]);
    const projectKeys = new ApiKeyStore(projectClient as any);
    const projectVerifier = verifyApiKey({
      app: "conversations",
      signingSecret: SIGNING,
      keyStatus: async (): Promise<ApiKeyStatus> => "active",
    });
    const projectServer = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: { client: projectClient as any, keys: projectKeys, verifier: projectVerifier },
    });
    const projectBase = `http://127.0.0.1:${projectServer.port}`;
    const projectKey = mintApiKey({
      app: "conversations",
      agent: "project-reader",
      scopes: ["conversations:read"],
      signingSecret: SIGNING,
    }).token;
    const headers = { "x-api-key": projectKey };

    try {
      const firstResponse = await fetch(`${projectBase}/v1/projects?limit=2`, { headers });
      expect(firstResponse.status).toBe(200);
      const first = await firstResponse.json() as any;
      expect(first.projects.map((project: any) => project.id)).toEqual(["project-alpha", "project-bravo"]);
      expect(first.has_more).toBe(true);
      expect(first.next_cursor).toBe(2);

      const secondResponse = await fetch(`${projectBase}/v1/projects?limit=2&cursor=${first.next_cursor}`, { headers });
      expect(secondResponse.status).toBe(200);
      const second = await secondResponse.json() as any;
      expect(second.projects.map((project: any) => project.id)).toEqual(["project-charlie"]);
      expect(second.has_more).toBe(false);
      expect(second.next_cursor).toBeNull();

      const firstIds = first.projects.map((project: any) => project.id);
      const secondIds = second.projects.map((project: any) => project.id);
      expect(new Set([...firstIds, ...secondIds])).toEqual(
        new Set(["project-alpha", "project-bravo", "project-charlie"]),
      );
      expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);
    } finally {
      projectServer.stop(true);
    }
  });

  test("GET /v1/projects rejects malformed limit and cursor values", async () => {
    for (const query of ["limit=0", "limit=abc", "cursor=-1", "cursor=1.5"]) {
      const response = await fetch(`${base}/v1/projects?${query}`, {
        headers: { "x-api-key": roKey },
      });
      expect(response.status).toBe(400);
      const body = await response.json() as any;
      expect(body.error).toBe("Validation failed");
    }
  });

  test("GET /health is unauthenticated and returns exactly the documented fields", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(Object.keys(b).sort()).toEqual(["app", "status", "version"]);
    expect(b.status).toBe("ok");
    expect(typeof b.version).toBe("string");
  });

  test("GET /ready pings the store and returns exactly the documented fields", async () => {
    const b = await (await fetch(`${base}/ready`)).json();
    expect(Object.keys(b).sort()).toEqual(["app", "status", "version"]);
    expect(b.status).toBe("ok");
  });

  test("GET /version returns version metadata as exactly the documented fields", async () => {
    const b = await (await fetch(`${base}/version`)).json();
    expect(Object.keys(b).sort()).toEqual(["app", "build_sha", "status", "version"]);
    expect(b.version).toBeTruthy();
    expect(b.build_sha).toBeNull();
  });

  test("OpenAPI version contract names exactly the documented fields", async () => {
    const spec = await (await fetch(`${base}/v1/openapi.json`)).json() as any;
    const schema = spec.paths["/version"].get.responses["200"].content["application/json"].schema;
    expect(schema.required).toEqual(["status", "version", "app", "build_sha"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["app", "build_sha", "status", "version"]);
    expect(schema.properties.build_sha.oneOf).toEqual([
      { type: "string", pattern: "^[0-9a-f]{40}$" },
      { type: "null" },
    ]);
  });

  test("/v1 requires an API key (401 without one)", async () => {
    const r = await fetch(`${base}/v1/channels`);
    expect(r.status).toBe(401);
  });

  test("/v1 rejects an invalid key", async () => {
    const r = await fetch(`${base}/v1/channels`, { headers: { "x-api-key": "hasna_conversations_bogus" } });
    expect(r.status).toBe(401);
  });

  test("read-only key can GET but not POST (scope enforcement)", async () => {
    const get = await fetch(`${base}/v1/channels`, { headers: { "x-api-key": roKey } });
    expect(get.status).toBe(200);
    const post = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": roKey, "content-type": "application/json" },
      body: JSON.stringify({ name: "x", created_by: "ro" }),
    });
    expect(post.status).toBe(403);
  });

  test("register takeover can heartbeat immediately without creating a second presence row", async () => {
    const name = "presence-takeover";
    const projectId = "proj-valid";
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };

    const first = await fetch(`${base}/v1/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name, session_id: "session-old", project_id: projectId }),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).result).toMatchObject({ created: true, took_over: false });

    const takeover = await fetch(`${base}/v1/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name, session_id: "session-new", project_id: projectId, force: true }),
    });
    expect(takeover.status).toBe(200);
    expect((await takeover.json()).result).toMatchObject({
      created: false,
      took_over: true,
      agent: { agent: name, session_id: "session-new", project_id: projectId },
    });

    const heartbeat = await fetch(`${base}/v1/agents/heartbeat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agent: name,
        session_id: "session-new",
        project_id: projectId,
        status: "busy",
        metadata: { task: "f94cbd3d" },
      }),
    });

    expect(heartbeat.status).toBe(200);
    expect((await heartbeat.json()).agent).toMatchObject({
      agent: name,
      project_id: projectId,
      status: "busy",
    });
    expect(activeFakeClient!.__debug.agentPresence.size).toBe(1);
    expect(activeFakeClient!.__debug.agentPresence.get(name)).toMatchObject({
      session_id: "session-new",
      project_id: projectId,
      status: "busy",
    });
  });

  test("heartbeat preserves omitted project and metadata while explicit values replace them", async () => {
    const name = "presence-partial-update";
    const store = new ApiStore(createHasnaStorageClient(
      "conversations",
      createHasnaHttpTransport({
        name: "conversations",
        baseUrl: `${base}/v1`,
        apiKey: rwKey,
        retry: false,
      }),
    ));

    await store.heartbeat(
      name,
      "online",
      { phase: "baseline", nonce: "64bd-pre" },
      "session-baseline",
      "proj-valid",
    );
    expect(await store.getPresence(name)).toMatchObject({
      agent: name,
      session_id: "session-baseline",
      project_id: "proj-valid",
      status: "online",
      metadata: { phase: "baseline", nonce: "64bd-pre" },
    });

    await store.heartbeat(name, "busy");
    expect(await store.getPresence(name)).toMatchObject({
      agent: name,
      session_id: "session-baseline",
      project_id: "proj-valid",
      status: "busy",
      metadata: { phase: "baseline", nonce: "64bd-pre" },
    });

    await store.heartbeat(name, "idle", {}, undefined, null);
    expect(await store.getPresence(name)).toMatchObject({
      agent: name,
      session_id: "session-baseline",
      project_id: null,
      status: "idle",
      metadata: {},
    });
  });

  test("GET /v1/agents reports effective status: 'online' only while last_seen_at is fresh", async () => {
    const presence = activeFakeClient!.__debug.agentPresence;
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    presence.set("stale-roster-agent", {
      id: "stale0001", agent: "stale-roster-agent", session_id: "sess-stale", role: "agent",
      project_id: "", status: "online", last_seen_at: staleAt, created_at: staleAt, metadata: null,
    });
    presence.set("fresh-roster-agent", {
      id: "fresh0001", agent: "fresh-roster-agent", session_id: "sess-fresh", role: "agent",
      project_id: "", status: "online", last_seen_at: new Date().toISOString(), created_at: new Date().toISOString(), metadata: null,
    });

    const res = await fetch(`${base}/v1/agents`, { headers: { "x-api-key": rwKey } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Array<Record<string, unknown>> };
    const byName = new Map(body.agents.map((a) => [a.agent, a]));
    expect(byName.get("stale-roster-agent")).toMatchObject({ status: "offline", online: false });
    expect(byName.get("fresh-roster-agent")).toMatchObject({ status: "online", online: true });

    presence.delete("stale-roster-agent");
    presence.delete("fresh-roster-agent");
  });

  test("POST /v1/agents/reap-stale is report-first and with apply removes only stale single-touch rows", async () => {
    const presence = activeFakeClient!.__debug.agentPresence;
    activeFakeClient!.__debug.agentPresenceReapArchive.length = 0;
    const oldAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const seenAgainAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000).toISOString();
    presence.set("reap-single-touch", {
      id: "reap00001", agent: "reap-single-touch", session_id: "s1", role: "agent",
      project_id: "", status: "online", last_seen_at: oldAt, created_at: oldAt, metadata: null,
    });
    presence.set("reap-seen-again", {
      id: "reap00002", agent: "reap-seen-again", session_id: "s2", role: "agent",
      project_id: "", status: "online", last_seen_at: seenAgainAt, created_at: oldAt, metadata: null,
    });
    presence.set("reap-fresh", {
      id: "reap00003", agent: "reap-fresh", session_id: "s3", role: "agent",
      project_id: "", status: "online", last_seen_at: new Date().toISOString(), created_at: new Date().toISOString(), metadata: null,
    });
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };

    const dry = await fetch(`${base}/v1/agents/reap-stale`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    expect(dry.status).toBe(200);
    expect(await dry.json()).toEqual({
      candidates: 1, reaped: 0, archived: 0, archiveTable: "agent_presence_reap_archive", agents: ["reap-single-touch"],
    });
    expect(presence.has("reap-single-touch")).toBe(true);

    const applied = await fetch(`${base}/v1/agents/reap-stale`, {
      method: "POST",
      headers,
      body: JSON.stringify({ apply: true }),
    });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toEqual({
      candidates: 1, reaped: 1, archived: 1, archiveTable: "agent_presence_reap_archive", agents: ["reap-single-touch"],
    });
    expect(presence.has("reap-single-touch")).toBe(false);
    expect(presence.has("reap-seen-again")).toBe(true);
    expect(presence.has("reap-fresh")).toBe(true);

    // The removed row is preserved in the append-only archive with its full
    // registration, so the delete has a rollback path.
    expect(activeFakeClient!.__debug.agentPresenceReapArchive).toHaveLength(1);
    expect(activeFakeClient!.__debug.agentPresenceReapArchive[0]).toMatchObject({
      id: "reap00001",
      agent: "reap-single-touch",
      session_id: "s1",
      role: "agent",
      status: "online",
    });
  });

  test("POST /v1/agents/reap-stale apply does not delete a registration whose heartbeat refreshed between report and apply", async () => {
    const presence = activeFakeClient!.__debug.agentPresence;
    activeFakeClient!.__debug.agentPresenceReapArchive.length = 0;
    const oldAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    presence.set("reap-race", {
      id: "reap00010", agent: "reap-race", session_id: "s10", role: "agent",
      project_id: "", status: "online", last_seen_at: oldAt, created_at: oldAt, metadata: null,
    });
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };

    const dry = await fetch(`${base}/v1/agents/reap-stale`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    expect(dry.status).toBe(200);
    expect((await dry.json()).candidates).toBe(1);

    // A heartbeat refreshes the row between report and apply.
    presence.set("reap-race", {
      id: "reap00010", agent: "reap-race", session_id: "s10", role: "agent",
      project_id: "", status: "online", last_seen_at: new Date().toISOString(), created_at: oldAt, metadata: null,
    });

    const applied = await fetch(`${base}/v1/agents/reap-stale`, {
      method: "POST",
      headers,
      body: JSON.stringify({ apply: true }),
    });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toEqual({
      candidates: 0, reaped: 0, archived: 0, archiveTable: "agent_presence_reap_archive", agents: [],
    });
    expect(presence.has("reap-race")).toBe(true);
    expect(activeFakeClient!.__debug.agentPresenceReapArchive).toHaveLength(0);
  });

  test("fresh same-context acquire stays visible to check and list despite stale prior presence", async () => {
    const lockClient = makeFakeClient();
    const lockKeys = new ApiKeyStore(lockClient as any);
    const lockVerifier = verifyApiKey({
      app: "conversations",
      signingSecret: SIGNING,
      keyStatus: async (): Promise<ApiKeyStatus> => "active",
    });
    const lockServer = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: { client: lockClient as any, keys: lockKeys, verifier: lockVerifier },
    });
    const lockBase = `http://127.0.0.1:${lockServer.port}`;
    const lockKey = mintApiKey({
      app: "conversations",
      agent: "severianus",
      scopes: ["conversations:read", "conversations:write"],
      signingSecret: SIGNING,
    }).token;
    const store = new ApiStore(createHasnaStorageClient("conversations", createHasnaHttpTransport({
      name: "conversations",
      baseUrl: `${lockBase}/v1`,
      apiKey: lockKey,
      retry: false,
    })));
    const agent = "severianus";
    const resourceType = "pull_request";
    const resourceId = "github/hasnaxyz/iapp-infra/pull/115";
    const oldResourceId = "github/hasnaxyz/iapp-infra/pull/old-stale";
    const staleAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    lockClient.__debug.agentPresence.set(agent, {
      id: "stale-session",
      agent,
      session_id: "old-session",
      role: "agent",
      project_id: "",
      status: "online",
      last_seen_at: staleAt,
      created_at: staleAt,
    });
    lockClient.__debug.resourceLocks.push({
      resource_type: resourceType,
      resource_id: oldResourceId,
      agent_id: agent,
      lock_type: "exclusive",
      locked_at: staleAt,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    try {
      expect(await store.checkLock(resourceType, "known-free")).toBeNull();

      const acquired = await store.acquireLock(resourceType, resourceId, agent, "exclusive", 20 * 60 * 1000);
      expect(acquired).toMatchObject({
        acquired: true,
        lock: { resource_type: resourceType, resource_id: resourceId, agent_id: agent, lock_type: "exclusive" },
      });

      const checked = await store.checkLock(resourceType, resourceId);
      const listed = await store.listLocksEnriched({ agent_id: agent });
      expect({
        checked: checked?.resource_id ?? null,
        listed: listed.map((lock) => lock.resource_id),
      }).toEqual({
        checked: resourceId,
        listed: [resourceId],
      });

      expect(await store.checkLock(resourceType, oldResourceId)).toBeNull();
      expect(await store.listLocksEnriched({ agent_id: "another-agent" })).toEqual([]);
    } finally {
      lockServer.stop(true);
    }
  });

  // Regression cover for todos 13425e5c: the cycle-0 fix normalized holder
  // identity in the local SQLite store only. The hosted path compared holder
  // identity case-sensitively on the fleet's DEFAULT lock route — release
  // (`AND agent_id = $3`), bulk/single acquire conflict (`l.agent_id !== aid`),
  // and the GET /locks agent filter (`l.agent_id = $n`) — so one agent whose
  // --from casing drifts conflicted with itself (acquired:false), could not
  // release its own lock, and was invisible to its own list filter. The server
  // already normalizes with LOWER() in releaseStaleLocks and the enriched
  // agent_presence join; these cases must behave identically on both backends.
  test("hosted locks treat holder identity case-insensitively across acquire refresh, list filter, and release", async () => {
    const lockClient = makeFakeClient();
    const lockKeys = new ApiKeyStore(lockClient as any);
    const lockVerifier = verifyApiKey({
      app: "conversations",
      signingSecret: SIGNING,
      keyStatus: async (): Promise<ApiKeyStatus> => "active",
    });
    const lockServer = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: { client: lockClient as any, keys: lockKeys, verifier: lockVerifier },
    });
    const lockBase = `http://127.0.0.1:${lockServer.port}`;
    const lockKey = mintApiKey({
      app: "conversations",
      agent: "severianus",
      scopes: ["conversations:read", "conversations:write"],
      signingSecret: SIGNING,
    }).token;
    const store = new ApiStore(createHasnaStorageClient("conversations", createHasnaHttpTransport({
      name: "conversations",
      baseUrl: `${lockBase}/v1`,
      apiKey: lockKey,
      retry: false,
    })));
    const resourceType = "pull_request";
    const resourceId = "github/hasnaxyz/iapp-infra/pull/casing-drift";

    try {
      // Acquire refresh: same agent with casing drift re-acquiring refreshes
      // instead of conflicting with itself; the holder keeps its original casing.
      const first = await store.acquireLock(resourceType, resourceId, "Silvanus", "exclusive", 20 * 60 * 1000);
      expect(first).toMatchObject({ acquired: true });
      const second = await store.acquireLock(resourceType, resourceId, "silvanus", "exclusive", 20 * 60 * 1000);
      expect(second).toMatchObject({ acquired: true });
      expect((second as any).lock?.agent_id).toBe("Silvanus");

      // List filter: agent_id matches the holder regardless of casing — and the
      // filter is proven to apply by the negative control (another agent sees nothing).
      const listed = await store.listLocks({ agent_id: "silvanus" });
      expect(listed.map((lock: any) => lock.resource_id)).toEqual([resourceId]);
      const listedEnriched = await store.listLocksEnriched({ agent_id: "SILVANUS" });
      expect(listedEnriched.map((lock: any) => lock.resource_id)).toEqual([resourceId]);
      expect(await store.listLocks({ agent_id: "another-agent" })).toEqual([]);
      expect(await store.listLocksEnriched({ agent_id: "another-agent" })).toEqual([]);

      // Release: a casing-drifted agent releases its own lock.
      const released = await store.releaseLock(resourceType, resourceId, "silvanus");
      expect(released).toBe(true);
      expect(await store.checkLock(resourceType, resourceId)).toBeNull();
    } finally {
      lockServer.stop(true);
    }
  });

  test("read-write key completes a channel + message roundtrip", async () => {
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ name: "deploys", created_by: "test", description: "d" }),
    });
    expect(created.status).toBe(201);
    const createdChannel = (await created.json()).channel;
    expect(createdChannel.name).toBe("deploys");
    expect(createdChannel.id).toMatch(/^chn_[0-9a-f]{32}$/);

    const got = await fetch(`${base}/v1/channels/deploys`, { headers: { "x-api-key": rwKey } });
    expect(got.status).toBe(200);
    expect((await got.json()).channel.id).toBe(createdChannel.id);

    const channelList = await (await fetch(`${base}/v1/channels`, { headers: { "x-api-key": rwKey } })).json();
    expect(channelList.channels.find((channel: any) => channel.name === "deploys")?.id).toBe(createdChannel.id);

    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: "hi", channel: "deploys" }),
    });
    expect(sent.status).toBe(201);
    expect((await sent.json()).message.content).toBe("hi");

    const list = await (await fetch(`${base}/v1/messages?channel=deploys`, { headers: { "x-api-key": rwKey } })).json();
    expect(list.messages.length).toBeGreaterThan(0);
  });

  // Regression cover for todos 5229dec2. The hosted GET /v1/messages handler
  // rejected since_id=0 with a 400 ("must be a positive integer"), contradicting
  // the OpenAPI contract (openapi.ts declares since_id minimum: 0), the local
  // SQLite path (messages.ts validates since_id with allowZero=true), and the
  // poll cursor (poll.ts seeds lastSeenId=0 and sends since_id=0 every tick).
  // The SQL clause is `id > $n` and ids start at 1, so since_id=0 must behave
  // exactly like no id filter.
  test("GET /v1/messages accepts since_id=0 and returns the same page as no id filter", async () => {
    const channelName = "since-zero-acceptance";
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ name: channelName, created_by: "test", description: "d" }),
    });
    expect(created.status).toBe(201);

    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: "since-zero", channel: channelName }),
    });
    expect(sent.status).toBe(201);
    expect((await sent.json()).message.id).toBeGreaterThan(0);

    const zero = await fetch(`${base}/v1/messages?channel=${channelName}&since_id=0`, { headers: { "x-api-key": rwKey } });
    expect(zero.status).toBe(200);

    // Control: since_id=1 stays accepted.
    const one = await fetch(`${base}/v1/messages?channel=${channelName}&since_id=1`, { headers: { "x-api-key": rwKey } });
    expect(one.status).toBe(200);

    // since_id=0 is the OpenAPI-declared minimum and must equal the unfiltered page.
    const unfiltered = await fetch(`${base}/v1/messages?channel=${channelName}`, { headers: { "x-api-key": rwKey } });
    expect(unfiltered.status).toBe(200);
    const zeroPage = (await zero.json()).messages;
    const unfilteredPage = (await unfiltered.json()).messages;
    expect(zeroPage.length).toBeGreaterThan(0);
    expect(zeroPage.map((m: any) => m.id)).toEqual(unfilteredPage.map((m: any) => m.id));
  });

  test("POST /v1/messages persists metadata for direct and channel UUID readback", async () => {
    const channelName = "message-metadata-roundtrip";
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ name: channelName, created_by: "alice" }),
    });
    expect(created.status).toBe(201);

    const cases = [
      { from: "alice", to: "bob", content: "direct metadata" },
      { from: "alice", to: channelName, channel: channelName, content: "channel metadata" },
    ];
    for (const [index, message] of cases.entries()) {
      const metadata = {
        goal_id: `goal-metadata-${index}`,
        receipt: { kind: index === 0 ? "direct" : "channel" },
      };
      const sent = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
        body: JSON.stringify({ ...message, metadata }),
      });
      expect(sent.status).toBe(201);
      const sentBody = await sent.json();

      const readback = await fetch(`${base}/v1/messages/by-uuid/${sentBody.message.uuid}`, {
        headers: { "x-api-key": rwKey },
      });
      expect(readback.status).toBe(200);
      const stored = (await readback.json()).message;
      expect(JSON.parse(stored.metadata)).toEqual(metadata);
    }
  });

  test("POST /v1/messages persists context fields and preserves omission as null", async () => {
    const positiveContext = {
      working_dir: "/synthetic/server-context-positive",
      repository: "hasna/conversations-server-context-positive",
      branch: "fix/server-context-positive",
    };
    const positive = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "alice",
        to: "bob",
        content: "server context positive",
        ...positiveContext,
      }),
    });
    expect(positive.status).toBe(201);
    const positiveSent = (await positive.json()).message;
    expect(positiveSent).toMatchObject(positiveContext);

    const positiveReadback = await fetch(`${base}/v1/messages/by-uuid/${positiveSent.uuid}`, {
      headers: { "x-api-key": rwKey },
    });
    expect(positiveReadback.status).toBe(200);
    expect((await positiveReadback.json()).message).toMatchObject(positiveContext);

    const negative = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "alice",
        to: "bob",
        content: "server context omitted",
      }),
    });
    expect(negative.status).toBe(201);
    const negativeSent = (await negative.json()).message;
    expect({
      working_dir: negativeSent.working_dir,
      repository: negativeSent.repository,
      branch: negativeSent.branch,
    }).toEqual({
      working_dir: null,
      repository: null,
      branch: null,
    });
  });

  test("project-linked channel sends inherit the channel project and reject explicit conflicts", async () => {
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "linked-send", created_by: "a", project_id: "proj-valid" }),
    });
    expect(created.status).toBe(201);

    const inherited = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "linked-send", channel: "linked-send", content: "inherits" }),
    });
    expect(inherited.status).toBe(201);
    expect((await inherited.json()).message.project_id).toBe("proj-valid");

    const conflict = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "a", to: "linked-send", channel: "linked-send", content: "conflict", project_id: "proj-other",
      }),
    });
    expect(conflict.status).toBe(400);
    expect((await conflict.json()).error).toContain("conflicts with channel project");

    const tenant = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "linked-send", channel: "linked-send", content: "tenant", tenant_id: "other" }),
    });
    expect(tenant.status).toBe(400);
    expect((await tenant.json()).error).toContain("tenant_id is owned by the authenticated storage context");
  });

  test("guarded project-message linkage plans, applies, replays, rejects stale state, and rolls back", async () => {
    const fake = activeFakeClient!;
    const rows = [
      {
        id: 90001, uuid: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", session_id: "channel:linkage-backfill",
        from_agent: "a", to_agent: "linkage-backfill", channel: "linkage-backfill", project_id: null,
        content: "legacy one", priority: "normal", blocking: false, reply_to: null,
        created_at: "2026-08-07T10:00:00.000Z", read_at: null,
      },
      {
        id: 90002, uuid: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", session_id: "channel:linkage-backfill",
        from_agent: "b", to_agent: "linkage-backfill", channel: "linkage-backfill", project_id: null,
        content: "legacy two", priority: "high", blocking: true, reply_to: 90001,
        created_at: "2026-08-07T10:01:00.000Z", read_at: "2026-08-07T10:02:00.000Z",
      },
    ];
    fake.__debug.seedChannel(
      { name: "linkage-backfill", project_id: "proj-valid", created_by: "a", created_at: "2026-08-07T09:00:00.000Z" },
      ["a", "b"],
      rows,
    );

    const planResponse = await fetch(`${base}/v1/channels/linkage-backfill/project-message-linkage`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ project_id: "proj-valid", apply: false }),
    });
    expect(planResponse.status).toBe(200);
    const plan = await planResponse.json();
    expect(plan.message_ids).toEqual([90001, 90002]);
    expect(plan.message_uuids).toEqual(rows.map((row) => row.uuid));
    expect(plan.target_count).toBe(2);

    const request = {
      project_id: "proj-valid",
      expected_revision: plan.revision,
      idempotency_key: "server-linkage-apply",
      apply: true,
    };
    const appliedResponse = await fetch(`${base}/v1/channels/linkage-backfill/project-message-linkage`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(appliedResponse.status).toBe(201);
    const applied = await appliedResponse.json();
    expect(applied.replayed).toBe(false);
    expect(fake.__debug.messages.filter((row: any) => row.channel === "linkage-backfill").map((row: any) => row.project_id))
      .toEqual(["proj-valid", "proj-valid"]);

    const replayResponse = await fetch(`${base}/v1/channels/linkage-backfill/project-message-linkage`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(replayResponse.status).toBe(200);
    expect((await replayResponse.json()).receipt_id).toBe(applied.receipt_id);

    const staleResponse = await fetch(`${base}/v1/channels/linkage-backfill/project-message-linkage`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ ...request, idempotency_key: "server-linkage-stale" }),
    });
    expect(staleResponse.status).toBe(409);
    expect((await staleResponse.json()).error).toContain("Stale project-message linkage revision");

    const rollbackRequest = {
      receipt_id: applied.receipt_id,
      expected_revision: applied.target_revision,
      idempotency_key: "server-linkage-rollback",
    };
    const rollbackPlan = await fetch(`${base}/v1/channels/project-message-linkage/rollback`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ ...rollbackRequest, apply: false }),
    });
    expect(rollbackPlan.status).toBe(200);
    expect((await rollbackPlan.json()).target_count).toBe(2);

    const rollbackResponse = await fetch(`${base}/v1/channels/project-message-linkage/rollback`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ ...rollbackRequest, apply: true }),
    });
    expect(rollbackResponse.status).toBe(201);
    expect((await rollbackResponse.json()).restored_count).toBe(2);
    expect(fake.__debug.messages.filter((row: any) => row.channel === "linkage-backfill").map((row: any) => row.project_id))
      .toEqual([null, null]);
  });

  test("bulk ingest cannot escape a guarded project-message linkage final snapshot", async () => {
    const fake = activeFakeClient!;
    fake.__debug.seedChannel(
      {
        name: "linkage-bulk-race",
        project_id: "proj-valid",
        created_by: "a",
        created_at: "2026-08-07T09:00:00.000Z",
      },
      ["a"],
      [{
        id: 90101,
        uuid: "cccccccc-3333-4333-8333-cccccccccccc",
        session_id: "channel:linkage-bulk-race",
        from_agent: "a",
        to_agent: "linkage-bulk-race",
        channel: "linkage-bulk-race",
        project_id: null,
        content: "legacy",
        priority: "normal",
        blocking: false,
        reply_to: null,
        created_at: "2026-08-07T10:00:00.000Z",
        read_at: null,
      }],
    );

    const planResponse = await fetch(`${base}/v1/channels/linkage-bulk-race/project-message-linkage`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ project_id: "proj-valid", apply: false }),
    });
    const plan = await planResponse.json();
    const race = fake.__debug.armProjectLinkageBulkRace();
    const applyPromise = fetch(`${base}/v1/channels/linkage-bulk-race/project-message-linkage`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj-valid",
        expected_revision: plan.revision,
        idempotency_key: "server-linkage-bulk-race",
        apply: true,
      }),
    });

    await race.paused;
    const bulkPromise = fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{
        uuid: "dddddddd-4444-4444-8444-dddddddddddd",
        from: "b",
        to: "linkage-bulk-race",
        channel: "linkage-bulk-race",
        content: "arrived during apply",
      }] }),
    });
    await race.concurrentAttempt;
    const escapedBeforeApplyCommit = fake.__debug.messages.find(
      (message: any) => message.uuid === "dddddddd-4444-4444-8444-dddddddddddd",
    );
    race.release();

    const [applyResponse, bulkResponse] = await Promise.all([applyPromise, bulkPromise]);
    const applied = await applyResponse.json();
    const inserted = fake.__debug.messages.find(
      (message: any) => message.uuid === "dddddddd-4444-4444-8444-dddddddddddd",
    );

    expect(planResponse.status).toBe(200);
    expect(escapedBeforeApplyCommit).toBeUndefined();
    expect(applyResponse.status).toBe(201);
    expect(applied.target_message_uuids).toEqual(["cccccccc-3333-4333-8333-cccccccccccc"]);
    expect(bulkResponse.status).toBe(200);
    expect(inserted?.project_id).toBe("proj-valid");
  });

  test("PATCH renames the reachable iproj channel and preserves its member and message population", async () => {
    const source = "iproj-aws-consolidation";
    const target = "aws-consolidation";
    const archivedAt = "2026-08-07T23:59:00.000Z";
    const staleMetadata = {
      channel_schema: {
        class: "work-project",
        canonical_slug: source,
        github: { full_name: `hasnastudio/${source}` },
        repo_labels: [source, `hasnastudio/${source}`],
      },
    };
    const staleTags = [source, "hasnastudio", `repo:hasnastudio/${source}`];
    const currentMetadata = {
      channel_schema: {
        class: "work-project",
        canonical_slug: target,
        github: { full_name: `hasna/${target}` },
        repo_labels: [target, `hasna/${target}`],
      },
    };
    const currentTags = [target, "hasna", `repo:hasna/${target}`];
    const renameClient = makeFakeClient([]);
    renameClient.__debug.seedChannel(
      {
        id: "chn_0123456789abcdef0123456789abcdef",
        name: source,
        description: "Project channel for AWS Consolidation (iproj-aws-consolidation)",
        topic: null,
        project_id: null,
        created_by: "belisarius",
        created_at: "2026-07-23T08:15:39.778Z",
        archived_at: archivedAt,
        metadata: JSON.stringify(staleMetadata),
        tags: JSON.stringify(staleTags),
      },
      ["belisarius"],
      Array.from({ length: 28 }, (_, index) => ({
        id: index + 1,
        uuid: `message-${index + 1}`,
        channel: source,
        session_id: null,
        from_agent: "belisarius",
        to_agent: source,
        content: `message ${index + 1}`,
        created_at: `2026-07-23T08:${String(16 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
      })),
    );
    // Channel inventory cannot see this orphaned target edge because it has no
    // channels row, but the graph_edges unique key makes the old UPDATE fail.
    renameClient.__debug.graphEdges.push(
      { from_type: "agent", from_id: "belisarius", to_type: "channel", to_id: source, relation: "member_of" },
      { from_type: "agent", from_id: "belisarius", to_type: "channel", to_id: target, relation: "member_of" },
    );
    const renameKeys = new ApiKeyStore(renameClient as any);
    const renameVerifier = verifyApiKey({
      app: "conversations",
      signingSecret: SIGNING,
      keyStatus: async (): Promise<ApiKeyStatus> => "active",
    });
    const renameServer = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: { client: renameClient as any, keys: renameKeys, verifier: renameVerifier },
    });
    const renameBase = `http://127.0.0.1:${renameServer.port}`;
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };

    try {
      const patch = await fetch(`${renameBase}/v1/channels/${source}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: target,
          description: "Current canonical AWS consolidation channel",
          metadata: currentMetadata,
          tags: currentTags,
        }),
      });
      expect(patch.status).toBe(200);
      expect((await patch.json()).channel).toMatchObject({
        id: "chn_0123456789abcdef0123456789abcdef",
        name: target,
        description: "Current canonical AWS consolidation channel",
        project_id: null,
        archived_at: archivedAt,
        metadata: currentMetadata,
        tags: currentTags,
      });

      const got = await fetch(`${renameBase}/v1/channels/${target}`, {
        headers: { "x-api-key": rwKey },
      });
      expect(got.status).toBe(200);
      expect((await got.json()).channel).toMatchObject({
        id: "chn_0123456789abcdef0123456789abcdef",
        name: target,
        archived_at: archivedAt,
        metadata: currentMetadata,
        tags: currentTags,
        member_count: 1,
        message_count: 28,
      });

      const members = await fetch(`${renameBase}/v1/channels/${target}/members`, {
        headers: { "x-api-key": rwKey },
      });
      expect(members.status).toBe(200);
      expect((await members.json()).members).toEqual([
        expect.objectContaining({ channel: target, agent: "belisarius" }),
      ]);

      const messages = await fetch(`${renameBase}/v1/messages?channel=${target}&limit=100`, {
        headers: { "x-api-key": rwKey },
      });
      expect(messages.status).toBe(200);
      expect((await messages.json()).messages).toHaveLength(28);
    } finally {
      renameServer.stop(true);
    }
  });

  test("PATCH rolls back the channel id and name when a rename dependency update fails", async () => {
    const source = "rollback-source";
    const target = "rollback-target";
    const stableId = "chn_fedcba9876543210fedcba9876543210";
    const renameClient = makeFakeClient([]);
    renameClient.__debug.seedChannel(
      {
        id: stableId,
        name: source,
        description: null,
        topic: null,
        project_id: null,
        created_by: "alice",
        created_at: "2026-08-07T00:00:00.000Z",
        archived_at: null,
        metadata: null,
        tags: null,
      },
      ["alice"],
      [{
        id: 1,
        uuid: "rollback-message",
        channel: source,
        session_id: `channel:${source}`,
        from_agent: "alice",
        to_agent: source,
        content: "keep me",
        created_at: "2026-08-07T00:00:01.000Z",
      }],
    );
    renameClient.__debug.failRenameWhen(/UPDATE channel_members/i);
    const renameServer = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: {
        client: renameClient as any,
        keys: new ApiKeyStore(renameClient as any),
        verifier: verifyApiKey({
          app: "conversations",
          signingSecret: SIGNING,
          keyStatus: async (): Promise<ApiKeyStatus> => "active",
        }),
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${renameServer.port}/v1/channels/${source}`, {
        method: "PATCH",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({ name: target }),
      });

      expect(response.status).toBe(400);
      expect(renameClient.__debug.channels[source]?.id).toBe(stableId);
      expect(renameClient.__debug.channels[target]).toBeUndefined();
      expect(renameClient.__debug.channelMembers.has(`${source}:alice`)).toBe(true);
      expect(renameClient.__debug.channelMembers.has(`${target}:alice`)).toBe(false);
      expect(renameClient.__debug.messages[0]).toMatchObject({
        channel: source,
        session_id: `channel:${source}`,
        to_agent: source,
      });
    } finally {
      renameServer.stop(true);
    }
  });

  test("PATCH rename arms the scope-rewrite GUC only when reparent is requested", async () => {
    const source = "reparent-source";
    const target = "reparent-target";
    const finalName = "reparent-final";
    const renameClient = makeFakeClient([]);
    renameClient.__debug.seedChannel(
      {
        id: "chn_abcdef0123456789abcdef0123456789",
        name: source,
        description: null,
        topic: null,
        project_id: null,
        created_by: "alice",
        created_at: "2026-08-07T00:00:00.000Z",
        archived_at: null,
        metadata: null,
        tags: null,
      },
      ["alice"],
      [{
        id: 1,
        uuid: "reparent-root",
        channel: source,
        session_id: `channel:${source}`,
        from_agent: "alice",
        to_agent: source,
        content: "root",
        created_at: "2026-08-07T00:00:01.000Z",
      }],
    );
    const renameServer = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: {
        client: renameClient as any,
        keys: new ApiKeyStore(renameClient as any),
        verifier: verifyApiKey({
          app: "conversations",
          signingSecret: SIGNING,
          keyStatus: async (): Promise<ApiKeyStatus> => "active",
        }),
      },
    });
    const renameBase = `http://127.0.0.1:${renameServer.port}`;
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };

    try {
      const plain = await fetch(`${renameBase}/v1/channels/${source}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: target }),
      });
      expect(plain.status).toBe(200);
      expect(renameClient.__debug.scopeRewriteCalls).toHaveLength(0);

      const reparent = await fetch(`${renameBase}/v1/channels/${target}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: finalName, reparent: true }),
      });
      expect(reparent.status).toBe(200);
      expect(renameClient.__debug.scopeRewriteCalls).toHaveLength(1);
      const guard = JSON.parse(String(renameClient.__debug.scopeRewriteCalls[0].params[0])) as Record<string, unknown>;
      expect(guard).toMatchObject({
        old_session_id: `channel:${target}`,
        new_session_id: `channel:${finalName}`,
        old_channel: target,
        new_channel: finalName,
        old_to_agent: target,
        new_to_agent: finalName,
      });
    } finally {
      renameServer.stop(true);
    }
  });

  // Regression cover for HC-00148, server layer. POST /v1/messages built its
  // INSERT without a reply_to column and never read reply_to off the body, so a
  // threaded reply came back 201 and stored as a top-level post. The local
  // SQLite path was always correct, which is why the suite stayed green.
  test("POST /v1/messages persists reply_to, and GET reads the parent link back", async () => {
    await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ name: "threads", created_by: "test" }),
    });

    const root = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: "root post", channel: "threads" }),
    });
    expect(root.status).toBe(201);
    const rootBody = await root.json();
    const rootId = rootBody.message.id as number;
    // A root post must carry no parent — guards against "threads everything".
    expect(rootBody.message.reply_to ?? null).toBeNull();

    const reply = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "b",
        to: "a",
        content: "threaded answer",
        channel: "threads",
        reply_to: rootId,
        reply_to_uuid: rootBody.message.uuid,
      }),
    });
    expect(reply.status).toBe(201);
    const replyId = (await reply.json()).message.id as number;

    // READ-BACK through GET (a different handler than the POST that wrote it).
    const got = await fetch(`${base}/v1/messages/${replyId}`, { headers: { "x-api-key": rwKey } });
    expect(got.status).toBe(200);
    const stored = (await got.json()).message;
    expect(stored.id).toBe(replyId);
    expect(stored.reply_to).toBe(rootId);
  });

  test("POST /v1/messages preserves a caller-bound UUID across mention fanout", async () => {
    const uuid = "11111111-2222-4333-8444-555555555555";
    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        uuid,
        from: "alice",
        to: "threads",
        channel: "threads",
        content: "immutable identity @bob",
      }),
    });
    expect(sent.status).toBe(201);
    const body = await sent.json();

    expect(body.message).toMatchObject({
      uuid,
      channel: "threads",
      content: "immutable identity @bob",
    });
    const readback = await fetch(`${base}/v1/messages/by-uuid/${uuid}`, {
      headers: { "x-api-key": rwKey },
    });
    expect(readback.status).toBe(200);
    expect((await readback.json()).message).toMatchObject({ id: body.message.id, uuid });
    const stored = activeFakeClient!.__debug.messages.find((message) => message.uuid === uuid);
    expect(stored?.channel).toBe("threads");
  });

  test("POST /v1/messages resolves reply_to_uuid and persists the exact numeric parent id", async () => {
    const root = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        from: "alice",
        to: "threads",
        channel: "threads",
        content: "uuid parent",
      }),
    });
    const rootMessage = (await root.json()).message;

    const reply = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        uuid: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        from: "bob",
        to: "threads",
        channel: "threads",
        content: "uuid child",
        reply_to_uuid: rootMessage.uuid,
      }),
    });
    expect(reply.status).toBe(201);
    expect((await reply.json()).message.reply_to).toBe(rootMessage.id);
  });

  test("POST /v1/messages rejects cross-channel and cross-session reply parents", async () => {
    for (const name of ["reply-left", "reply-right"]) {
      const created = await fetch(`${base}/v1/channels`, {
        method: "POST",
        headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
        body: JSON.stringify({ name, created_by: "test" }),
      });
      expect(created.status).toBe(201);
    }
    const sendParent = async (channel: string) => {
      const response = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: "alice", channel, content: `${channel} parent` }),
      });
      expect(response.status).toBe(201);
      return (await response.json()).message as { id: number; uuid: string };
    };
    const leftParent = await sendParent("reply-left");
    const rightParent = await sendParent("reply-right");
    const before = activeFakeClient!.__debug.messages.length;

    const crossChannel = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "bob",
        channel: "reply-right",
        content: "cross-channel reply",
        reply_to_uuid: leftParent.uuid,
      }),
    });
    const crossSession = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "bob",
        channel: "reply-right",
        session_id: "channel:another-session",
        content: "cross-session reply",
        reply_to: rightParent.id,
        reply_to_uuid: rightParent.uuid,
      }),
    });

    expect(crossChannel.status).toBe(409);
    expect((await crossChannel.json()).error).toContain("does not match parent channel");
    expect(crossSession.status).toBe(409);
    expect((await crossSession.json()).error).toContain("does not match parent session");
    expect(activeFakeClient!.__debug.messages).toHaveLength(before);
  });

  test("POST /v1/messages rejects a send to an archived channel with an archived-channel error", async () => {
    // Hosted regression for todos 9b502ed8 (archived-writes): the send handler
    // selected only name/project_id, so an archived channel still accepted
    // posts. The guard must mirror the local path and refuse with a usable
    // error naming the archived state, writing nothing.
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "retired-on-server", created_by: "test" }),
    });
    expect(created.status).toBe(201);
    activeFakeClient!.__debug.channels["retired-on-server"].archived_at = "2026-08-19T00:00:00.000Z";
    const before = activeFakeClient!.__debug.messages.length;

    const response = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "alice", channel: "retired-on-server", content: "late arrival" }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("is archived");
    expect(activeFakeClient!.__debug.messages).toHaveLength(before);
  });

  test("POST /v1/messages still allows a reply into a channel archived after the parent", async () => {
    // Same reply-exempt carve-out as the local path: a reply derives its
    // channel from the parent, so refusing it would strand the parent thread.
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "retired-after-parent", created_by: "test" }),
    });
    expect(created.status).toBe(201);
    const sendParent = async (channel: string) => {
      const response = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: "alice", channel, content: `${channel} parent` }),
      });
      expect(response.status).toBe(201);
      return (await response.json()).message as { id: number; uuid: string };
    };
    const parent = await sendParent("retired-after-parent");
    activeFakeClient!.__debug.channels["retired-after-parent"].archived_at = "2026-08-19T00:00:00.000Z";

    const reply = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "bob",
        channel: "retired-after-parent",
        content: "a correction to the original report",
        reply_to: parent.id,
        reply_to_uuid: parent.uuid,
      }),
    });

    expect(reply.status).toBe(201);
    expect((await reply.json()).message.reply_to).toBe(parent.id);
  });

  test("POST /v1/messages rejects numeric-only and mismatched reply identities before writing", async () => {
    const root = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        uuid: "cccccccc-dddd-4eee-8fff-000000000000",
        from: "alice",
        to: "threads",
        channel: "threads",
        content: "strict parent",
      }),
    });
    const rootMessage = (await root.json()).message;
    const before = activeFakeClient!.__debug.messages.length;

    const numericOnly = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "bob",
        to: "threads",
        channel: "threads",
        content: "numeric only",
        reply_to: rootMessage.id,
      }),
    });
    expect(numericOnly.status).toBe(400);

    const mismatched = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "bob",
        to: "threads",
        channel: "threads",
        content: "mismatched pair",
        reply_to: rootMessage.id + 1,
        reply_to_uuid: rootMessage.uuid,
      }),
    });
    expect(mismatched.status).toBe(409);
    expect(activeFakeClient!.__debug.messages).toHaveLength(before);
  });

  test("POST /v1/messages rejects a reply_to that names no existing message", async () => {
    // reply_to has no FK, so an unvalidated bogus parent would insert a dangling
    // pointer and read back as unthreaded — a success that lost the linkage.
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "a",
        to: "b",
        content: "orphan",
        channel: "threads",
        reply_to_uuid: "dddddddd-eeee-4fff-8000-111111111111",
      }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("not found");
  });

  test("POST /v1/messages rejects a non-numeric reply_to", async () => {
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "a",
        to: "b",
        content: "bad target",
        channel: "threads",
        reply_to: "not-a-number",
        reply_to_uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("positive integer");
  });

  test("POST /v1/messages stores attachment bytes atomically and GET reads them back exactly", async () => {
    const text = Buffer.from("synthetic API attachment\n");
    const pdf = Buffer.from("synthetic API PDF\n");
    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "alice",
        to: "threads",
        channel: "threads",
        content: "remote files",
        attachments: [
          { name: "evidence.txt", content_base64: text.toString("base64") },
          { name: "handoff.pdf", content_base64: pdf.toString("base64") },
        ],
      }),
    });

    expect(sent.status).toBe(201);
    const message = (await sent.json()).message;
    expect(message.attachments).toEqual([
      {
        name: "evidence.txt",
        path: `/v1/messages/${message.id}/attachments/evidence.txt`,
        size: text.length,
        mime_type: "text/plain",
      },
      {
        name: "handoff.pdf",
        path: `/v1/messages/${message.id}/attachments/handoff.pdf`,
        size: pdf.length,
        mime_type: "application/pdf",
      },
    ]);
    expect(JSON.stringify(message)).not.toContain("content_base64");
    expect(activeFakeClient!.__debug.messageAttachments).toHaveLength(2);

    const downloadedText = await fetch(
      `${base}/v1/messages/${message.id}/attachments/evidence.txt`,
      { headers: { "x-api-key": rwKey } },
    );
    expect(downloadedText.status).toBe(200);
    expect(downloadedText.headers.get("content-type")).toBe("text/plain");
    expect(Buffer.from(await downloadedText.arrayBuffer())).toEqual(text);

    const downloadedPdf = await fetch(
      `${base}/v1/messages/${message.id}/attachments/handoff.pdf`,
      { headers: { "x-api-key": rwKey } },
    );
    expect(downloadedPdf.status).toBe(200);
    expect(downloadedPdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await downloadedPdf.arrayBuffer())).toEqual(pdf);

    const encoded = await fetch(
      `${base}/v1/messages/${message.id}/attachments/evidence.txt?encoding=base64`,
      { headers: { "x-api-key": rwKey } },
    );
    expect(encoded.status).toBe(200);
    expect(encoded.headers.get("content-type")).toContain("application/json");
    expect(await encoded.json()).toEqual({
      name: "evidence.txt",
      mime_type: "text/plain",
      size: text.length,
      content_base64: text.toString("base64"),
    });

    const missingName = await fetch(
      `${base}/v1/messages/${message.id}/attachments/absent.txt?encoding=base64`,
      { headers: { "x-api-key": rwKey } },
    );
    expect(missingName.status).toBe(404);
    expect(await missingName.json()).toMatchObject({
      code: "ATTACHMENT_NOT_FOUND",
      error: `Requested attachment not found on message #${message.id}`,
    });

    const missingMessage = await fetch(
      `${base}/v1/messages/999999999/attachments/absent.txt?encoding=base64`,
      { headers: { "x-api-key": rwKey } },
    );
    expect(missingMessage.status).toBe(404);
    expect(await missingMessage.json()).toMatchObject({
      code: "MESSAGE_NOT_FOUND",
      error: "Message #999999999 not found",
    });

    const denied = await fetch(
      `${base}/v1/messages/${message.id}/attachments/evidence.txt?encoding=base64`,
    );
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({
      reason: "missing_token",
      error: "Missing API key. Send it as 'x-api-key: <key>' or 'Authorization: Bearer <key>'.",
    });
  });

  test("POST /v1/messages rejects invalid or unsupported attachments before inserting a message", async () => {
    const before = activeFakeClient!.__debug.messages.length;
    const invalidBase64 = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "alice",
        to: "threads",
        channel: "threads",
        content: "invalid attachment",
        attachments: [{ name: "evidence.txt", content_base64: "not base64!" }],
      }),
    });
    expect(invalidBase64.status).toBe(400);

    const unsupported = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "alice",
        to: "threads",
        channel: "threads",
        content: "unsupported attachment",
        attachments: [{
          name: "payload.exe",
          content_base64: Buffer.from("synthetic unsupported payload\n").toString("base64"),
        }],
      }),
    });
    expect(unsupported.status).toBe(400);
    expect(activeFakeClient!.__debug.messages).toHaveLength(before);
    expect(activeFakeClient!.__debug.messageAttachments).toHaveLength(2);
  });

  test("POST /v1/messages rejects archive and compressed attachment extensions before inserting a message", async () => {
    const beforeMessages = activeFakeClient!.__debug.messages.length;
    const beforeAttachments = activeFakeClient!.__debug.messageAttachments.length;
    const compressedFinding = gzipSync(Buffer.from(`attachment ${syntheticDatabaseUrl()}`));

    for (const extension of ["bundle", "zip", "gz", "tgz", "tar"]) {
      const response = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: "alice",
          to: "threads",
          channel: "threads",
          content: `must not persist ${extension}`,
          attachments: [{
            name: `opaque.${extension}`,
            content_base64: compressedFinding.toString("base64"),
          }],
        }),
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain(
        "Archive and compressed attachment types are not supported securely",
      );
      expect(activeFakeClient!.__debug.messages).toHaveLength(beforeMessages);
      expect(activeFakeClient!.__debug.messageAttachments).toHaveLength(beforeAttachments);
    }
  });

  test("POST /v1/channels links a valid project id", async () => {
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        name: "internal-chief-of-harness",
        created_by: "test",
        project_id: "proj-valid",
      }),
    });

    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.channel.project_id).toBe("proj-valid");
  });

  test("POST /v1/channels preserves metadata/tags, normalizes name, and auto-joins creator", async () => {
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        name: "#Internal Chief Harness Class!",
        created_by: "creator-agent",
        project_id: "proj-valid",
        metadata: { channel_schema: { class: "loop-lane" }, owner: "harness" },
        tags: ["team:harness", "project"],
      }),
    });

    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.channel).toMatchObject({
      name: "internal-chief-harness-class",
      project_id: "proj-valid",
      metadata: { channel_schema: { class: "loop-lane" }, owner: "harness" },
      tags: ["team:harness", "project"],
      member_count: 1,
    });

    const got = await fetch(`${base}/v1/channels/%23Internal%20Chief%20Harness%20Class!`, { headers: { "x-api-key": rwKey } });
    expect(got.status).toBe(200);
    const fetched = await got.json();
    expect(fetched.channel.metadata.channel_schema.class).toBe("loop-lane");
    expect(fetched.channel.member_count).toBe(1);
  });

  test("reserved channel aliases reject create/send/read without creating duplicates", async () => {
    const fake = activeFakeClient!;
    fake.__debug.seedChannel({
      id: "chn_00000000000000000000000000000054",
      name: "agent-chief-research",
      description: null,
      topic: null,
      project_id: null,
      created_by: "agent-chief-research",
      created_at: "2026-08-21T00:00:00.000Z",
      archived_at: null,
      metadata: null,
      tags: null,
    }, ["agent-chief-research"], []);
    fake.__debug.channelAliases["chief-research"] = "agent-chief-research";
    const aliasError = "Channel #chief-research is a reserved historical alias for #agent-chief-research.";

    const create = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ name: "chief-research", created_by: "agent-chief-research" }),
    });
    expect(create.status).toBe(409);
    expect(await create.json()).toEqual({ error: aliasError });

    const send = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        from: "agent-chief-research",
        to: "chief-research",
        channel: "chief-research",
        content: "alias must not write",
      }),
    });
    expect(send.status).toBe(409);
    expect(await send.json()).toEqual({ error: aliasError });

    const read = await fetch(`${base}/v1/messages?channel=chief-research&since=2026-08-20T00:00:00.000Z`, {
      headers: { "x-api-key": rwKey },
    });
    expect(read.status).toBe(409);
    expect(await read.json()).toEqual({ error: aliasError });

    const canonicalSend = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        from: "agent-chief-research",
        to: "agent-chief-research",
        channel: "agent-chief-research",
        content: "canonical channel remains usable",
      }),
    });
    expect(canonicalSend.status).toBe(201);
    expect((await canonicalSend.json()).message.channel).toBe("agent-chief-research");
    expect(fake.__debug.channels["chief-research"]).toBeUndefined();
    expect(fake.__debug.channels["agent-chief-research"]).toBeDefined();
    expect(fake.__debug.messages.filter((message: any) => message.content === "alias must not write")).toHaveLength(0);
    expect(fake.__debug.messages.filter((message: any) => message.content === "canonical channel remains usable").map((message: any) => message.channel))
      .toEqual(["agent-chief-research"]);
  });

  test("reserved channel aliases reject pinned and for-agent reads before querying", async () => {
    const fake = activeFakeClient!;
    fake.__debug.channelAliases["chief-research"] = "agent-chief-research";
    const aliasError = "Channel #chief-research is a reserved historical alias for #agent-chief-research.";

    const pinnedQueryMark = fake.__debug.manyCalls.length;
    const pinned = await fetch(`${base}/v1/messages/pinned?channel=chief-research`, {
      headers: { "x-api-key": rwKey },
    });
    expect(pinned.status).toBe(409);
    expect(await pinned.json()).toEqual({ error: aliasError });
    expect(fake.__debug.manyCalls.slice(pinnedQueryMark).filter((call: any) => /FROM messages/i.test(call.sql))).toHaveLength(0);

    const mentionQueryMark = fake.__debug.manyCalls.length;
    const mentions = await fetch(`${base}/v1/messages/for-agent?agent=reader&channel=chief-research`, {
      headers: { "x-api-key": rwKey },
    });
    expect(mentions.status).toBe(409);
    expect(await mentions.json()).toEqual({ error: aliasError });
    expect(fake.__debug.manyCalls.slice(mentionQueryMark).filter((call: any) => /FROM messages/i.test(call.sql))).toHaveLength(0);
  });

  test("POST /v1/channels reports rejected project_id with field and reason", async () => {
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        name: "internal-chief-of-harness-rejected",
        created_by: "test",
        project_id: "wks_xMeijBDhYFBzxXtPlttyw",
      }),
    });

    expect(created.status).toBe(400);
    const body = await created.json();
    expect(body).toMatchObject({
      error: "Validation failed",
      code: "invalid_project_id",
      field: "project_id",
      value: "wks_xMeijBDhYFBzxXtPlttyw",
    });
    expect(body.reason).toContain("No conversations project exists");
    expect(body.hint).toContain("/v1/projects");

    const retry = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        name: "internal-chief-of-harness-rejected",
        created_by: "test",
      }),
    });
    expect(retry.status).toBe(201);
  });

  test("POST /v1/channels rolls back the channel when creator auto-join fails", async () => {
    activeFakeClient!.__debug.failNextChannelMemberInsert();
    const failed = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        name: "atomic-channel-create",
        created_by: "test",
        project_id: "proj-valid",
      }),
    });
    expect(failed.status).toBe(400);

    const retry = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        name: "atomic-channel-create",
        created_by: "test",
        project_id: "proj-valid",
      }),
    });
    expect(retry.status).toBe(201);
  });

  test("POST /v1/messages validates required fields", async () => {
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a" }),
    });
    expect(r.status).toBe(400);
  });

  test("POST /v1/messages/bulk is idempotent (ON CONFLICT by uuid)", async () => {
    const batch = {
      messages: [
        { uuid: "bulk-1", from: "a", to: "b", content: "one", channel: "backfill", created_at: "2026-01-01T00:00:00.000Z" },
        { uuid: "bulk-2", from: "a", to: "b", content: "two", channel: "backfill", created_at: "2026-01-02T00:00:00.000Z" },
      ],
    };
    const first = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    expect(first.status).toBe(200);
    const b1 = await first.json();
    expect(b1.requested).toBe(2);
    expect(b1.inserted).toBe(2);
    expect(b1.skipped).toBe(0);

    // Re-run the same batch → nothing new inserted, no duplicates.
    const second = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    const b2 = await second.json();
    expect(b2.inserted).toBe(0);
    expect(b2.skipped).toBe(2);
    expect(b2.total).toBe(b1.total); // count unchanged on re-run
  });

  test("bulk ingest blocks sensitive content generically without echo or insertion", async () => {
    const blocked = syntheticDatabaseUrl();
    const before = activeFakeClient!.__debug.messages.length;
    const r = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ uuid: "bulk-sensitive-content", from: "a", to: "b", content: `blocked ${blocked}` }] }),
    });
    const text = await r.text();

    expect({
      status: r.status,
      generic: text.includes("sensitive content detected"),
      echoed: text.includes(blocked),
      inserted: activeFakeClient!.__debug.messages.length - before,
    }).toEqual({ status: 400, generic: true, echoed: false, inserted: 0 });
  });

  test("bulk ingest validates the same persisted string fields before writing", async () => {
    const blocked = syntheticDatabaseUrl();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["content", { content: `blocked ${blocked}` }],
      ["from", { from: blocked }],
      ["to", { to: blocked }],
      ["channel", { channel: blocked }],
      ["project", { project_id: blocked }],
      ["explicit-session", { session_id: blocked }],
    ];
    const outcomes: Array<Record<string, unknown>> = [];

    for (const [label, override] of cases) {
      const before = activeFakeClient!.__debug.messages.length;
      const r = await fetch(`${base}/v1/messages/bulk`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ uuid: `bulk-sensitive-${label}`, from: "source", to: "target", content: "safe", ...override }],
        }),
      });
      const text = await r.text();
      outcomes.push({
        label,
        status: r.status,
        generic: text.includes("sensitive content detected"),
        echoed: text.includes(blocked),
        inserted: activeFakeClient!.__debug.messages.length - before,
      });
    }

    const derived = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ uuid: "bulk-derived-session-safe", from: "source", to: "target", content: "safe" }] }),
    });
    expect(derived.status).toBe(200);
    expect(activeFakeClient!.__debug.messages.find((m) => m.uuid === "bulk-derived-session-safe")?.session_id).toBe("api:source");
    expect(outcomes).toEqual(cases.map(([label]) => ({
      label, status: 400, generic: true, echoed: false, inserted: 0,
    })));
  });

  test("bulk ingest rejects a mixed safe and sensitive batch atomically", async () => {
    const blocked = syntheticDatabaseUrl();
    const before = activeFakeClient!.__debug.messages.length;
    const r = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [
        { uuid: "bulk-atomic-safe", from: "a", to: "b", content: "safe" },
        { uuid: "bulk-atomic-sensitive", from: "a", to: "b", content: `blocked ${blocked}` },
      ] }),
    });
    const text = await r.text();

    expect({
      status: r.status,
      generic: text.includes("sensitive content detected"),
      echoed: text.includes(blocked),
      inserted: activeFakeClient!.__debug.messages.length - before,
    }).toEqual({ status: 400, generic: true, echoed: false, inserted: 0 });
  });

  test("authenticated bulk ingest accepts same-thread replies and rejects cross-channel or cross-session parents", async () => {
    const fake = activeFakeClient!;
    fake.__debug.seedChannel({
      id: "chn_00000000000000000000000000000081",
      name: "bulk-left",
      project_id: "proj-valid",
      created_by: "tester",
      created_at: "2026-08-09T00:00:00.000Z",
    }, [], [{
      id: 8101,
      uuid: "81000000-0000-4000-8000-000000000001",
      session_id: "channel:bulk-left",
      from_agent: "alice",
      to_agent: "bulk-left",
      channel: "bulk-left",
      project_id: "proj-valid",
      content: "left parent",
      priority: "normal",
      reply_to: null,
      created_at: "2026-08-09T00:01:00.000Z",
    }]);
    fake.__debug.seedChannel({
      id: "chn_00000000000000000000000000000082",
      name: "bulk-right",
      project_id: "proj-valid",
      created_by: "tester",
      created_at: "2026-08-09T00:00:00.000Z",
    }, [], [{
      id: 8201,
      uuid: "82000000-0000-4000-8000-000000000001",
      session_id: "channel:bulk-right",
      from_agent: "alice",
      to_agent: "bulk-right",
      channel: "bulk-right",
      project_id: "proj-valid",
      content: "right parent",
      priority: "normal",
      reply_to: null,
      created_at: "2026-08-09T00:02:00.000Z",
    }]);

    const ingest = (message: Record<string, unknown>) => fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [message] }),
    });
    const sameThread = await ingest({
      uuid: "82000000-0000-4000-8000-000000000002",
      from: "bob",
      to: "bulk-right",
      channel: "bulk-right",
      project_id: "proj-valid",
      session_id: "channel:bulk-right",
      content: "same-thread child",
      reply_to: 8201,
    });
    const crossChannel = await ingest({
      uuid: "82000000-0000-4000-8000-000000000003",
      from: "bob",
      to: "bulk-right",
      channel: "bulk-right",
      project_id: "proj-valid",
      session_id: "channel:bulk-left",
      content: "cross-channel child",
      reply_to: 8101,
    });
    const crossSession = await ingest({
      uuid: "82000000-0000-4000-8000-000000000004",
      from: "bob",
      to: "bulk-right",
      channel: "bulk-right",
      project_id: "proj-valid",
      session_id: "channel:another-session",
      content: "cross-session child",
      reply_to: 8201,
    });

    expect(sameThread.status).toBe(200);
    expect((await sameThread.json()).inserted).toBe(1);
    const duplicate = await ingest({
      uuid: "82000000-0000-4000-8000-000000000002",
      from: "bob",
      to: "bulk-right",
      channel: "bulk-right",
      project_id: "proj-valid",
      session_id: "channel:bulk-left",
      content: "duplicate payload is skipped",
      reply_to: 8101,
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ inserted: 0, skipped: 1 });
    expect(crossChannel.status).toBe(400);
    expect((await crossChannel.json()).error).toContain("does not match parent channel");
    expect(crossSession.status).toBe(400);
    expect((await crossSession.json()).error).toContain("does not match parent session");
    expect(fake.__debug.messages.some((message) => message.uuid === "82000000-0000-4000-8000-000000000003"))
      .toBe(false);
    expect(fake.__debug.messages.some((message) => message.uuid === "82000000-0000-4000-8000-000000000004"))
      .toBe(false);
  });

  test("bulk channel inserts create case-insensitive deduped mentions and notification DMs", async () => {
    const r = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{
        uuid: "bulk-mentions-new",
        from: "Sender",
        to: "alerts",
        channel: "alerts",
        content: "Hello @Alpha, @alpha, @BETA, and @Sender",
      }] }),
    });
    const body = await r.json();
    const source = activeFakeClient!.__debug.messages.find((m) => m.uuid === "bulk-mentions-new");
    const mentions = activeFakeClient!.__debug.messageMentions
      .filter((m) => m.message_id === source?.id)
      .map((m) => m.mentioned_agent)
      .sort();
    const notificationRecipients = activeFakeClient!.__debug.messages
      .filter((m) => {
        try { return JSON.parse(m.metadata ?? "null")?.source_message_id === source?.id; } catch { return false; }
      })
      .map((m) => m.to_agent)
      .sort();

    expect(body.inserted).toBe(1);
    expect(mentions).toEqual(["alpha", "beta", "sender"]);
    expect(notificationRecipients).toEqual(["alpha", "beta"]);
  });

  test("bulk mention fanout processes only newly returned rows across idempotent reruns", async () => {
    const first = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{
        uuid: "bulk-mentions-idempotent",
        from: "sender",
        to: "alerts",
        channel: "alerts",
        content: "Hello @First",
      }] }),
    });
    const firstBody = await first.json();
    const source = activeFakeClient!.__debug.messages.find((m) => m.uuid === "bulk-mentions-idempotent");
    const afterFirst = activeFakeClient!.__debug.messages.length;

    const rerun = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [
        {
          uuid: "bulk-mentions-idempotent",
          from: "sender",
          to: "alerts",
          channel: "alerts",
          content: "Changed duplicate payload @Second",
        },
        {
          uuid: "bulk-mentions-new-on-rerun",
          from: "sender",
          to: "alerts",
          channel: "alerts",
          content: "Actually new @Third",
        },
      ] }),
    });
    const rerunBody = await rerun.json();
    const mentionAgents = activeFakeClient!.__debug.messageMentions.map((m) => m.mentioned_agent);
    const sourceMentions = activeFakeClient!.__debug.messageMentions.filter((m) => m.message_id === source?.id);
    const notifications = activeFakeClient!.__debug.messages.filter((m) => {
      try { return JSON.parse(m.metadata ?? "null")?.type === "mention_notification"; } catch { return false; }
    });

    expect(firstBody.inserted).toBe(1);
    expect(rerunBody).toMatchObject({ requested: 2, inserted: 1, skipped: 1 });
    expect(rerunBody.total - firstBody.total).toBe(2); // one source row + its one notification DM
    expect(activeFakeClient!.__debug.messages.length - afterFirst).toBe(2);
    expect(sourceMentions.map((m) => m.mentioned_agent)).toEqual(["first"]);
    expect(mentionAgents).toContain("third");
    expect(mentionAgents).not.toContain("second");
    expect(notifications.filter((m) => m.to_agent === "first")).toHaveLength(1);
    expect(notifications.filter((m) => m.to_agent === "third")).toHaveLength(1);
    expect(notifications.filter((m) => m.to_agent === "second")).toHaveLength(0);
  });

  test("bulk ingest preserves empty and maximum batch boundaries and counts", async () => {
    const before = activeFakeClient!.__debug.messages.length;
    const empty = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(await empty.json()).toEqual({ requested: 0, inserted: 0, skipped: 0, total: before });

    const maxBatch = Array.from({ length: 2000 }, (_, i) => ({
      uuid: `bulk-max-${i}`,
      from: "a",
      to: "b",
      content: `safe ${i}`,
    }));
    const max = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: maxBatch }),
    });
    const maxBody = await max.json();
    expect(max.status).toBe(200);
    expect(maxBody).toEqual({ requested: 2000, inserted: 2000, skipped: 0, total: before + 2000 });

    const over = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [...maxBatch, { uuid: "bulk-over", from: "a", to: "b", content: "safe" }] }),
    });
    expect(over.status).toBe(400);
    expect(activeFakeClient!.__debug.messages.length).toBe(before + 2000);
  });

  test("bulk ingest requires the write scope (read-only key -> 403)", async () => {
    const r = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": roKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ uuid: "ro-1", from: "a", to: "b", content: "x" }] }),
    });
    expect(r.status).toBe(403);
  });

  test("bulk ingest rejects a non-array body and missing fields", async () => {
    const bad = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: "nope" }),
    });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ from: "a", to: "b" }] }),
    });
    expect(missing.status).toBe(400);
  });

  test("GET /v1/messages?count=1 returns a numeric count", async () => {
    const b = await (await fetch(`${base}/v1/messages?count=1`, { headers: { "x-api-key": rwKey } })).json();
    expect(typeof b.count).toBe("number");
  });

  test("GET /v1/messages/pinned uses the deterministic id tie-breaker", async () => {
    const response = await fetch(`${base}/v1/messages/pinned`, {
      headers: { "x-api-key": rwKey },
    });
    expect(response.status).toBe(200);

    const query = activeFakeClient!.__debug.manyCalls.at(-1)!;
    expect(query.sql).toContain("ORDER BY pinned_at DESC, id DESC");
    expect(query.sql).not.toContain("ORDER BY pinned_at DESC LIMIT");
  });

  test("GET /v1/messages with since_id selects the oldest unseen ids", async () => {
    const response = await fetch(`${base}/v1/messages?since_id=42&limit=2&order=desc`, {
      headers: { "x-api-key": rwKey },
    });
    expect(response.status).toBe(200);
    // The reactions envelope is a separate grouped query that lands AFTER the
    // message projection, so assert on the last MESSAGE query, not the last call.
    const query = [...activeFakeClient!.__debug.manyCalls].reverse().find((c) => /FROM messages/i.test(c.sql))!;
    expect(query.sql).toContain("id > $");
    expect(query.sql).toContain("ORDER BY id ASC");
    expect(query.sql).not.toContain("ORDER BY created_at");
  });

  test("HTTP search accepts an exact cutoff and rejects malformed timestamps", async () => {
    const valid = await fetch(`${base}/v1/messages?q=POLICY&since=2026-08-02T12%3A00%3A00.000Z`, {
      headers: { "x-api-key": rwKey },
    });
    expect(valid.status).toBe(200);
    const searchQuery = [...activeFakeClient!.__debug.manyCalls].reverse().find((c) => /FROM messages/i.test(c.sql))!;
    expect(searchQuery.sql).toContain("created_at >= $");
    expect(searchQuery.params).toContain("2026-08-02T12:00:00.000Z");

    const invalid = await fetch(`${base}/v1/messages?q=POLICY&since=yesterday`, {
      headers: { "x-api-key": rwKey },
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain("since must be a valid ISO 8601 date");
  });

  test("POST /v1/messages blocks sensitive content without echoing it", async () => {
    const blocked = syntheticDatabaseUrl();
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: `blocked ${blocked}` }),
    });
    const text = await r.text();

    expect(r.status).toBe(400);
    expect(text).toContain("sensitive content detected");
    expect(text).not.toContain(blocked);
  });

  test("POST /v1/messages blocks sensitive persisted routing fields without echoing them", async () => {
    const blocked = syntheticDatabaseUrl();
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: blocked, content: "safe body" }),
    });
    const text = await r.text();

    expect(r.status).toBe(400);
    expect(text).toContain("sensitive content detected");
    expect(text).not.toContain(blocked);
  });

  test("POST /v1/messages blocks sensitive metadata without echoing or inserting it", async () => {
    const blocked = syntheticDatabaseUrl();
    const before = activeFakeClient!.__debug.messages.length;
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        from: "a",
        to: "b",
        content: "safe body",
        metadata: { nested: { dsn: blocked } },
      }),
    });
    const text = await r.text();

    expect(r.status).toBe(400);
    expect(text).toContain("sensitive content detected");
    expect(text).not.toContain(blocked);
    expect(activeFakeClient!.__debug.messages).toHaveLength(before);
  });

  test("GET /v1/messages redacts sensitive legacy content", async () => {
    const blocked = syntheticDatabaseUrl();
    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: "safe before legacy mutation" }),
    });
    const created = await sent.json() as any;
    // Mutate the fake backing store through the route's own insert path shape.
    await activeFakeClient!.get(
      `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content, priority, blocking)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      ["legacy", "legacy", "b", null, null, `legacy ${blocked}`, "normal", false],
    );

    const listText = await (await fetch(`${base}/v1/messages`, { headers: { "x-api-key": rwKey } })).text();
    const getText = await (await fetch(`${base}/v1/messages/${created.message.id}`, { headers: { "x-api-key": rwKey } })).text();

    expect(listText).toContain("[REDACTED:DATABASE_URL]");
    expect(listText).not.toContain(blocked);
    expect(getText).not.toContain(blocked);
  });

  test("GET /v1/openapi.json is served for SDK discovery", async () => {
    const b = await (await fetch(`${base}/v1/openapi.json`)).json();
    expect(b.openapi).toBeTruthy();
    expect(Object.keys(b.paths).length).toBeGreaterThan(5);

    // The typed SDK is generated from this schema. A server implementation
    // that accepts reply_to is not sufficient if the public contract omits it:
    // generated clients then cannot express a threaded send without escaping
    // their types, and the linkage is lost before the request is made.
    const sendProperties = b.paths["/v1/messages"].post.requestBody
      .content["application/json"].schema.properties;
    expect(sendProperties.uuid).toEqual({ type: "string" });
    expect(sendProperties.working_dir).toEqual({ type: "string" });
    expect(sendProperties.repository).toEqual({ type: "string" });
    expect(sendProperties.branch).toEqual({ type: "string" });
    expect(sendProperties.reply_to).toEqual({ type: "integer" });
    expect(sendProperties.reply_to_uuid).toEqual({ type: "string" });
    expect(sendProperties.attachments).toMatchObject({
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        required: ["name", "content_base64"],
      },
    });
    expect(b.paths["/v1/messages/{id}/attachments/{name}"].get.operationId)
      .toBe("downloadMessageAttachment");
    expect(b.paths["/v1/messages/by-uuid/{uuid}"].get.operationId).toBe("getMessageByUuid");
    expect(b.components.schemas.Message.properties.reply_to).toEqual({
      type: "integer",
      nullable: true,
    });
    expect(b.paths["/v1/projects"].get.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "limit", in: "query" }),
      expect.objectContaining({ name: "cursor", in: "query" }),
      expect.objectContaining({ name: "offset", in: "query" }),
    ]));
    expect(b.paths["/v1/channels"].get.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "project_id", in: "query" }),
    ]));
    expect(b.components.schemas.Channel.properties.id).toEqual({ type: "string" });
  });
});

/**
 * G2 — a collection filter is either absent or a real value. Never "" .
 *
 * `str()` mapped a PRESENT-but-empty query value to `undefined`, which is the
 * same thing it returns for an absent one — so `?channel=` dropped the channel
 * clause and widened the read to every channel the key can see. A caller whose
 * variable interpolated to empty asked for one channel and was answered with
 * all of them, with a 200 and no indication anything had been relaxed.
 *
 * The rejection must land BEFORE the query is issued, so these assert against
 * the recorded SQL as well as the status code.
 */
describe("G2 strict collection filters on /v1", () => {
  function callsSince(mark: number): Array<{ sql: string }> {
    return activeFakeClient!.__debug.manyCalls.slice(mark);
  }

  const PRESENT_BUT_EMPTY = ["channel", "session", "session_id", "from", "to", "project_id", "q", "mentions_only", "uuid"];

  for (const name of PRESENT_BUT_EMPTY) {
    test(`GET /v1/messages?${name}= is rejected before any query runs`, async () => {
      const mark = activeFakeClient!.__debug.manyCalls.length;
      const res = await fetch(`${base}/v1/messages?${name}=`, { headers: { "x-api-key": rwKey } });
      expect(res.status).toBe(400);
      const body = await res.json() as { error?: string };
      expect(String(body.error)).toContain(name);
      expect(callsSince(mark).filter((call) => /FROM messages/i.test(call.sql))).toHaveLength(0);
    });
  }

  test("a malformed since is rejected before any query runs", async () => {
    const mark = activeFakeClient!.__debug.manyCalls.length;
    const res = await fetch(`${base}/v1/messages?since=not-a-date`, { headers: { "x-api-key": rwKey } });
    expect(res.status).toBe(400);
    expect(callsSince(mark).filter((call) => /FROM messages/i.test(call.sql))).toHaveLength(0);
  });

  test("a malformed limit is rejected before any query runs", async () => {
    const mark = activeFakeClient!.__debug.manyCalls.length;
    const res = await fetch(`${base}/v1/messages?limit=abc`, { headers: { "x-api-key": rwKey } });
    expect(res.status).toBe(400);
    expect(callsSince(mark).filter((call) => /FROM messages/i.test(call.sql))).toHaveLength(0);
  });

  // The instrument must be able to pass, not only to fail: well-formed filters
  // still reach the store and still return a page.
  test("well-formed filters are accepted and do reach the store", async () => {
    const mark = activeFakeClient!.__debug.manyCalls.length;
    const res = await fetch(`${base}/v1/messages?channel=ops&limit=5&since=2026-01-01T00:00:00Z`, {
      headers: { "x-api-key": rwKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { messages?: unknown[]; has_more?: boolean };
    expect(Array.isArray(body.messages)).toBe(true);
    expect(callsSince(mark).filter((call) => /FROM messages/i.test(call.sql)).length).toBeGreaterThan(0);
  });

  test("an omitted filter is still absent, not empty", async () => {
    const res = await fetch(`${base}/v1/messages?limit=5`, { headers: { "x-api-key": rwKey } });
    expect(res.status).toBe(200);
  });

  test("pinned rejects present-but-empty optional filters before any query runs", async () => {
    for (const name of ["channel", "session", "session_id"]) {
      const mark = activeFakeClient!.__debug.manyCalls.length;
      const res = await fetch(`${base}/v1/messages/pinned?${name}=`, { headers: { "x-api-key": rwKey } });
      expect(res.status).toBe(400);
      expect(callsSince(mark).filter((call) => /FROM messages/i.test(call.sql))).toHaveLength(0);
    }
  });

  test("for-agent rejects present-but-empty optional filters before any query runs", async () => {
    for (const name of ["agent", "channel"]) {
      const mark = activeFakeClient!.__debug.manyCalls.length;
      const res = await fetch(`${base}/v1/messages/for-agent?${name}=`, { headers: { "x-api-key": rwKey } });
      expect(res.status).toBe(400);
      expect(callsSince(mark).filter((call) => /FROM messages/i.test(call.sql))).toHaveLength(0);
    }
  });

  test("channel-notifications/inbox rejects empty filters and malformed since before any query runs", async () => {
    for (const suffix of ["agent=", "channel=", "since=not-a-date"]) {
      const mark = activeFakeClient!.__debug.manyCalls.length;
      const res = await fetch(`${base}/v1/channel-notifications/inbox?${suffix}`, { headers: { "x-api-key": rwKey } });
      expect(res.status).toBe(400);
      expect(callsSince(mark).filter((call) => /FROM messages|FROM agent_presence|FROM channel_subscriptions/i.test(call.sql))).toHaveLength(0);
    }
  });

  test("analytics routes reject present-but-empty filters too", async () => {
    const trending = await fetch(`${base}/v1/topics/trending?project_id=`, { headers: { "x-api-key": rwKey } });
    expect(trending.status).toBe(400);
    const hot = await fetch(`${base}/v1/hot?channel=`, { headers: { "x-api-key": rwKey } });
    expect(hot.status).toBe(400);
  });

  test("analytics routes reject negative limits and clamp huge ones before SQL", async () => {
    const negative = await fetch(`${base}/v1/summary/some-session?limit=-1`, { headers: { "x-api-key": rwKey } });
    expect(negative.status).toBe(400);

    const hugeMark = activeFakeClient!.__debug.manyCalls.length;
    const huge = await fetch(`${base}/v1/topics/channel/ops?limit=50000`, { headers: { "x-api-key": rwKey } });
    expect(huge.status).toBe(200);
    const sql = callsSince(hugeMark).find((call) => /FROM messages/i.test(call.sql))?.sql ?? "";
    expect(sql).toContain("LIMIT 1000");
  });
});

/**
 * G6 — the PostgreSQL analytics paths derive from a BOUNDED, REDACTED preview
 * projection, never from `SELECT *` or a bare `SELECT content`.
 *
 * Summary and topics ran over whole stored bodies: an unbounded number of
 * unbounded rows, unredacted, and with restricted incident/security rows
 * included on the same terms as any other. Deriving a "topic" from a body the
 * caller may not read still leaks that body's contents, one weighted term at a
 * time.
 */
describe("G6 bounded analytics projections on /v1", () => {
  function analyticsSql(mark: number): string[] {
    return activeFakeClient!.__debug.manyCalls.slice(mark).map((call) => call.sql);
  }

  test("summary selects a bounded preview projection, not SELECT *", async () => {
    const mark = activeFakeClient!.__debug.manyCalls.length;
    const res = await fetch(`${base}/v1/summary/some-session`, { headers: { "x-api-key": rwKey } });
    expect(res.status).toBe(200);
    const messageQueries = analyticsSql(mark).filter((sql) => /FROM messages/i.test(sql));
    expect(messageQueries.length).toBeGreaterThan(0);
    for (const sql of messageQueries) {
      expect(sql).not.toMatch(/SELECT\s+\*\s+FROM messages/i);
      expect(sql).toMatch(/left\(/i);
      expect(sql).toMatch(/preview_source/i);
    }
  });

  test("topic routes select a bounded preview projection, not raw content", async () => {
    for (const path of ["topics/channel/ops", "topics/session/some-session", "topics/trending"]) {
      const mark = activeFakeClient!.__debug.manyCalls.length;
      const res = await fetch(`${base}/v1/${path}`, { headers: { "x-api-key": rwKey } });
      expect(res.status).toBe(200);
      const messageQueries = analyticsSql(mark).filter((sql) => /FROM messages/i.test(sql));
      expect(messageQueries.length).toBeGreaterThan(0);
      for (const sql of messageQueries) {
        expect(sql).not.toMatch(/SELECT\s+content\s+FROM messages/i);
        expect(sql).toMatch(/left\(/i);
      }
    }
  });
});

describe("POST /v1/messages work-status lifecycle guards (hosted path)", () => {
  // The hosted /v1/messages handler performs its own inline INSERT and never
  // reached the local sendMessage guards, so the measured defect classes —
  // a JSON document as the message (id 701771), an empty event_id (id
  // 702774), invalid state values, and 96 consecutive same-state duplicate
  // pairs written 24-57s apart with fresh event_ids — were written through
  // THIS path (conversations.hasna.xyz). These tests prove the same write-time
  // envelope and duplicate-transition guards now run here, mirroring the local
  // send-guard tests.
  const EVENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const TASK_ID = "12345678-1234-4234-8234-123456789abc";
  const OTHER_TASK_ID = "22345678-1234-4234-8234-123456789abc";
  const SESSION_ID = "a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c";
  const CLAIM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  const workStatusChannelSeed = {
    id: "chn_00000000000000000000000000000051",
    name: "work-status",
    description: null,
    topic: null,
    project_id: null,
    created_by: "test",
    created_at: "2026-08-17T00:00:00.000Z",
    archived_at: null,
    metadata: null,
    tags: null,
  };

  function envelope(
    state = "START",
    taskId = TASK_ID,
    eventId = EVENT_ID,
    at = new Date().toISOString(),
  ): string {
    return [
      state,
      `event_id=${eventId}`,
      `task_id=${taskId}`,
      "scope=todos:open-todos",
      "agent=test-agent",
      `session=${SESSION_ID}`,
      `at=${at}`,
      `claim=${CLAIM_ID}`,
      "evidence=-",
    ].join(" ");
  }

  function postWorkStatus(content: string, extra: Record<string, unknown> = {}) {
    return fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "test-agent", channel: "work-status", content, ...extra }),
    });
  }

  function workStatusMessageCount(): number {
    return activeFakeClient!.__debug.messages.filter((row: any) => row.channel === "work-status").length;
  }

  test("a valid lifecycle envelope is accepted through the hosted path", async () => {
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], []);
    const before = workStatusMessageCount();
    const response = await postWorkStatus(envelope("START", OTHER_TASK_ID));
    expect(response.status).toBe(201);
    expect(((await response.json()).message as any).content.startsWith("START event_id=")).toBe(true);
    expect(workStatusMessageCount()).toBe(before + 1);
  });

  // (b) — malformed first lines measured on the live stream. Each must be
  // rejected with a 4xx reason on the hosted path and leave the stream
  // untouched, mirroring the local send-guard tests.
  const malformedFirstLines: Array<[string, string]> = [
    [
      "an entire JSON document as the message (id 701771, agent-chief-finance)",
      JSON.stringify({ event: "DONE", task_id: OTHER_TASK_ID }),
    ],
    [
      "empty event_id (id 702774, agent-chief-staff)",
      `START event_id= task_id=${OTHER_TASK_ID} scope=todos:open-todos agent=test-agent session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "literal template word STATE as the state (ids 685044, 684554)",
      `STATE event_id=${EVENT_ID} task_id=${OTHER_TASK_ID} scope=todos:open-todos agent=test-agent session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "CONTINUE is not a lifecycle state (id 686051)",
      `CONTINUE event_id=${EVENT_ID} task_id=${OTHER_TASK_ID} scope=todos:open-todos agent=test-agent session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "IN_PROGRESS is not a lifecycle state (id 684083)",
      `IN_PROGRESS event_id=${EVENT_ID} task_id=${OTHER_TASK_ID} scope=todos:open-todos agent=test-agent session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "PENDING is not a lifecycle state (id 683838)",
      `PENDING event_id=${EVENT_ID} task_id=${OTHER_TASK_ID} scope=todos:open-todos agent=test-agent session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "PROGRESS is not a lifecycle state (id 683694)",
      `PROGRESS event_id=${EVENT_ID} task_id=${OTHER_TASK_ID} scope=todos:open-todos agent=test-agent session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "extra outcome= field with missing claim (id 683973)",
      `DONE event_id=${EVENT_ID} task_id=${OTHER_TASK_ID} scope=todos:open-todos agent=test-agent session=${SESSION_ID} at=2026-08-17T10:00:00Z outcome=success evidence=-`,
    ],
    [
      "retired [WORKLOG] prefix",
      `[WORKLOG] ${envelope("START", OTHER_TASK_ID)}`,
    ],
    [
      "free-form prose first line",
      "blocker cleared, resuming the migration now",
    ],
  ];

  for (const [name, firstLine] of malformedFirstLines) {
    test(`${name} is rejected with a 400 reason on the hosted path`, async () => {
      const before = workStatusMessageCount();
      const response = await postWorkStatus(firstLine);
      expect(response.status).toBe(400);
      expect(((await response.json()) as any).error).toContain("work-status lifecycle event rejected");
      expect(workStatusMessageCount()).toBe(before);
    });
  }

  test("the hosted-path rejection names the lifecycle envelope as the reason", async () => {
    const response = await postWorkStatus("prose is not an envelope");
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toContain("work-status lifecycle");
  });

  test("the hosted guard is scoped to work-status: prose on other channels still sends", async () => {
    activeFakeClient!.__debug.seedChannel({
      id: "chn_00000000000000000000000000000052",
      name: "work-status-guard-general",
      description: null,
      topic: null,
      project_id: null,
      created_by: "test",
      created_at: "2026-08-17T00:00:00.000Z",
      archived_at: null,
      metadata: null,
      tags: null,
    }, [], []);
    const response = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "test-agent", channel: "work-status-guard-general", content: "ordinary prose is fine here" }),
    });
    expect(response.status).toBe(201);
  });

  test("a reply to a work-status message is commentary and is not envelope-checked on the hosted path", async () => {
    const parentResponse = await postWorkStatus(envelope("BLOCKED", OTHER_TASK_ID));
    expect(parentResponse.status).toBe(201);
    const parent = (await parentResponse.json()).message as { id: number; uuid: string };
    const before = workStatusMessageCount();
    const reply = await postWorkStatus("why is this blocked?", {
      reply_to: parent.id,
      reply_to_uuid: parent.uuid,
    });
    expect(reply.status).toBe(201);
    expect(((await reply.json()).message as any).reply_to).toBe(parent.id);
    expect(workStatusMessageCount()).toBe(before + 1);
  });

  // (a) — duplicate transitions. The measured defect class was written through
  // the hosted path, so the dedupe guard must run there too. Each test uses
  // its own task id so the shared in-memory store cannot leak a prior event
  // into the window.
  test("the same state for the same task within the window is rejected on the hosted path (START double-fire)", async () => {
    const taskId = "32345678-1234-4234-8234-123456789abc";
    const first = await postWorkStatus(envelope("START", taskId, EVENT_ID));
    expect(first.status).toBe(201);
    const before = workStatusMessageCount();
    const duplicate = await postWorkStatus(envelope("START", taskId, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"));
    expect(duplicate.status).toBe(400);
    expect(((await duplicate.json()) as any).error).toContain("work-status duplicate transition");
    expect(workStatusMessageCount()).toBe(before);
  });

  test("the same state for the same task within the window is rejected on the hosted path (BLOCKED too)", async () => {
    const taskId = "42345678-1234-4234-8234-123456789abc";
    const first = await postWorkStatus(envelope("BLOCKED", taskId, EVENT_ID));
    expect(first.status).toBe(201);
    const before = workStatusMessageCount();
    const duplicate = await postWorkStatus(envelope("BLOCKED", taskId, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"));
    expect(duplicate.status).toBe(400);
    expect(((await duplicate.json()) as any).error).toContain("work-status duplicate transition");
    expect(workStatusMessageCount()).toBe(before);
  });

  test("a different state for the same task within the window is a real transition on the hosted path", async () => {
    const taskId = "52345678-1234-4234-8234-123456789abc";
    const start = await postWorkStatus(envelope("START", taskId, EVENT_ID));
    expect(start.status).toBe(201);
    const blocked = await postWorkStatus(envelope("BLOCKED", taskId, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"));
    expect(blocked.status).toBe(201);
  });

  test("BLOCKED -> RESUMED -> BLOCKED is a real sequence and is not deduped on the hosted path", async () => {
    const taskId = "62345678-1234-4234-8234-123456789abc";
    for (const [index, state] of ["BLOCKED", "RESUMED", "BLOCKED"].entries()) {
      const response = await postWorkStatus(
        envelope(state, taskId, `cccccccc-dddd-${4 + index}eee-8fff-00000000000${index + 1}`),
      );
      expect(response.status).toBe(201);
    }
  });

  test("a duplicate for a different task within the window is not deduped on the hosted path", async () => {
    const firstTask = "72345678-1234-4234-8234-123456789abc";
    const secondTask = "82345678-1234-4234-8234-123456789abc";
    const first = await postWorkStatus(envelope("START", firstTask, EVENT_ID));
    expect(first.status).toBe(201);
    const second = await postWorkStatus(envelope("START", secondTask, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"));
    expect(second.status).toBe(201);
  });

  // (c) — error reflection. The envelope validator echoes caller-controlled
  // field values into the violation reason, and the hosted handler returns it
  // before the content-safety scan runs; a sensitive value placed in an
  // envelope field must not be reflected into the API error, which clients
  // throw and logs transcribe.
  test("envelope violation errors do not reflect sensitive caller values on the hosted path", async () => {
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], []);
    // Synthetic detector-positive value (slack-shaped): matches the content
    // safety redaction patterns, not the staged-secrets scanner's detectors.
    const leak = "xoxb-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const response = await postWorkStatus(
      `START event_id=${leak} task_id=${OTHER_TASK_ID} scope=todos:open-todos agent=test-agent ` +
      `session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error).toContain("work-status lifecycle event rejected");
    expect(body.error).not.toContain(leak);
  });

  // (d) — the bulk backfill path is a write surface too: a malformed envelope
  // or a duplicate transition must not be able to reach the stream through it.
  test("a malformed work-status envelope is refused through the bulk path", async () => {
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], []);
    const before = workStatusMessageCount();
    const response = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { uuid: "bulk-ws-1", from: "test-agent", to: "test-agent", channel: "work-status", content: "not an envelope" },
        ],
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toContain("work-status lifecycle event rejected");
    expect(workStatusMessageCount()).toBe(before);
  });

  test("a duplicate work-status transition is refused through the bulk path", async () => {
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], []);
    const before = workStatusMessageCount();
    const taskId = "92345678-1234-4234-8234-123456789abc";
    const response = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { uuid: "bulk-ws-2", from: "test-agent", to: "test-agent", channel: "work-status", content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000001") },
          { uuid: "bulk-ws-3", from: "test-agent", to: "test-agent", channel: "work-status", content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000002") },
        ],
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toContain("work-status duplicate transition");
    expect(workStatusMessageCount()).toBe(before);
  });

  test("a real transition sequence in one bulk request is accepted", async () => {
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], []);
    const before = workStatusMessageCount();
    const taskId = "a3345678-1234-4234-8234-123456789abc";
    const response = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { uuid: "bulk-ws-4", from: "test-agent", to: "test-agent", channel: "work-status", content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000001") },
          { uuid: "bulk-ws-5", from: "test-agent", to: "test-agent", channel: "work-status", content: envelope("BLOCKED", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000002") },
        ],
      }),
    });
    expect(response.status).toBe(200);
    expect(workStatusMessageCount()).toBe(before + 2);
  });

  test("replaying a bulk work-status event with the same uuid is an idempotent skip, not a duplicate error", async () => {
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], []);
    const taskId = "b4345678-1234-4234-8234-123456789abc";
    const item = {
      uuid: "bulk-ws-replay-1",
      from: "test-agent",
      to: "test-agent",
      channel: "work-status",
      content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000001"),
    };
    const first = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [item] }),
    });
    expect(first.status).toBe(200);
    const replay = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [item] }),
    });
    expect(replay.status).toBe(200);
    const body = (await replay.json()) as any;
    expect(body.skipped).toBe(1);
  });

  test("a bulk retry of an already-stored legacy malformed work-status event is an idempotent no-op, not a 400", async () => {
    // Legacy rows written before the envelope guard existed (measured shapes:
    // a JSON document as the message, an empty event_id) must still be
    // re-runnable: the idempotent-backfill contract is ON CONFLICT (uuid) DO
    // NOTHING, and a retry of a stored batch is a no-op. The envelope guard
    // must not fire on an item whose uuid is already stored.
    const now = Date.now();
    const legacyRows = [
      { id: 9101, uuid: "bulk-ws-legacy-1", from_agent: "test-agent", to_agent: "test-agent", channel: "work-status", content: "not an envelope", created_at: new Date(now - 120_000).toISOString(), reply_to: null, session_id: SESSION_ID, project_id: null },
    ];
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], legacyRows);
    const before = workStatusMessageCount();
    const response = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ uuid: "bulk-ws-legacy-1", from: "test-agent", to: "test-agent", channel: "work-status", content: "not an envelope" }],
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.inserted).toBe(0);
    expect(body.skipped).toBe(1);
    expect(workStatusMessageCount()).toBe(before);
  });

  test("a bulk retry of an already-stored same-state duplicate pair is an idempotent no-op, not a 400", async () => {
    // Legacy rows written before the dedupe guard existed (the measured 96
    // same-state consecutive pairs) must stay re-runnable: the stored pair is
    // the stream's historical record, and a backfill re-run of those exact
    // uuids is a no-op per ON CONFLICT (uuid) DO NOTHING — not a duplicate
    // transition refusal. The in-request dedupe must not fire on items whose
    // uuids are already stored.
    const taskId = "c2345678-1234-4234-8234-123456789abc";
    const now = Date.now();
    const older = new Date(now - 40_000).toISOString();
    const newer = new Date(now - 30_000).toISOString();
    const seededRows = [
      { id: 9102, uuid: "bulk-ws-pair-1", from_agent: "test-agent", to_agent: "test-agent", channel: "work-status", content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000001", older), created_at: older, reply_to: null, session_id: SESSION_ID, project_id: null },
      { id: 9103, uuid: "bulk-ws-pair-2", from_agent: "test-agent", to_agent: "test-agent", channel: "work-status", content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000002", newer), created_at: newer, reply_to: null, session_id: SESSION_ID, project_id: null },
    ];
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], seededRows);
    const before = workStatusMessageCount();
    const response = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { uuid: "bulk-ws-pair-1", from: "test-agent", to: "test-agent", channel: "work-status", created_at: older, content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000001", older) },
          { uuid: "bulk-ws-pair-2", from: "test-agent", to: "test-agent", channel: "work-status", created_at: newer, content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000002", newer) },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.inserted).toBe(0);
    expect(body.skipped).toBe(2);
    expect(workStatusMessageCount()).toBe(before);
  });

  test("a bulk retry skips only the already-stored work-status items and still applies the guards to new ones", async () => {
    // Mixed batch: an existing legacy malformed event (no-op skip) alongside a
    // genuinely new event (guards apply, then INSERT). Proves the idempotency
    // skip is per-item, not per-request: the envelope guard must not be
    // bypassed for new items by the presence of an existing one.
    const taskId = "b5345678-1234-4234-8234-123456789abc";
    const now = Date.now();
    const legacyRows = [
      { id: 9104, uuid: "bulk-ws-mixed-1", from_agent: "test-agent", to_agent: "test-agent", channel: "work-status", content: "not an envelope", created_at: new Date(now - 120_000).toISOString(), reply_to: null, session_id: SESSION_ID, project_id: null },
    ];
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], legacyRows);
    const before = workStatusMessageCount();
    const response = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { uuid: "bulk-ws-mixed-1", from: "test-agent", to: "test-agent", channel: "work-status", content: "not an envelope" },
          { uuid: "bulk-ws-mixed-2", from: "test-agent", to: "test-agent", channel: "work-status", content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000003") },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.inserted).toBe(1);
    expect(body.skipped).toBe(1);
    expect(workStatusMessageCount()).toBe(before + 1);
  });

  test("a same-state bulk pair outside the dedupe window is a historical sequence and is accepted", async () => {
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], []);
    const before = workStatusMessageCount();
    const taskId = "c5345678-1234-4234-8234-123456789abc";
    const now = Date.now();
    const older = new Date(now - 10 * 60_000).toISOString();
    const newer = new Date(now - 8 * 60_000).toISOString();
    const response = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { uuid: "bulk-ws-hist-1", from: "test-agent", to: "test-agent", channel: "work-status", created_at: older, content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000001") },
          { uuid: "bulk-ws-hist-2", from: "test-agent", to: "test-agent", channel: "work-status", created_at: newer, content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000002") },
        ],
      }),
    });
    expect(response.status).toBe(200);
    expect(workStatusMessageCount()).toBe(before + 2);
  });

  test("a bulk channel alias cannot bypass the work-status guard", async () => {
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], []);
    const before = workStatusMessageCount();
    // Malformed envelope through the alias is refused.
    const malformed = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { uuid: "bulk-ws-alias-1", from: "test-agent", to: "test-agent", channel: "#WORK-STATUS", content: "not an envelope" },
        ],
      }),
    });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as any).error).toContain("work-status lifecycle event rejected");
    expect(workStatusMessageCount()).toBe(before);
    // A valid envelope through the alias is canonicalized on storage.
    const taskId = "d6345678-1234-4234-8234-123456789abc";
    const valid = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { uuid: "bulk-ws-alias-2", from: "test-agent", to: "test-agent", channel: "#WORK-STATUS", content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000001") },
        ],
      }),
    });
    expect(valid.status).toBe(200);
    const stored = activeFakeClient!.__debug.messages.find((row: any) => row.uuid === "bulk-ws-alias-2");
    expect(stored.channel).toBe("work-status");
  });

  test("a same-state bulk pair is refused regardless of request order", async () => {
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], []);
    const before = workStatusMessageCount();
    const taskId = "e7345678-1234-4234-8234-123456789abc";
    const now = Date.now();
    const newer = new Date(now - 60_000).toISOString();
    const older = new Date(now - 120_000).toISOString();
    // The NEWER event appears FIRST in the request; the in-request dedupe must
    // not depend on request order.
    const response = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { uuid: "bulk-ws-rev-1", from: "test-agent", to: "test-agent", channel: "work-status", created_at: newer, content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000001") },
          { uuid: "bulk-ws-rev-2", from: "test-agent", to: "test-agent", channel: "work-status", created_at: older, content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000002") },
        ],
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toContain("work-status duplicate transition");
    expect(workStatusMessageCount()).toBe(before);
  });

  test("a future-dated row does not decide the hosted dedupe: an in-window duplicate is still refused", async () => {
    const taskId = "f8345678-1234-4234-8234-123456789abc";
    const now = Date.now();
    const seededRows = [
      // In-window same-state event for the task.
      { id: 9001, uuid: "ws-seed-1", from_agent: "test-agent", to_agent: "test-agent", channel: "work-status", content: envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000001", new Date(now - 30_000).toISOString()), created_at: new Date(now - 30_000).toISOString(), reply_to: null, session_id: SESSION_ID, project_id: null },
      // Future-dated different-state row that must NOT mask the event above.
      { id: 9002, uuid: "ws-seed-2", from_agent: "test-agent", to_agent: "test-agent", channel: "work-status", content: envelope("BLOCKED", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000003", new Date(now + 300_000).toISOString()), created_at: new Date(now + 300_000).toISOString(), reply_to: null, session_id: SESSION_ID, project_id: null },
    ];
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], seededRows);
    const before = workStatusMessageCount();
    const response = await postWorkStatus(envelope("START", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000004"));
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toContain("work-status duplicate transition");
    expect(workStatusMessageCount()).toBe(before);
  });

  test("a future same-state row does not wrongly reject a legitimate current event", async () => {
    const taskId = "a9345678-1234-4234-8234-123456789abc";
    const now = Date.now();
    const seededRows = [
      { id: 9003, uuid: "ws-seed-3", from_agent: "test-agent", to_agent: "test-agent", channel: "work-status", content: envelope("BLOCKED", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000001", new Date(now + 300_000).toISOString()), created_at: new Date(now + 300_000).toISOString(), reply_to: null, session_id: SESSION_ID, project_id: null },
    ];
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], seededRows);
    const before = workStatusMessageCount();
    const response = await postWorkStatus(envelope("BLOCKED", taskId, "aaaaaaaa-cccc-4ddd-8eee-000000000002"));
    expect(response.status).toBe(201);
    expect(workStatusMessageCount()).toBe(before + 1);
  });

  // (e) — the dedupe guard must serialize same-task writers: the advisory lock
  // is taken before the recent-events read, so a concurrent same-state pair
  // cannot both pass the read.
  test("the hosted dedupe guard takes a per-task advisory lock before the recent-events read", async () => {
    activeFakeClient!.__debug.seedChannel(workStatusChannelSeed, [], []);
    const mark = activeFakeClient!.__debug.manyCalls.length;
    const response = await postWorkStatus(envelope("START", "a1345678-1234-4234-8234-123456789abc"));
    expect(response.status).toBe(201);
    const calls = activeFakeClient!.__debug.manyCalls.slice(mark);
    const lockIndex = calls.findIndex((call) => call.sql.includes("pg_advisory_xact_lock"));
    const recentIndex = calls.findIndex((call) => call.sql.includes("FROM messages"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(recentIndex).toBeGreaterThan(lockIndex);
  });
});

/**
 * H3 — /v1/messages/read: the mention-acknowledgement discriminator and the
 * reader binding.
 *
 * Agent-authored (SOL consult refused before delivering a final spec; its
 * preliminary findings named this transport seam. Spec from independent
 * analysis of the server read handler).
 *
 * The local store marks mentions through markMentionsReadByIds (specific ids)
 * and markMentionsRead (all, optionally channel-scoped). The hosted router
 * must expose the SAME semantics through one discriminator: `mentions_only`
 * selects the mentions branch, `mention_ids` selects the exact rows inside it.
 * A request carrying `mention_ids` WITHOUT `mentions_only` is refused with 400
 * — the fail-closed contract a weak happy-path test never sees. The ApiStore
 * wire shape (markMentionsReadByIds) is exactly that shape, so the
 * discriminator is a load-bearing contract, not an option.
 */
describe("H3 /v1/messages/read mention acknowledgements", () => {
  function mentionRow(id: number) {
    return activeFakeClient!.__debug.messageMentions.find((row) => row.id === id);
  }

  async function seedTestMentions(uuids: string[]): Promise<number[]> {
    const r = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: uuids.map((uuid, index) => ({
          uuid,
          from: "seed",
          to: "alerts",
          channel: "alerts",
          content: `payload @test #${index}`,
        })),
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json() as { inserted: number };
    expect(body.inserted).toBe(uuids.length);
    return uuids.map((uuid) => {
      const source = activeFakeClient!.__debug.messages.find((m) => m.uuid === uuid);
      const mention = activeFakeClient!.__debug.messageMentions.find((m) => m.message_id === source?.id);
      expect(mention).toBeDefined();
      return mention!.id;
    });
  }

  test("mentions_only + mention_ids stamps exactly the named un-notified mention rows", async () => {
    const [firstId, secondId] = await seedTestMentions(["h3-exact-a", "h3-exact-b"]);
    const res = await fetch(`${base}/v1/messages/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ reader: "test", mentions_only: true, mention_ids: [firstId] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marked: 1 });
    expect(mentionRow(firstId).notified_at).toBeDefined();
    expect(mentionRow(secondId).notified_at).toBeUndefined();
  });

  test("mentions_only without ids stamps every un-notified mention of the reader", async () => {
    const [firstId, secondId] = await seedTestMentions(["h3-all-a", "h3-all-b"]);
    const res = await fetch(`${base}/v1/messages/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ reader: "test", mentions_only: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { marked: number };
    expect(body.marked).toBeGreaterThanOrEqual(2);
    expect(mentionRow(firstId).notified_at).toBeDefined();
    expect(mentionRow(secondId).notified_at).toBeDefined();
  });

  test("mentions_only with a channel scopes the stamp to that channel", async () => {
    const channelA = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{
        uuid: "h3-scope-a", from: "seed", to: "cha", channel: "cha", content: "scope @test A",
      }] }),
    });
    const channelB = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{
        uuid: "h3-scope-b", from: "seed", to: "chb", channel: "chb", content: "scope @test B",
      }] }),
    });
    expect(channelA.status).toBe(200);
    expect(channelB.status).toBe(200);
    const inA = activeFakeClient!.__debug.messageMentions.find((m) => m.channel === "cha" && m.mentioned_agent === "test")!;
    const inB = activeFakeClient!.__debug.messageMentions.find((m) => m.channel === "chb" && m.mentioned_agent === "test")!;

    const res = await fetch(`${base}/v1/messages/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ reader: "test", mentions_only: true, channel: "cha" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marked: 1 });
    expect(inA.notified_at).toBeDefined();
    expect(inB.notified_at).toBeUndefined();
  });

  test("mention_ids WITHOUT mentions_only is refused 400 — the discriminator is required", async () => {
    const [firstId] = await seedTestMentions(["h3-nodisc-a"]);
    // The ApiStore markMentionsReadByIds wire shape is exactly this request.
    // The server fail-closes: without mentions_only the body matches no
    // branch, and the mention row stays untouched instead of being
    // acknowledged by a guessed interpretation.
    const res = await fetch(`${base}/v1/messages/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ reader: "test", mention_ids: [firstId] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "provide ids, or all/channel/session with reader" });
    expect(mentionRow(firstId).notified_at).toBeUndefined();
  });

  test("a declared reader that differs from the API-key principal claim is accepted; receipts stamp under the declared reader", async () => {
    // Fleet posture (task 1871c67f, corroborated by 98533aab): the store API
    // key carries a fleet-level agent claim, while the CLI byline is
    // caller-declared. The key authorizes; the byline is the identity. A
    // declared reader that differs from the key claim must NOT 403 — the
    // equality check deterministically broke every named seat's read path.
    const res = await fetch(`${base}/v1/messages/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ reader: "someone-else", mentions_only: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marked: 0 });

    // Receipts are stamped under the DECLARED reader, never the key claim.
    const bulk = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ uuid: "h3-declared-reader-a", from: "seed", to: "alerts", channel: "alerts", content: "payload @someone-else #0" }],
      }),
    });
    expect(bulk.status).toBe(200);
    const source = activeFakeClient!.__debug.messages.find((m) => m.uuid === "h3-declared-reader-a");
    const mention = activeFakeClient!.__debug.messageMentions.find((m) => m.message_id === source?.id);
    expect(mention).toBeDefined();
    expect(mention!.mentioned_agent).toBe("someone-else");
    expect(mention!.notified_at).toBeUndefined();
    const stamped = await fetch(`${base}/v1/messages/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ reader: "someone-else", mentions_only: true, mention_ids: [mention!.id] }),
    });
    expect(stamped.status).toBe(200);
    expect(await stamped.json()).toEqual({ marked: 1 });
    expect(mentionRow(mention!.id).notified_at).toBeDefined();
  });
});

/**
 * H4 — channel-notifications lifecycle and the agent scoping.
 *
 * Agent-authored (SOL consult refused before delivering a final spec; its
 * preliminary findings named this authorization seam. Spec from independent
 * analysis of the channel-notifications router).
 *
 * The inbox route takes the queried `agent` as the SCOPE, not as something
 * that must equal the API-key principal claim. The fleet deployment model
 * (task 1871c67f, corroborated by 98533aab) gives every store API key a
 * fleet-level agent claim, while the CLI byline is caller-declared — so an
 * equality check between the two deterministically 403'd every named seat.
 * The key authorizes (tenant + scopes); the byline is the identity. The
 * sibling routes take an `agent` from body/path/query; their contract is
 * pinned here at the execution level: subscribe upsert, listing, unsubscribe
 * 404 semantics, read/read-all marking, and the scoped inbox read.
 */
describe("H4 channel-notifications lifecycle and binding", () => {
  function seedNotifChannel(name: string) {
    activeFakeClient!.__debug.seedChannel({
      id: `chn_${name}`,
      name,
      description: null,
      topic: null,
      project_id: null,
      created_by: "seed",
      created_at: "2026-08-09T00:00:00.000Z",
      archived_at: null,
      metadata: null,
      tags: null,
    }, [], []);
  }

  test("POST requires a channel", async () => {
    const res = await fetch(`${base}/v1/channel-notifications`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ agent: "watcher" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "channel and agent are required" });
  });

  test("POST subscribes and upserts preview_chars on re-subscribe", async () => {
    seedNotifChannel("h4-sub");
    const first = await fetch(`${base}/v1/channel-notifications`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ channel: "h4-sub", agent: "h4-sub-watcher", preview_chars: 200 }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as any;
    expect(firstBody.subscription).toMatchObject({ channel: "h4-sub", agent: "h4-sub-watcher", preview_chars: 200 });
    expect(firstBody.subscription.since_message_id).toBe(0);

    const second = await fetch(`${base}/v1/channel-notifications`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ channel: "h4-sub", agent: "h4-sub-watcher", preview_chars: 80 }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as any;
    expect(secondBody.subscription.preview_chars).toBe(80);
    expect(activeFakeClient!.__debug.channelSubscriptions.filter((s) => s.channel === "h4-sub")).toHaveLength(1);
  });

  test("POST subscribes a missing channel with 404 and GET lists by agent", async () => {
    const missing = await fetch(`${base}/v1/channel-notifications`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ channel: "h4-absent", agent: "h4-list-watcher" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Channel not found: h4-absent" });

    seedNotifChannel("h4-list");
    await fetch(`${base}/v1/channel-notifications`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ channel: "h4-list", agent: "h4-list-watcher" }),
    });

    const filtered = await fetch(`${base}/v1/channel-notifications?agent=h4-list-watcher`, { headers: { "x-api-key": rwKey } });
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json() as any;
    expect(filteredBody.subscriptions.map((s: any) => s.channel)).toEqual(["h4-list"]);

    const unfiltered = await fetch(`${base}/v1/channel-notifications`, { headers: { "x-api-key": rwKey } });
    expect(unfiltered.status).toBe(200);
    const unfilteredBody = await unfiltered.json() as any;
    expect(unfilteredBody.subscriptions.length).toBeGreaterThanOrEqual(1);
  });

  test("GET /subscribed requires an agent and returns the subscribed channels", async () => {
    seedNotifChannel("h4-subscribed");
    await fetch(`${base}/v1/channel-notifications`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ channel: "h4-subscribed", agent: "h4-subscribed-watcher" }),
    });

    const missing = await fetch(`${base}/v1/channel-notifications/subscribed`, { headers: { "x-api-key": rwKey } });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "agent is required" });

    const ok = await fetch(`${base}/v1/channel-notifications/subscribed?agent=h4-subscribed-watcher`, { headers: { "x-api-key": rwKey } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ channels: ["h4-subscribed"] });
  });

  test("DELETE unsubscribes and 404s on a missing subscription", async () => {
    seedNotifChannel("h4-del");
    await fetch(`${base}/v1/channel-notifications`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ channel: "h4-del", agent: "h4-del-watcher" }),
    });

    const del = await fetch(`${base}/v1/channel-notifications/h4-del/h4-del-watcher`, {
      method: "DELETE",
      headers: { "x-api-key": rwKey },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ unsubscribed: true });
    expect(activeFakeClient!.__debug.channelSubscriptions.filter((s) => s.channel === "h4-del")).toHaveLength(0);

    const again = await fetch(`${base}/v1/channel-notifications/h4-del/h4-del-watcher`, {
      method: "DELETE",
      headers: { "x-api-key": rwKey },
    });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "Subscription not found" });
  });

  test("POST /read marks the named message ids as notified reads", async () => {
    seedNotifChannel("h4-read");
    await fetch(`${base}/v1/channel-notifications`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ channel: "h4-read", agent: "h4-read-watcher" }),
    });

    const res = await fetch(`${base}/v1/channel-notifications/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ agent: "h4-read-watcher", message_ids: [41, 42] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marked: 2 });

    const rerun = await fetch(`${base}/v1/channel-notifications/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ agent: "h4-read-watcher", message_ids: [41, 42, 43] }),
    });
    expect(await rerun.json()).toEqual({ marked: 1 });
  });

  test("POST /read-all with a channel scopes the snapshot to that channel", async () => {
    seedNotifChannel("h4-readall");
    await fetch(`${base}/v1/channel-notifications`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ channel: "h4-readall", agent: "h4-readall-watcher" }),
    });

    const mark = activeFakeClient!.__debug.queryCalls.length;
    const res = await fetch(`${base}/v1/channel-notifications/read-all`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ agent: "h4-readall-watcher", channel: "h4-readall" }),
    });
    expect(res.status).toBe(200);
    const calls = activeFakeClient!.__debug.queryCalls.slice(mark);
    const snapshot = calls.find((call) => /INSERT INTO channel_notification_reads/i.test(call.sql));
    expect(snapshot).toBeDefined();
    expect(snapshot!.sql).toContain("AND m.channel = $");
  });
});

/**
 * H4b — /v1/messages/blockers scopes to the DECLARED agent under a
 * fleet-claim key.
 *
 * Before task 1871c67f the blockers route rejected any `agent` query that
 * differed from the API-key principal claim with a deterministic 403, and the
 * client's default invocation omitted `agent` entirely — so every fleet seat
 * saw either a 403 on `--from <seat>` or a fleet-wide unscoped read at rc=0.
 * The key authorizes; the declared byline scopes. Omitted `agent` falls back
 * to the key claim. A dedicated server carries an incident-projector stub so
 * the canonical-read 503 guard is skipped (the shared fake client's
 * over-broad COUNT(*) shim would otherwise 503 once any message is seeded).
 */
describe("H4b blockers declared-agent scoping", () => {
  let blockerServer: ReturnType<typeof startApiServer>;
  let blockerBase: string;
  let blockerDebug: ReturnType<typeof makeFakeClient>["__debug"];

  beforeAll(() => {
    // A dedicated client (never the shared `activeFakeClient`) plus an
    // incident-projector stub, so the canonical-read 503 guard is skipped —
    // the shared fake client's over-broad COUNT(*) shim would otherwise 503
    // once any message is seeded.
    const blockerClient = makeFakeClient();
    blockerDebug = blockerClient.__debug;
    const keys = new ApiKeyStore(blockerClient as any);
    const verifier = verifyApiKey({
      app: "conversations",
      signingSecret: SIGNING,
      keyStatus: async (): Promise<ApiKeyStatus> => "active",
    });
    blockerServer = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: {
        client: blockerClient as any,
        keys,
        verifier,
        incidentProjector: { tenant_id: "test-tenant", authority_id: "test-authority" },
      },
    });
    blockerBase = `http://127.0.0.1:${blockerServer.port}`;
  });

  afterAll(() => { blockerServer.stop(true); });

  test("a fleet-claim key reading agent=<seat> is accepted and scopes the query to the seat", async () => {
    const fleetKey = mintApiKey({
      app: "conversations",
      agent: "fleet",
      scopes: ["conversations:read"],
      signingSecret: SIGNING,
    }).token;
    const mark = blockerDebug.manyCalls.length;
    const res = await fetch(`${blockerBase}/v1/messages/blockers?agent=agent-chief-staff`, {
      headers: { "x-api-key": fleetKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { messages: unknown[] };
    expect(Array.isArray(body.messages)).toBe(true);
    // The scoped read ran (before the fix it 403'd before any query), bound
    // to the DECLARED seat — $3 of the blockers SELECT.
    const calls = blockerDebug.manyCalls.slice(mark);
    const scoped = calls.find((call) => /FROM messages m JOIN eligible/i.test(call.sql));
    expect(scoped).toBeDefined();
    expect(scoped!.params[2]).toBe("agent-chief-staff");
  });

  test("an omitted agent falls back to the key claim (401 without a key)", async () => {
    const fleetKey = mintApiKey({
      app: "conversations",
      agent: "fleet",
      scopes: ["conversations:read"],
      signingSecret: SIGNING,
    }).token;
    const res = await fetch(`${blockerBase}/v1/messages/blockers`, {
      headers: { "x-api-key": fleetKey },
    });
    expect(res.status).toBe(200);
    const noKey = await fetch(`${blockerBase}/v1/messages/blockers?agent=agent-chief-staff`);
    expect(noKey.status).toBe(401);
  });
});

/**
 * H4c — /v1/channel-notifications/inbox scopes to the DECLARED agent under a
 * fleet-claim key.
 *
 * Before task 1871c67f the inbox route 403'd ("notification agent must match
 * the authenticated agent") whenever the queried agent differed from the
 * API-key principal claim — deterministically, for every named seat. A
 * dedicated client keeps the shim's message rows out of the inbox SELECT (its
 * over-broad /FROM messages/ branch would otherwise feed the preview builder
 * rows it cannot map).
 */
describe("H4c inbox declared-agent scoping", () => {
  let inboxServer: ReturnType<typeof startApiServer>;
  let inboxBase: string;
  let inboxDebug: ReturnType<typeof makeFakeClient>["__debug"];

  beforeAll(() => {
    const inboxClient = makeFakeClient();
    inboxDebug = inboxClient.__debug;
    const keys = new ApiKeyStore(inboxClient as any);
    const verifier = verifyApiKey({
      app: "conversations",
      signingSecret: SIGNING,
      keyStatus: async (): Promise<ApiKeyStatus> => "active",
    });
    inboxServer = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: { client: inboxClient as any, keys, verifier },
    });
    inboxBase = `http://127.0.0.1:${inboxServer.port}`;
  });

  afterAll(() => { inboxServer.stop(true); });

  test("a fleet-claim key reading the seat's own inbox is accepted and scoped to the declared agent", async () => {
    // Fleet-claim key (agent 'fleet') reading agent=watcher: the key
    // authorizes, the byline scopes. Before the fix this deterministically
    // 403'd before any query ran — the clean-empty-inbox failure.
    const fleetKey = mintApiKey({
      app: "conversations",
      agent: "fleet",
      scopes: ["conversations:read"],
      signingSecret: SIGNING,
    }).token;
    const mark = inboxDebug.manyCalls.length;
    const res = await fetch(`${inboxBase}/v1/channel-notifications/inbox?agent=watcher`, {
      headers: { "x-api-key": fleetKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { notifications: unknown[] };
    expect(Array.isArray(body.notifications)).toBe(true);
    // The scoped read actually ran (before the fix it 403'd before any query),
    // and bound the DECLARED agent — not the key's 'fleet' claim.
    const calls = inboxDebug.manyCalls.slice(mark);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)!.params[0]).toBe("watcher");
  });

  test("an inbox without an agent is refused 400, and without a key 401", async () => {
    const fleetKey = mintApiKey({
      app: "conversations",
      agent: "fleet",
      scopes: ["conversations:read"],
      signingSecret: SIGNING,
    }).token;
    const missing = await fetch(`${inboxBase}/v1/channel-notifications/inbox`, {
      headers: { "x-api-key": fleetKey },
    });
    expect(missing.status).toBe(400);
    const noKey = await fetch(`${inboxBase}/v1/channel-notifications/inbox?agent=watcher`);
    expect(noKey.status).toBe(401);
  });
});

/**
 * H5 — attachment download: the encoding guard, the response-integrity
 * contract, and the read-scope authorization boundary.
 *
 * Agent-authored (SOL consult refused; spec from independent analysis of
 * src/server/api.ts download handler). The existing tests cover the byte
 * round-trip and the 404/401 paths; the edges below are the ones a weak test
 * misses: an unsupported `encoding` value must be refused with the typed code
 * BEFORE any storage read, the Content-Disposition filename must be sanitized
 * (header injection), Content-Length must agree with the stored size, and a
 * read-scoped key must be able to download (GET is a read, never a write).
 */
describe("H5 attachment download boundary", () => {
  async function seedAttachment(name: string, bytes: Buffer): Promise<{ id: number; base: string }> {
    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "alice",
        to: "threads",
        channel: "threads",
        content: `attachment boundary ${name}`,
        attachments: [{ name, content_base64: bytes.toString("base64") }],
      }),
    });
    expect(sent.status).toBe(201);
    const message = (await sent.json()).message as { id: number };
    return { id: message.id, base };
  }

  test("unsupported encoding is refused with the typed code before any storage read", async () => {
    const { id } = await seedAttachment("h5-enc.txt", Buffer.from("encoding probe\n"));
    const mark = activeFakeClient!.__debug.manyCalls.length + activeFakeClient!.__debug.queryCalls.length;
    const res = await fetch(`${base}/v1/messages/${id}/attachments/h5-enc.txt?encoding=raw`, {
      headers: { "x-api-key": rwKey },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "ATTACHMENT_ENCODING_UNSUPPORTED",
      hint: "Omit encoding for raw bytes or use encoding=base64 for a JSON response.",
    });
    expect(activeFakeClient!.__debug.manyCalls.length + activeFakeClient!.__debug.queryCalls.length).toBe(mark);
  });

  test("Content-Disposition sanitizes quotes and backslashes in the attachment name", async () => {
    const { id } = await seedAttachment('h5-"evil".txt', Buffer.from("sanitize me\n"));
    const res = await fetch(`${base}/v1/messages/${id}/attachments/${encodeURIComponent('h5-"evil".txt')}`, {
      headers: { "x-api-key": rwKey },
    });
    expect(res.status).toBe(200);
    // Quotes and backslashes become underscores; the rest of the name survives.
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="h5-_evil_.txt"');
  });

  test("Content-Disposition sanitizes a backslash in the attachment name", async () => {
    const { id } = await seedAttachment("h5\\path.txt", Buffer.from("backslash\n"));
    const res = await fetch(`${base}/v1/messages/${id}/attachments/${encodeURIComponent("h5\\path.txt")}`, {
      headers: { "x-api-key": rwKey },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="h5_path.txt"');
  });

  test("Content-Length agrees with the stored byte size", async () => {
    const bytes = Buffer.from("exact length probe\n");
    const { id } = await seedAttachment("h5-len.txt", bytes);
    const res = await fetch(`${base}/v1/messages/${id}/attachments/h5-len.txt`, {
      headers: { "x-api-key": rwKey },
    });
    expect(res.status).toBe(200);
    expect(Number(res.headers.get("content-length"))).toBe(bytes.length);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  test("a read-scoped key may download attachments (GET is a read, never a write)", async () => {
    const { id } = await seedAttachment("h5-ro.txt", Buffer.from("read scope\n"));
    const res = await fetch(`${base}/v1/messages/${id}/attachments/h5-ro.txt`, {
      headers: { "x-api-key": roKey },
    });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from("read scope\n"));
  });
});

/**
 * H6 — hosted (PG) Conversations→Events outbox emission.
 *
 * The hosted api.ts writes `conversations_event_outbox` rows inside the SAME PG
 * transaction as each mutation. These tests assert that emission on the hosted
 * path matches the contract the local path pins: every task transition uses the
 * shared past-tense action vocabulary (never the raw HTTP verb), an
 * auto-unblocked dependent gets an `auto_unblocked` outbox row (the exact
 * silent-divergence the webhook-delivery work closes), and message creation
 * emits a message outbox row.
 */
describe("H6 hosted /v1 outbox emission (Conversations→Events)", () => {
  function outboxCalls(mark: number): Array<{ sql: string; params: readonly unknown[] }> {
    return activeFakeClient!.__debug.queryCalls.slice(mark).filter((c) => /INSERT INTO conversations_event_outbox/i.test(c.sql));
  }

  function outboxEnvelopes(mark: number): Array<{ data: Record<string, unknown> }> {
    return outboxCalls(mark).map((c) => JSON.parse(String(c.params[3])) as { data: Record<string, unknown> });
  }

  function seedTask(partial: Record<string, unknown>): void {
    activeFakeClient!.__debug.tasks.push({
      id: partial.id, uuid: partial.uuid, subject: partial.subject,
      status: partial.status ?? "pending", priority: partial.priority ?? "medium",
      assignee: partial.assignee ?? null, reporter: partial.reporter ?? "alice",
      project_id: partial.project_id ?? null, channel: null, parent_id: null,
      depends_on: partial.depends_on ?? [], tags: null, metadata: null, description: null,
      created_at: "2026-08-06T10:00:00.000Z", started_at: null, completed_at: null, cancelled_at: null, due_at: null,
    });
  }

  test("hosted task transition emits the past-tense action in the outbox", async () => {
    const mark = activeFakeClient!.__debug.queryCalls.length;
    seedTask({ id: 1001, uuid: "h6-start-uuid", subject: "h6-start" });
    const res = await fetch(`${base}/v1/tasks/1001/start`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ agent: "alice" }),
    });
    expect(res.status).toBe(200);
    const envelopes = outboxEnvelopes(mark);
    expect(envelopes).toHaveLength(1);
    // The hosted path must emit the past-tense action the local path pins
    // ("started"), never the raw HTTP verb ("start").
    expect(envelopes[0]!.data.action).toBe("started");
    expect(envelopes[0]!.data.transition_uuid).toBeTruthy();
  });

  test("hosted complete auto-unblocks dependents and emits an auto_unblocked outbox row", async () => {
    const mark = activeFakeClient!.__debug.queryCalls.length;
    seedTask({ id: 1002, uuid: "h6-complete-uuid", subject: "h6-complete" });
    seedTask({ id: 1003, uuid: "h6-dep-uuid", subject: "h6-dependents", status: "blocked", depends_on: [1002] });
    const res = await fetch(`${base}/v1/tasks/1002/complete`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ agent: "alice" }),
    });
    expect(res.status).toBe(200);
    const envelopes = outboxEnvelopes(mark);
    const actions = envelopes.map((e) => e.data.action);
    // The completed task emits the past-tense action.
    expect(actions).toContain("completed");
    // The auto-unblocked dependent gets its OWN outbox row (local-path parity),
    // and the dependent task actually flipped to pending.
    expect(actions).toContain("auto_unblocked");
    const dependent = activeFakeClient!.__debug.tasks.find((t) => Number(t.id) === 1003);
    expect(dependent?.status).toBe("pending");
  });

  test("message creation emits a message outbox row (hosted emission is not silent)", async () => {
    const channelName = "h6-outbox-channel";
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ name: channelName, created_by: "test", description: "d" }),
    });
    expect(created.status).toBe(201);
    const mark = activeFakeClient!.__debug.queryCalls.length;
    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: "outbox probe", channel: channelName }),
    });
    expect(sent.status).toBe(201);
    const envelopes = outboxEnvelopes(mark);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]!.data.uuid).toBeTruthy();
  });

  test("message creation binds an ISO-8601 timestamp into the outbox created_at even when pg returns a Date object", async () => {
    // Regression for todo 445de05e: `conversations send` failed with
    //   POST /messages -> 400: invalid input syntax for type timestamp with time zone:
    //   "Mon Aug 24 2026 17:33:54 GMT+0000 (Coordinated Universal Time)"
    // The hosted outbox INSERT binds `envelope.time` into a TIMESTAMPTZ column.
    // `pg` hands back a real Date for the message row's `created_at`, and
    // `String(date)` produced `Date.toString()` format instead of ISO 8601.
    // Mimic pg by having the fake messages INSERT return a Date object.
    const isoClient = makeFakeClient([], { messageCreatedAtAsDate: true });
    isoClient.__debug.seedChannel(
      {
        id: "chn_iso_0000000000000000000000000001",
        name: "h6-iso-channel",
        description: "d",
        topic: null,
        project_id: null,
        created_by: "test",
        created_at: "2026-08-06T10:00:00.000Z",
        archived_at: null,
        metadata: null,
        tags: null,
      },
      ["test"],
      [],
    );
    const isoKeys = new ApiKeyStore(isoClient as any);
    const isoVerifier = verifyApiKey({
      app: "conversations",
      signingSecret: SIGNING,
      keyStatus: async (): Promise<ApiKeyStatus> => "active",
    });
    const isoServer = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: { client: isoClient as any, keys: isoKeys, verifier: isoVerifier },
    });
    const isoBase = `http://127.0.0.1:${isoServer.port}`;
    try {
      const mark = isoClient.__debug.queryCalls.length;
      const sent = await fetch(`${isoBase}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({ from: "a", to: "b", content: "iso timestamp probe", channel: "h6-iso-channel" }),
      });
      expect(sent.status).toBe(201);
      const outbox = isoClient.__debug.queryCalls
        .slice(mark)
        .filter((c) => /INSERT INTO conversations_event_outbox/i.test(c.sql));
      expect(outbox).toHaveLength(1);
      // The outbox INSERT is
      //   (id, source, type, envelope_json, created_at, status, attempts)
      // so the 5th param ($5) is the timestamp bound to the TIMESTAMPTZ column.
      const createdParam = String(outbox[0]!.params[4]);
      expect(createdParam).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(createdParam).not.toMatch(/(GMT|Coordinated Universal Time)/);
    } finally {
      isoServer.stop(true);
    }
  });
  test("message creation normalizes a PG Date before inserting the outbox timestamp", async () => {
    const channelName = "h6-outbox-date-channel";
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ name: channelName, created_by: "test", description: "d" }),
    });
    expect(created.status).toBe(201);

    activeFakeClient!.__debug.returnNextMessageCreatedAtAsDate();
    const mark = activeFakeClient!.__debug.queryCalls.length;
    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: "date outbox probe", channel: channelName }),
    });

    expect(sent.status).toBe(201);
    const calls = outboxCalls(mark);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params[4]).toBe("2026-08-24T17:30:31.000Z");
    const envelope = JSON.parse(String(calls[0]!.params[3])) as { time: string; data: { created_at: string } };
    expect(envelope.time).toBe("2026-08-24T17:30:31.000Z");
    expect(envelope.data.created_at).toBe("2026-08-24T17:30:31.000Z");
  });
});

describe("emoji reactions on /v1/messages/:id/reactions", () => {
  async function seedReactionMessage(from = "alice", to = "bob", content = "react me"): Promise<number> {
    const row = {
      id: activeFakeClient!.__debug.messages.length + 1000,
      uuid: `uuid-reaction-${activeFakeClient!.__debug.messages.length + 1000}`,
      session_id: "react-session",
      from_agent: from,
      to_agent: to,
      channel: null,
      project_id: null,
      content,
      priority: "normal",
      working_dir: null,
      repository: null,
      branch: null,
      metadata: null,
      blocking: false,
      reply_to: null,
      created_at: new Date().toISOString(),
    };
    activeFakeClient!.__debug.messages.push(row);
    return row.id;
  }

  test("POST toggles: first add returns added, same actor re-add returns removed", async () => {
    const id = await seedReactionMessage();
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };

    const added = await fetch(`${base}/v1/messages/${id}/reactions`, {
      method: "POST", headers, body: JSON.stringify({ emoji: "👍", agent: "bob" }),
    });
    expect(added.status).toBe(201);
    const addedBody = await added.json() as any;
    expect(addedBody.toggled).toBe("added");
    expect(addedBody.reaction.emoji).toBe("👍");
    expect(addedBody.reaction.agent).toBe("bob");
    expect(addedBody.reaction.message_id).toBe(id);

    const removed = await fetch(`${base}/v1/messages/${id}/reactions`, {
      method: "POST", headers, body: JSON.stringify({ emoji: "👍", agent: "bob" }),
    });
    expect(removed.status).toBe(200);
    const removedBody = await removed.json() as any;
    expect(removedBody.toggled).toBe("removed");
    expect(removedBody.reaction).toBeNull();

    const summary = await fetch(`${base}/v1/messages/${id}/reactions?summary=true`, { headers: { "x-api-key": roKey } });
    expect((await summary.json() as any).summary).toEqual([]);
  });

  test("POST defaults agent to the authenticated identity", async () => {
    const id = await seedReactionMessage();
    const added = await fetch(`${base}/v1/messages/${id}/reactions`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ emoji: "❤️" }),
    });
    expect(added.status).toBe(201);
    const body = await added.json() as any;
    expect(body.reaction.agent).toBe("test"); // minted rwKey agent
  });

  test("GET summary and raw list report per-actor rows grouped by emoji", async () => {
    const id = await seedReactionMessage();
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };
    for (const agent of ["bob", "charlie"]) {
      await fetch(`${base}/v1/messages/${id}/reactions`, { method: "POST", headers, body: JSON.stringify({ emoji: "👍", agent }) });
    }
    await fetch(`${base}/v1/messages/${id}/reactions`, { method: "POST", headers, body: JSON.stringify({ emoji: "❤️", agent: "alice" }) });

    const summaryRes = await fetch(`${base}/v1/messages/${id}/reactions?summary=true`, { headers: { "x-api-key": roKey } });
    const summary = (await summaryRes.json() as any).summary;
    expect(summary).toHaveLength(2);
    const thumbs = summary.find((s: any) => s.emoji === "👍");
    expect(thumbs.count).toBe(2);
    expect(thumbs.agents.sort()).toEqual(["bob", "charlie"]);

    const listRes = await fetch(`${base}/v1/messages/${id}/reactions`, { headers: { "x-api-key": roKey } });
    const list = (await listRes.json() as any).reactions;
    expect(list).toHaveLength(3);
  });

  test("DELETE is idempotent: removes once, then 404", async () => {
    const id = await seedReactionMessage();
    await fetch(`${base}/v1/messages/${id}/reactions`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ emoji: "🚀", agent: "bob" }),
    });
    const del = await fetch(`${base}/v1/messages/${id}/reactions?agent=bob&emoji=%F0%9F%9A%80`, {
      method: "DELETE", headers: { "x-api-key": rwKey },
    });
    expect(del.status).toBe(200);
    expect((await del.json() as any).removed).toBe(true);

    const again = await fetch(`${base}/v1/messages/${id}/reactions?agent=bob&emoji=%F0%9F%9A%80`, {
      method: "DELETE", headers: { "x-api-key": rwKey },
    });
    expect(again.status).toBe(404);
  });

  test("server normalizes emoji with NFKC so composed/decomposed spellings toggle", async () => {
    const id = await seedReactionMessage();
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };
    // é composed then decomposed — NFKC-equal, so the second is a removal.
    const composed = await fetch(`${base}/v1/messages/${id}/reactions`, {
      method: "POST", headers, body: JSON.stringify({ emoji: "é", agent: "bob" }),
    });
    expect((await composed.json() as any).toggled).toBe("added");
    const decomposed = await fetch(`${base}/v1/messages/${id}/reactions`, {
      method: "POST", headers, body: JSON.stringify({ emoji: "é", agent: "bob" }),
    });
    expect((await decomposed.json() as any).toggled).toBe("removed");
  });

  test("single-message GET carries the additive reactions envelope", async () => {
    const id = await seedReactionMessage();
    await fetch(`${base}/v1/messages/${id}/reactions`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ emoji: "👍", agent: "bob" }),
    });
    const show = await fetch(`${base}/v1/messages/${id}`, { headers: { "x-api-key": roKey } });
    expect(show.status).toBe(200);
    const message = (await show.json() as any).message;
    expect(message.reactions).toBeTruthy();
    expect(message.reactions[0].emoji).toBe("👍");
    expect(message.reactions[0].count).toBe(1);
  });

  test("POST rejects a credential-shaped emoji (400, nothing stored)", async () => {
    const id = await seedReactionMessage();
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };
    const res = await fetch(`${base}/v1/messages/${id}/reactions`, {
      method: "POST", headers, body: JSON.stringify({ emoji: "glpat-abcdefghijklmnopqrstuvwxyz0123", agent: "bob" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(JSON.stringify(body)).toMatch(/sensitive content/i);
    expect(JSON.stringify(body)).not.toContain("glpat-abcdefghijklmnopqrstuvwxyz0123");
    const list = await (await fetch(`${base}/v1/messages/${id}/reactions`, { headers: { "x-api-key": roKey } })).json() as any;
    expect(list.reactions).toEqual([]);
  });

  test("a credential-shaped emoji seeded into the store is REDACTED on GET /reactions (raw + summary) and the show envelope", async () => {
    const id = await seedReactionMessage();
    const bad = "glpat-abcdefghijklmnopqrstuvwxyz0123";
    // Bypass the write assert to simulate a malicious emoji that somehow
    // reached the store: seed the raw row straight into the fake PG client.
    activeFakeClient!.__debug.reactions.push({
      id: activeFakeClient!.__debug.reactions.length + 1,
      message_id: id,
      agent: "bob",
      emoji: bad,
      created_at: new Date().toISOString(),
    });

    const roHeaders = { "x-api-key": roKey };

    // raw list
    const raw = (await (await fetch(`${base}/v1/messages/${id}/reactions`, { headers: roHeaders })).json() as any).reactions;
    expect(raw).toHaveLength(1);
    expect(raw[0].emoji).toContain("[REDACTED");
    expect(raw[0].emoji).not.toContain(bad);

    // grouped summary
    const summary = (await (await fetch(`${base}/v1/messages/${id}/reactions?summary=true`, { headers: roHeaders })).json() as any).summary;
    expect(summary).toHaveLength(1);
    expect(summary[0].emoji).toContain("[REDACTED");
    expect(summary[0].emoji).not.toContain(bad);

    // show envelope
    const show = (await (await fetch(`${base}/v1/messages/${id}`, { headers: roHeaders })).json() as any).message;
    expect(show.reactions).toBeTruthy();
    expect(show.reactions[0].emoji).toContain("[REDACTED");
    expect(show.reactions[0].emoji).not.toContain(bad);
  });

  test("real emoji survive redaction on GET /reactions and the show envelope", async () => {
    const id = await seedReactionMessage();
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };
    await fetch(`${base}/v1/messages/${id}/reactions`, { method: "POST", headers, body: JSON.stringify({ emoji: "👍", agent: "bob" }) });
    await fetch(`${base}/v1/messages/${id}/reactions`, { method: "POST", headers, body: JSON.stringify({ emoji: "👩‍💻", agent: "alice" }) });

    const roHeaders = { "x-api-key": roKey };
    const expected = ["👩‍💻", "👍"].sort();
    const raw = (await (await fetch(`${base}/v1/messages/${id}/reactions`, { headers: roHeaders })).json() as any).reactions;
    expect(raw.map((r: any) => r.emoji).sort()).toEqual(expected);
    const summary = (await (await fetch(`${base}/v1/messages/${id}/reactions?summary=true`, { headers: roHeaders })).json() as any).summary;
    expect(summary.map((s: any) => s.emoji).sort()).toEqual(expected);
    const show = (await (await fetch(`${base}/v1/messages/${id}`, { headers: roHeaders })).json() as any).message;
    expect(show.reactions.map((s: any) => s.emoji).sort()).toEqual(expected);
  });
});
