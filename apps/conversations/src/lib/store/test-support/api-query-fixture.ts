import { taskProjectQueries } from "./task-project-query-fixture.js";
// In-memory query shim standing in for the vendored kit's TypedQueryClient.
// Exercises the router + auth without a live Postgres.
export function makeFakeClient(
  initialProjects: Array<Record<string, any>> = [
    { id: "proj-valid", name: "Chief of Harness" },
  ],
  opts: { messageCreatedAtAsDate?: boolean } = {},
) {
  // Explicit synthetic owner for this in-memory corpus; real PostgreSQL tests
  // initialize ownership with the administrative adoption transaction.
  const corpusBinding = { corpus_id: `cor_${crypto.randomUUID().replaceAll("-", "")}`, tenant_id: "default", authority_id: "conversations", receipt_id: crypto.randomUUID(), actor: "fixture-operator", adopted_at: new Date().toISOString(), legacy_receipt_count: 0, legacy_receipt_digest: "0".repeat(64) };
  const channels: Record<string, any> = {};
  const channelAliases: Record<string, string> = {};
  const channelMembers = new Set<string>();
  const messages: any[] = [];
  const reactions: any[] = [];
  const readReceipts: any[] = [];
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
  const taskProject = taskProjectQueries(tasks, projects, channels);
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
  function messageRows(sql: string, params: readonly unknown[]): any[] {
    let rows = messages.slice();
    const where = sql.slice(sql.indexOf("WHERE") + 5);
    for (const match of where.matchAll(/(?:\b(?:m|messages)\.)?\b(id|uuid|channel|session_id|project_id|to_agent|from_agent|reply_to)\s*(=|<>|>)\s*\$(\d+)/gi)) {
      const [, field, op, position] = match;
      const value = params[Number(position) - 1];
      rows = rows.filter(row => op === "=" ? String(row[field]) === String(value) : op === "<>" ? String(row[field]) !== String(value) : Number(row[field]) > Number(value));
    }
    for (const match of where.matchAll(/(?:\b(?:m|messages)\.)?created_at\s*(>=|<=|>|<)\s*\$(\d+)/gi)) {
      const value = Date.parse(String(params[Number(match[2]) - 1]));
      rows = rows.filter(row => { const t = Date.parse(row.created_at); return match[1] === ">" ? t > value : match[1] === ">=" ? t >= value : match[1] === "<" ? t < value : t <= value; });
    }
    if (/\bread_at IS NULL/i.test(where)) rows = rows.filter(row => row.read_at == null);
    if (/\breply_to IS NULL/i.test(where)) rows = rows.filter(row => row.reply_to == null);
    if (/\bpinned_at IS NOT NULL/i.test(where)) rows = rows.filter(row => row.pinned_at != null);
    if (/\bblocking = true/i.test(where)) rows = rows.filter(row => row.blocking);
    const search = where.match(/content ILIKE \$(\d+)/i);
    if (search) { const term = String(params[Number(search[1]) - 1]).replace(/^%|%$/g, "").toLowerCase(); rows = rows.filter(row => String(row.content).toLowerCase().includes(term)); }
    if (/JOIN message_mentions/i.test(sql)) {
      rows = rows.flatMap(row => messageMentions.filter(mm => mm.message_id === row.id && mm.mentioned_agent === params[0] && (!/mm.notified_at IS NULL/i.test(where) || mm.notified_at == null)).map(mm => ({ ...row, mention_id: mm.id, unread: mm.notified_at == null })));
    }
    const mention = where.match(/mentioned_agent = \$(\d+)/i);
    if (mention) rows = rows.filter(row => messageMentions.some(mm => mm.message_id === row.id && mm.mentioned_agent === params[Number(mention[1]) - 1]));
    const ascending = /ORDER BY (?:m\.)?(?:created_at|pinned_at|id) ASC/i.test(sql);
    rows.sort((a,b) => (/ORDER BY (?:m\.)?id /i.test(sql) ? Number(a.id)-Number(b.id) : Date.parse(/ORDER BY (?:m\.)?pinned_at /i.test(sql) ? a.pinned_at : a.created_at)-Date.parse(/ORDER BY (?:m\.)?pinned_at /i.test(sql) ? b.pinned_at : b.created_at) || Number(a.id)-Number(b.id)) * (ascending ? 1 : -1));
    const limit = sql.match(/LIMIT \$(\d+)/i); const offset = sql.match(/OFFSET \$(\d+)/i);
    const start = offset ? Number(params[Number(offset[1])-1]) : 0;
    rows = rows.slice(start, limit ? start + Number(params[Number(limit[1])-1]) : undefined);
    return rows.map(row => ({ ...row, preview_source: String(row.content ?? "").slice(0, 8192), content_bytes: Buffer.byteLength(String(row.content ?? "")), reply_count: messages.filter(r => r.reply_to === row.id).length }));
  }
  const client = {
    async many(sql: string, _p: readonly unknown[] = []): Promise<any[]> {
      manyCalls.push({ sql, params: [..._p] });
      const taskResult = taskProject.many(sql, _p);
      if (taskResult !== undefined) return taskResult;
      // Hosted events outbox: no pending rows in the fixture.
      if (/FROM conversations_event_outbox/i.test(sql)) return [] as any[];
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
        for (const match of sql.matchAll(/\b(name|status) = \$(\d+)/g)) rows = rows.filter(row => row[match[1]] === _p[Number(match[2])-1]);
        const tagFilter = sql.match(/tags LIKE \$(\d+)/i);
        if (tagFilter) rows = rows.filter(row => String(row.tags ?? "").includes(String(_p[Number(tagFilter[1])-1]).replaceAll("%", "")));
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
      if (/WITH latest AS/i.test(sql) && /legacy_ids AS/i.test(sql)) {
        const who=String(_p[2]).toLowerCase();
        return messages.filter(m=>m.blocking && m.read_at==null && (String(m.to_agent).toLowerCase()===who || [...channelMembers].some(entry=>entry.toLowerCase()===`${m.channel}:${who}`))).sort((a,b)=>a.created_at.localeCompare(b.created_at) || a.id-b.id).slice(Number(_p[4]),Number(_p[4])+Number(_p[3])).map(m=>({...m,preview_source:m.content,content_bytes:Buffer.byteLength(m.content)}));
      }
      if (/GROUP BY session_id ORDER BY last_message_at DESC/i.test(sql)) {
        const selected = _p.length ? messages.filter(m=>m.from_agent===_p[0] || m.to_agent===_p[0]) : messages;
        const sessions = new Map<string, any[]>(); for(const m of selected) sessions.set(m.session_id,[...(sessions.get(m.session_id)??[]),m]);
        return [...sessions].map(([session_id, rows])=>({session_id,all_agents:[...new Set(rows.flatMap(m=>[m.from_agent,m.to_agent]))].join(","),last_message_at:rows.map(m=>m.created_at).sort().at(-1),message_count:rows.length,unread_count:rows.filter(m=>m.read_at==null && (!_p.length || m.to_agent===_p[0])).length})).sort((a,b)=>String(b.last_message_at).localeCompare(String(a.last_message_at)));
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
      if (/SELECT message_id, agent, read_at FROM message_read_receipts/i.test(sql)) return readReceipts.filter(row => row.message_id === Number(_p[0]));
      if (/AS last_activity_at/i.test(sql) && /FROM messages m/i.test(sql)) {
        const roots = messages.filter(m => m.channel === _p[0] && m.reply_to == null).flatMap(m => {
          const replies = messages.filter(r => r.thread_id === m.id || (r.thread_id == null && r.reply_to === m.id));
          if (!replies.length) return [];
          return [{...m, preview_source:m.content, content_bytes:Buffer.byteLength(m.content), reply_count:replies.length, last_activity_at:replies.map(r=>r.created_at).sort().at(-1), unread_count:replies.filter(r=>r.from_agent.toLowerCase()!==String(_p[1]).toLowerCase() && !readReceipts.some(rc=>rc.message_id===r.id && rc.agent===_p[2])).length}];
        });
        const offset = Number(_p.at(-1)); const limit = Number(_p.at(-2));
        return roots.sort((a,b)=>String(b.last_activity_at).localeCompare(String(a.last_activity_at)) || b.id-a.id).slice(offset,offset+limit);
      }
      if (/WHERE \(thread_id = \$1 OR \(thread_id IS NULL AND reply_to = \$1\)\)/i.test(sql)) {
        return messages.filter(r=>r.thread_id===_p[0] || (r.thread_id==null && r.reply_to===_p[0])).sort((a,b)=>a.created_at.localeCompare(b.created_at) || a.id-b.id);
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
      if (/INNER JOIN channel_subscriptions/i.test(sql)) {
        let rows = messages.flatMap(m => channelSubscriptions.filter(sub => sub.channel === m.channel && sub.agent === _p[0] && m.from_agent !== _p[1] && m.id > sub.since_message_id).map(sub => ({ ...m, message_id: m.id, preview_source: m.content, preview_chars: sub.preview_chars, attachment_count: m.attachments ? JSON.parse(m.attachments).length : 0, read_message_id: channelNotificationReads.find(r => r.agent === sub.agent && r.message_id === m.id)?.message_id ?? null })));
        if (/snr.message_id IS NULL/i.test(sql)) rows = rows.filter(r => r.read_message_id == null);
        const channel = sql.match(/m.channel = \$(\d+)/i); if (channel) rows = rows.filter(r => r.channel === _p[Number(channel[1])-1]);
        const since = sql.match(/m.created_at > \$(\d+)/i); if (since) rows = rows.filter(r => Date.parse(r.created_at) > Date.parse(String(_p[Number(since[1])-1])));
        const limit = sql.match(/LIMIT \$(\d+)/i); const offset = sql.match(/OFFSET \$(\d+)/i); const start = offset ? Number(_p[Number(offset[1])-1]) : 0;
        return rows.sort((a,b) => b.id-a.id).slice(start, limit ? start+Number(_p[Number(limit[1])-1]) : undefined);
      }
      if (/FROM messages/i.test(sql)) return messageRows(sql, _p);
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
      const taskResult = taskProject.query(sql, p);
      if (taskResult !== undefined) return taskResult;
      if (/INSERT INTO message_read_receipts/i.test(sql)) {
        const bulk = /unnest/i.test(sql); const ids = bulk ? p[0] as number[] : [Number(p[0])]; const agent = String(p[1]); let count = 0;
        for (const id of ids) if (!readReceipts.some(r => r.message_id === Number(id) && r.agent === agent)) { readReceipts.push({message_id:Number(id),agent,read_at:new Date().toISOString()}); count++; }
        return { rows: [], rowCount: count };
      }
      if (/UPDATE messages SET read_at/i.test(sql)) {
        const ids = /id = ANY/i.test(sql) ? new Set(p[0] as number[]) : null;
        let rows = ids ? messages.filter(row => ids.has(row.id)) : messageRows(sql, p);
        const reset = /SET read_at = NULL/i.test(sql); rows = rows.filter(row => reset ? row.read_at != null : row.read_at == null);
        for (const row of rows) { const source = messages.find(m => m.id === row.id)!; source.read_at = reset ? null : new Date().toISOString(); }
        return {rows:[],rowCount:rows.length};
      }
      if (/DELETE FROM agent_presence WHERE LOWER\(agent\) = \$1/i.test(sql)) return {rows:[],rowCount:agentPresence.delete(String(p[0]).toLowerCase()) ? 1 : 0};
      if (/UPDATE agent_presence SET agent = \$1 WHERE LOWER\(agent\) = \$2/i.test(sql)) {
        const old = String(p[1]).toLowerCase(); const row = agentPresence.get(old);
        if (!row) return {rows:[],rowCount:0};
        agentPresence.delete(old); row.agent = String(p[0]); agentPresence.set(String(p[0]).toLowerCase(), row);
        return {rows:[],rowCount:1};
      }
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
            client.__debug.agentPresenceReapArchive.push({ reaped_at: new Date().toISOString(), ...row });
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
      if (/DELETE FROM channel_members WHERE channel = \$1 AND agent = \$2/i.test(sql)) {
        const removed = channelMembers.delete(`${p[0]}:${p[1]}`);
        return { rows: [], rowCount: removed ? 1 : 0 };
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
        const ids = Array.isArray(messageIds) ? (messageIds as any[]).map(Number) : /INNER JOIN channel_subscriptions/i.test(sql) ? messages.filter(m=>m.channel!=null && m.from_agent!==p[1] && channelSubscriptions.some(sub=>sub.channel===m.channel && sub.agent===agent && m.id>sub.since_message_id)).map(m=>m.id) : [];
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
      if (sql.includes("FROM conversations_corpus_binding b JOIN project_channel_registration_identity")) return { ...corpusBinding };
      const taskResult = taskProject.get(sql, p);
      if (taskResult !== undefined) return taskResult;
      if (/SELECT count\(\*\)::bigint AS n FROM messages/i.test(sql)) return {n:messageRows(sql,p).length};
      if (/SELECT COALESCE\(MAX\(id\), 0\)::int AS max_id FROM messages WHERE channel = \$1/i.test(sql)) return {max_id:Math.max(0,...messages.filter(m=>m.channel===p[0]).map(m=>m.id))};
      // Hosted feedback insert: RETURNING id answers through one().
      if (/INSERT INTO feedback/i.test(sql)) return { id: "feedback-fixture-id" };
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
      if (/SELECT 1 FROM channels WHERE name = \$1/i.test(sql)) return channels[String(p[0])] ? {ok:1} : null;
      if (/SELECT id, reply_to(?:, thread_id)? FROM messages WHERE id = \$1/i.test(sql)) return messages.find(m=>m.id===Number(p[0])) ?? null;
      if (/UPDATE messages SET thread_status = \$1 WHERE id = \$2/i.test(sql)) { const row=messages.find(m=>m.id===Number(p[1])); if(!row)return null; row.thread_status=p[0]; return {...row}; }
      if (/SELECT count\(\*\) AS n FROM messages m/i.test(sql) && /AND EXISTS/i.test(sql)) return {n:messages.filter(m=>m.channel===p[0] && m.reply_to==null && messages.some(r=>r.thread_id===m.id || (r.thread_id==null && r.reply_to===m.id))).length};
      if (/UPDATE messages SET pinned_at/i.test(sql)) {
        const row = messages.find(m => m.id === Number(p[0])); if (!row) return null;
        row.pinned_at = /SET pinned_at = NULL/i.test(sql) ? null : new Date().toISOString(); return {...row};
      }
      if (/UPDATE messages SET content = \$1/i.test(sql)) {
        const row = messages.find(m => m.id === Number(p[1]) && m.from_agent === p[2]); if (!row) return null;
        row.content = p[0]; row.edited_at = new Date().toISOString(); return {...row};
      }
      if (/DELETE FROM messages WHERE id = \$1 AND from_agent = \$2/i.test(sql)) {
        const index = messages.findIndex(m => m.id === Number(p[0]) && m.from_agent === p[1]); if (index < 0) return null;
        return messages.splice(index,1)[0];
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
      if (/SELECT COUNT\(\*\)::bigint AS n FROM incident_projections/i.test(sql)) return { n: 0 };
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
        if (/archived_at = NOW/i.test(setMatch[1])) row.archived_at=new Date().toISOString();
        if (/archived_at = NULL/i.test(setMatch[1])) row.archived_at=null;
        for (const assignment of setMatch[1].matchAll(/(\w+)\s*=\s*\$(\d+)/g)) {
          row[assignment[1]] = p[Number(assignment[2]) - 1];
        }
        return row;
      }
      if (/INSERT INTO messages/i.test(sql)) {
        // Destructured positionally, so this must track the column list in the
        // INSERT. metadata and reply_to are positional; a column missing from
        // the statement is exactly how server-side fields were dropped.
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
    // Hosted feedback insert (and any RETURNING id path) resolves through one().
    async one(sql: string, p: readonly unknown[] = []): Promise<any> {
      const row = await client.get(sql, p);
      if (!row) throw new Error("Expected exactly one row, got 0.");
      return row;
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
      const taskSnapshot = structuredClone(tasks);
      const taskAuxSnapshot = taskProject.snapshot();
      const edgeSnapshot = graphEdges.map((edge) => ({ ...edge }));
      const lockSnapshot = resourceLocks.map((lock) => ({ ...lock }));
      let channelIdConstraintDeferred = false;
      const linkageReceiptSnapshot = linkageReceipts.map((receipt) => ({ ...receipt }));
      const tx = {
        async query(sql: string, p: readonly unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
          const taskResult = taskProject.query(sql, p);
          if (taskResult !== undefined) { queryCalls.push({ sql, params: [...p] }); return taskResult; }
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
        taskProject.restore(taskAuxSnapshot);
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
      seedMessages(rows: Array<Record<string, any>>) {
        for (const input of rows) {
          const row = { id: nextId++, uuid: crypto.randomUUID(), created_at: new Date().toISOString(), priority: "normal", read_at: null, metadata: null, attachments: null, reply_to: null, ...input };
          nextId = Math.max(nextId, Number(row.id) + 1);
          messages.push(row);
        }
      },
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
