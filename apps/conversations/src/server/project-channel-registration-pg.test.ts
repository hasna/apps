import { afterEach, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import type {
  PoolQueryClient,
  QueryResult,
  TypedQueryClient,
} from "../generated/storage-kit/query.js";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import { createHasnaHttpTransport, HasnaHttpError } from "@hasna/contracts/client";
import { ApiStore } from "../lib/store/api-store.js";
import {
  createProjectChannelRegistrationAuthority,
  projectChannelRegistrationChannelRecord,
  projectChannelRegistrationDigest,
  type ProjectChannelRegistrationRequest,
} from "../lib/project-channel-registration.js";
import {
  compensateProjectChannelRegistrationPg,
  listProjectChannelMessagePagePg,
  listProjectChannelRegistrationPagePg,
  lookupProjectChannelRegistrationReceiptPg,
  projectChannelRegistrationPgCapability,
  readProjectChannelRegistrationExactPg,
  registerProjectChannelPg,
  verifyProjectChannelRegistrationInversePg,
} from "./project-channel-registration-pg.js";
import { startApiServer, type ApiServerDeps } from "./api.js";

type ReceiptRow = Record<string, unknown> & {
  receipt_id: string;
  authority: string;
  route: string;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  operation_id: string;
  step_id: string;
  resource_kind: string;
  direction: string;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  outcome: string;
  reason: string | null;
  target_id: string | null;
  result_revision: string | null;
  result_digest: string | null;
  duplicate_of_receipt_id: string | null;
  accepted_receipt_id: string | null;
  created_by_operation: boolean;
  prior_state: Record<string, unknown> | null;
  created_at: string;
};

type ChannelRow = Record<string, unknown> & {
  id: string;
  name: string;
  description: string | null;
  topic: string | null;
  project_id: string | null;
  created_by: string;
  created_at: string;
  archived_at: string | null;
  metadata: string | null;
  tags: string | null;
};

type MessageRow = Record<string, unknown> & {
  id: number;
  uuid: string;
  session_id: string;
  from_agent: string;
  to_agent: string;
  channel: string;
  project_id: string | null;
  content: string;
  priority: string;
  reply_to: number | null;
  created_at: string;
};

interface FakeState {
  corpusId: string;
  channels: Map<string, ChannelRow>;
  messages: MessageRow[];
  receipts: Map<string, ReceiptRow>;
  members: Set<string>;
  references: Set<string>;
  advisoryLockKeys: string[];
}

function normalizedSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

class FakeProjectRegistrationClient implements PoolQueryClient {
  readonly pool = {} as Pool;
  state: FakeState = {
    corpusId: "cor_11111111111111111111111111111111",
    channels: new Map(),
    messages: [],
    receipts: new Map(),
    members: new Set(),
    references: new Set(),
    advisoryLockKeys: [],
  };

  private rows(sql: string, params: readonly unknown[] = []): Array<Record<string, unknown>> {
    const query = normalizedSql(sql);
    if (query.includes("FROM project_channel_registration_identity")) {
      return [{ corpus_id: this.state.corpusId }];
    }
    if (query.includes("pg_advisory_xact_lock")) {
      this.state.advisoryLockKeys.push(String(params[0]));
      return [{ locked: true }];
    }
    if (
      query.startsWith("SELECT * FROM project_channel_registration_receipts")
      && query.includes("outcome = 'accepted'")
    ) {
      const [
        authority, route, packageVersion, authorityId, tenantId, corpusId,
        operationId, stepId, direction,
      ] = params.map(String);
      return [...this.state.receipts.values()]
        .filter((row) =>
          row.authority === authority
          && row.route === route
          && row.package_version === packageVersion
          && row.authority_id === authorityId
          && row.tenant_id === tenantId
          && row.corpus_id === corpusId
          && row.operation_id === operationId
          && row.step_id === stepId
          && row.direction === direction
          && row.outcome === "accepted")
        .sort((left, right) => right.receipt_id.localeCompare(left.receipt_id))
        .slice(0, 2);
    }
    if (query.startsWith("INSERT INTO project_channel_registration_receipts")) {
      const receipt: ReceiptRow = {
        receipt_id: String(params[0]),
        authority: String(params[1]),
        route: String(params[2]),
        package_version: String(params[3]),
        authority_id: String(params[4]),
        tenant_id: String(params[5]),
        corpus_id: String(params[6]),
        operation_id: String(params[7]),
        step_id: String(params[8]),
        resource_kind: String(params[9]),
        direction: String(params[10]),
        idempotency_key: String(params[11]),
        request_digest: String(params[12]),
        precondition_digest: String(params[13]),
        outcome: String(params[14]),
        reason: params[15] == null ? null : String(params[15]),
        target_id: params[16] == null ? null : String(params[16]),
        result_revision: params[17] == null ? null : String(params[17]),
        result_digest: params[18] == null ? null : String(params[18]),
        duplicate_of_receipt_id: params[19] == null ? null : String(params[19]),
        accepted_receipt_id: params[20] == null ? null : String(params[20]),
        created_by_operation: params[21] === true,
        prior_state: params[22] == null ? null : params[22] as Record<string, unknown>,
        created_at: String(params[23]),
      };
      if (this.state.receipts.has(receipt.receipt_id)) return [];
      this.state.receipts.set(receipt.receipt_id, receipt);
      return [receipt];
    }
    if (
      query === "SELECT * FROM project_channel_registration_receipts WHERE receipt_id = $1"
    ) {
      const row = this.state.receipts.get(String(params[0]));
      return row ? [row] : [];
    }
    if (
      query.startsWith("SELECT * FROM project_channel_registration_receipts")
      && query.includes("idempotency_key = $10")
    ) {
      const [
        authority, route, packageVersion, authorityId, tenantId, corpusId,
        operationId, stepId, direction, idempotencyKey, requestDigest,
        preconditionDigest,
      ] = params.map(String);
      const targetId = params[12] == null ? null : String(params[12]);
      const priority = (outcome: string) =>
        outcome === "terminal_nonacceptance" ? 3
          : outcome === "duplicate_of_accepted" ? 2 : 1;
      return [...this.state.receipts.values()]
        .filter((row) =>
          row.authority === authority
          && row.route === route
          && row.package_version === packageVersion
          && row.authority_id === authorityId
          && row.tenant_id === tenantId
          && row.corpus_id === corpusId
          && row.operation_id === operationId
          && row.step_id === stepId
          && row.direction === direction
          && row.idempotency_key === idempotencyKey
          && row.request_digest === requestDigest
          && row.precondition_digest === preconditionDigest
          && (targetId === null || row.target_id === targetId))
        .sort((left, right) =>
          priority(right.outcome) - priority(left.outcome)
          || right.receipt_id.localeCompare(left.receipt_id))
        .slice(0, 4);
    }
    if (query.startsWith("SELECT * FROM channels WHERE name = $1")) {
      const row = this.state.channels.get(String(params[0]));
      return row ? [row] : [];
    }
    if (query.startsWith("SELECT * FROM channels WHERE project_id = $1")) {
      const projectId = String(params[0]);
      if (params.length === 1) {
        return [...this.state.channels.values()]
          .filter((channel) => channel.project_id === projectId)
          .sort((left, right) => left.id.localeCompare(right.id));
      }
      const cursor = params[1] == null ? null : String(params[1]);
      const limit = Number(params[2]);
      return [...this.state.channels.values()]
        .filter((channel) =>
          channel.project_id === projectId
          && (cursor === null || channel.id > cursor))
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, limit);
    }
    if (query.startsWith("SELECT * FROM channels WHERE id = $1")) {
      const row = [...this.state.channels.values()].find(
        (channel) => channel.id === String(params[0]),
      );
      return row ? [row] : [];
    }
    if (query.startsWith("SELECT id FROM channels WHERE id = $1")) {
      const row = [...this.state.channels.values()].find(
        (channel) => channel.id === String(params[0]),
      );
      return row ? [{ id: row.id }] : [];
    }
    if (query.startsWith("INSERT INTO channels")) {
      const row: ChannelRow = {
        id: String(params[0]),
        name: String(params[1]),
        description: null,
        topic: null,
        project_id: String(params[2]),
        created_by: String(params[3]),
        created_at: "2026-08-08T09:00:00.000Z",
        archived_at: null,
        metadata: null,
        tags: null,
      };
      if (this.state.channels.has(row.name)) throw new Error("duplicate channel");
      this.state.channels.set(row.name, row);
      return [row];
    }
    if (
      query.startsWith("UPDATE channels SET project_id = $1")
      && query.includes("RETURNING *")
    ) {
      const nextProjectId = params[0] == null ? null : String(params[0]);
      const targetId = String(params[1]);
      const channelName = String(params[2]);
      const expectedProjectId = params[3] == null ? null : String(params[3]);
      const current = this.state.channels.get(channelName);
      if (
        !current
        || current.id !== targetId
        || current.project_id !== expectedProjectId
      ) {
        return [];
      }
      const updated = { ...current, project_id: nextProjectId };
      this.state.channels.set(channelName, updated);
      return [updated];
    }
    if (
      query.startsWith("SELECT id, uuid, project_id FROM messages")
    ) {
      const channel = String(params[0]);
      return this.state.messages
        .filter((message) => message.channel === channel)
        .sort((left, right) => left.id - right.id)
        .map(({ id, uuid, project_id }) => ({ id, uuid, project_id }));
    }
    if (
      query.startsWith("SELECT id, uuid, session_id, from_agent, to_agent, channel, project_id")
      && query.includes("FROM messages")
    ) {
      const channel = String(params[0]);
      return this.state.messages
        .filter((message) => message.channel === channel)
        .sort((left, right) => left.id - right.id);
    }
    if (
      query.startsWith("UPDATE messages SET project_id = $1")
      && query.includes("RETURNING id")
    ) {
      const nextProjectId = params[0] == null ? null : String(params[0]);
      const channel = String(params[1]);
      const expectedProjectId = params[2] == null ? null : String(params[2]);
      const updated: Array<{ id: number }> = [];
      this.state.messages = this.state.messages.map((message) => {
        if (
          message.channel !== channel
          || message.project_id !== expectedProjectId
        ) {
          return message;
        }
        updated.push({ id: message.id });
        return { ...message, project_id: nextProjectId };
      });
      return updated;
    }
    if (
      query.startsWith("SELECT COUNT(*)::bigint AS count FROM messages")
    ) {
      const channel = String(params[0]);
      const projectId = String(params[1]);
      return [{
        count: this.state.messages.filter((message) =>
          message.channel === channel
          && (message.project_id === null || message.project_id !== projectId)).length,
      }];
    }
    if (
      query.includes("FROM messages m JOIN channels c ON c.name = m.channel")
      && query.includes("LEFT JOIN messages parent ON parent.id = m.reply_to")
    ) {
      const channelId = String(params[0]);
      const projectId = String(params[1]);
      const cursor = Number(params[2]);
      const limit = Number(params[3]);
      const channel = [...this.state.channels.values()].find((row) => row.id === channelId);
      if (!channel) return [];
      return this.state.messages
        .filter((message) =>
          message.channel === channel.name
          && message.project_id === projectId
          && message.id > cursor)
        .sort((left, right) => left.id - right.id)
        .slice(0, limit)
        .map((message) => ({
          local_id: message.id,
          target_id: message.uuid,
          channel_id: channel.id,
          channel: channel.name,
          project_id: message.project_id,
          reply_to_target_id: message.reply_to === null
            ? null
            : this.state.messages.find((candidate) =>
              candidate.id === message.reply_to
              && (!query.includes("parent.channel = m.channel") || candidate.channel === message.channel)
              && (!query.includes("parent.session_id = m.session_id") || candidate.session_id === message.session_id)
            )?.uuid ?? null,
          session_id: message.session_id,
          from_agent: message.from_agent,
          to_agent: message.to_agent,
          content: message.content,
          priority: message.priority,
          created_at: message.created_at,
        }));
    }
    if (query.startsWith("INSERT INTO channel_members")) {
      this.state.members.add(`${String(params[0])}:${String(params[1])}`);
      return [];
    }
    if (query.startsWith("SELECT agent FROM channel_members")) {
      const channel = String(params[0]);
      return [...this.state.members]
        .filter((entry) => entry.startsWith(`${channel}:`))
        .map((entry) => ({ agent: entry.slice(channel.length + 1) }))
        .sort((left, right) => left.agent.localeCompare(right.agent));
    }
    if (query.startsWith("DELETE FROM channel_members")) {
      this.state.members.delete(`${String(params[0])}:${String(params[1])}`);
      return [];
    }
    if (query.startsWith("DELETE FROM channels")) {
      const targetId = String(params[0]);
      const channel = String(params[1]);
      const current = this.state.channels.get(channel);
      if (!current || current.id !== targetId) return [];
      this.state.channels.delete(channel);
      return [{ id: targetId }];
    }
    if (query.startsWith("SELECT 1 AS present FROM")) {
      const channel = String(params[0]);
      return this.state.references.has(channel) ? [{ present: 1 }] : [];
    }
    throw new Error(`FakeProjectRegistrationClient does not implement SQL: ${query}`);
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const rows = this.rows(sql, params) as T[];
    return { rows, rowCount: rows.length };
  }

  async many<T extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    return this.rows(sql, params) as T[];
  }

  async get<T extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    return (this.rows(sql, params)[0] as T | undefined) ?? null;
  }

  async one<T extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T> {
    const rows = this.rows(sql, params);
    if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}.`);
    return rows[0] as T;
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    this.rows(sql, params);
  }

  async transaction<T>(fn: (client: TypedQueryClient) => Promise<T>): Promise<T> {
    const snapshot: FakeState = {
      corpusId: this.state.corpusId,
      channels: new Map(
        [...this.state.channels].map(([key, row]) => [key, { ...row }]),
      ),
      messages: this.state.messages.map((row) => ({ ...row })),
      receipts: new Map(
        [...this.state.receipts].map(([key, row]) => [
          key,
          {
            ...row,
            prior_state: row.prior_state === null
              ? null
              : JSON.parse(JSON.stringify(row.prior_state)) as Record<string, unknown>,
          },
        ]),
      ),
      members: new Set(this.state.members),
      references: new Set(this.state.references),
      advisoryLockKeys: [...this.state.advisoryLockKeys],
    };
    try {
      return await fn(this);
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  async close(): Promise<void> {}
}

const targetHandle = {
  digest: "pg-target-digest",
  withOwnedPath<T>(consumer: (path: string) => T): T {
    return consumer("/test/project");
  },
};

async function forwardRequest(
  client: FakeProjectRegistrationClient,
  overrides: Partial<ProjectChannelRegistrationRequest> = {},
): Promise<ProjectChannelRegistrationRequest> {
  const cap = await projectChannelRegistrationPgCapability(client);
  const projectSlug = String(overrides.project_slug ?? "fleet-resources");
  const desired = overrides.desired ?? {
    channel: projectSlug,
    project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
    project_slug: projectSlug,
    project_kind: "work",
  };
  return {
    operation_intent: "create",
    operation_id: "pg-operation",
    step_id: "conversations-channel",
    resource_kind: "channel",
    direction: "forward",
    authority_route: cap.route,
    package_version: cap.package_version,
    authority_id: cap.authority_id,
    tenant_id: cap.tenant_id,
    corpus_id: cap.corpus_id,
    target_selector: projectSlug,
    idempotency_key: "pg-operation:conversations-channel:forward",
    request_digest: projectChannelRegistrationDigest(desired),
    precondition_digest: projectChannelRegistrationDigest({
      target_selector: projectSlug,
      expected: "absent",
    }),
    project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
    project_slug: projectSlug,
    project_name: "Fleet Resources",
    desired,
    target: targetHandle,
    response_byte_limit: 32_768,
    time_budget_ms: 5_000,
    call_limit: 1,
    ...overrides,
  };
}

function inverseRequest(
  accepted: Awaited<ReturnType<typeof registerProjectChannelPg>>,
): ProjectChannelRegistrationRequest {
  const desired = {
    accepted_receipt_id: accepted.receipt_id,
    target_id: accepted.target_id,
  };
  return {
    operation_intent: accepted.prior_state ? "bind_existing" : "create",
    operation_id: accepted.operation_id,
    step_id: accepted.step_id,
    resource_kind: "channel",
    direction: "inverse",
    authority_route: accepted.route,
    package_version: accepted.package_version,
    authority_id: accepted.authority_id,
    tenant_id: accepted.tenant_id,
    corpus_id: accepted.corpus_id,
    target_selector: accepted.target_id!,
    idempotency_key: `${accepted.operation_id}:${accepted.step_id}:inverse`,
    request_digest: projectChannelRegistrationDigest(desired),
    precondition_digest: projectChannelRegistrationDigest({
      target_id: accepted.target_id,
      expected_revision: accepted.result_revision,
      expected_digest: accepted.result_digest,
    }),
    project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
    project_slug: "fleet-resources",
    project_name: "Fleet Resources",
    desired,
    target: targetHandle,
    accepted_receipt: accepted,
    response_byte_limit: 32_768,
    time_budget_ms: 5_000,
    call_limit: 1,
  };
}

async function bindExistingRequest(
  client: FakeProjectRegistrationClient,
  channel: ChannelRow,
  projectId: string,
  operationId: string,
): Promise<ProjectChannelRegistrationRequest> {
  const beforeRecord = projectChannelRegistrationChannelRecord(channel as never);
  const desired = {
    channel: channel.name,
    project_id: projectId,
    project_slug: channel.name,
    project_kind: "work",
    registration_mode: "bind_existing",
    target_id: channel.id,
    expected_project_id: channel.project_id,
  };
  return forwardRequest(client, {
    operation_intent: "bind_existing",
    operation_id: operationId,
    step_id: "conversations-channel",
    idempotency_key: `${operationId}:forward`,
    project_slug: channel.name,
    target_selector: channel.name,
    desired,
    request_digest: projectChannelRegistrationDigest(desired),
    precondition_digest: projectChannelRegistrationDigest({
      target_id: channel.id,
      target_selector: channel.name,
      expected_project_id: channel.project_id,
      expected_revision: beforeRecord.revision,
      expected_digest: beforeRecord.digest,
      desired_project_id: projectId,
    }),
    bind_existing: {
      target_id: channel.id,
      expected_project_id: channel.project_id,
      expected_revision: beforeRecord.revision,
      expected_digest: beforeRecord.digest,
    },
  });
}

let server: ReturnType<typeof startApiServer> | null = null;

afterEach(() => {
  server?.stop();
  server = null;
});

describe("PostgreSQL project channel registration authority", () => {
  test("pages project channels and inherited messages with stable exclusive cursors", async () => {
    const client = new FakeProjectRegistrationClient();
    const projectId = "wks_ys8tzpsZJMNtx0ORZtLsA";
    const channelIds = [
      "chn_00000000000000000000000000000001",
      "chn_00000000000000000000000000000002",
      "chn_00000000000000000000000000000003",
    ];
    channelIds.forEach((id, index) => {
      client.state.channels.set(`project-${index + 1}`, {
        id,
        name: `project-${index + 1}`,
        description: null,
        topic: null,
        project_id: projectId,
        created_by: "project-registration",
        created_at: `2026-08-08T09:00:0${index}.000Z`,
        archived_at: null,
        metadata: null,
        tags: null,
      });
    });
    client.state.channels.set("unbound", {
      id: "chn_ffffffffffffffffffffffffffffffff",
      name: "unbound",
      description: null,
      topic: null,
      project_id: null,
      created_by: "tester",
      created_at: "2026-08-08T09:00:10.000Z",
      archived_at: null,
      metadata: null,
      tags: null,
    });

    const firstChannels = await listProjectChannelRegistrationPagePg(client, {
      project_id: projectId,
      max_items: 2,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    const secondChannels = await listProjectChannelRegistrationPagePg(client, {
      project_id: projectId,
      cursor: firstChannels.next_cursor!,
      collection_revision: firstChannels.collection_revision,
      max_items: 2,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    expect([
      ...firstChannels.items,
      ...secondChannels.items,
    ].map((item) => item.target_id)).toEqual(channelIds);
    expect(firstChannels.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(firstChannels), "utf8"),
    );
    expect(secondChannels.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(secondChannels), "utf8"),
    );
    expect(firstChannels.collection_revision).toMatch(/^[0-9a-f]{64}$/);
    expect(firstChannels).toMatchObject({
      has_more: true,
      complete: false,
      truncated: true,
    });
    expect(secondChannels).toMatchObject({
      collection_revision: firstChannels.collection_revision,
      has_more: false,
      complete: true,
      truncated: false,
    });
    await expect(listProjectChannelRegistrationPagePg(client, {
      project_id: projectId,
      cursor: firstChannels.next_cursor!,
      max_items: 2,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    })).rejects.toThrow(/collection_revision is required when cursor is set/);

    client.state.messages.push(
      {
        id: 41,
        uuid: "msg-parent",
        session_id: "session-1",
        from_agent: "alice",
        to_agent: "project-1",
        channel: "project-1",
        project_id: projectId,
        content: "parent",
        priority: "normal",
        reply_to: null,
        created_at: "2026-08-08T09:01:00.000Z",
      },
      {
        id: 42,
        uuid: "msg-reply",
        session_id: "session-1",
        from_agent: "bob",
        to_agent: "project-1",
        channel: "project-1",
        project_id: projectId,
        content: "reply",
        priority: "normal",
        reply_to: 41,
        created_at: "2026-08-08T09:02:00.000Z",
      },
    );
    const firstMessages = await listProjectChannelMessagePagePg(client, {
      project_id: projectId,
      target_id: channelIds[0],
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    const secondMessages = await listProjectChannelMessagePagePg(client, {
      project_id: projectId,
      target_id: channelIds[0],
      cursor: firstMessages.next_cursor!,
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    expect(firstMessages.items[0]).toMatchObject({
      target_id: "msg-parent",
      reply_to_target_id: null,
    });
    expect(secondMessages.items[0]).toMatchObject({
      target_id: "msg-reply",
      reply_to_target_id: "msg-parent",
    });
    expect(firstMessages.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(firstMessages), "utf8"),
    );
    expect(secondMessages.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(secondMessages), "utf8"),
    );

    client.state.messages.push({
      id: 43,
      uuid: "msg-later",
      session_id: "session-1",
      from_agent: "carol",
      to_agent: "project-1",
      channel: "project-1",
      project_id: projectId,
      content: "later",
      priority: "normal",
      reply_to: null,
      created_at: "2026-08-08T09:03:00.000Z",
    });
    const laterMessages = await listProjectChannelMessagePagePg(client, {
      project_id: projectId,
      target_id: channelIds[0],
      cursor: 42,
      max_items: 2,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    expect(laterMessages.items.map((item) => item.target_id)).toEqual(["msg-later"]);
  });

  test("fails closed when a lower stable channel id joins the project between pages", async () => {
    const client = new FakeProjectRegistrationClient();
    const projectId = "wks_ys8tzpsZJMNtx0ORZtLsA";
    const put = (id: string, name: string) => client.state.channels.set(name, {
      id,
      name,
      description: null,
      topic: null,
      project_id: projectId,
      created_by: "tester",
      created_at: "2026-08-11T18:00:00.000Z",
      archived_at: null,
      metadata: null,
      tags: null,
    });
    put("chn_20000000000000000000000000000000", "collection-middle");
    put("chn_30000000000000000000000000000000", "collection-last");

    const firstPage = await listProjectChannelRegistrationPagePg(client, {
      project_id: projectId,
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    expect(firstPage.items.map((item) => item.target_id)).toEqual([
      "chn_20000000000000000000000000000000",
    ]);

    put("chn_10000000000000000000000000000000", "collection-first-late");

    await expect(listProjectChannelRegistrationPagePg(client, {
      project_id: projectId,
      cursor: firstPage.next_cursor!,
      collection_revision: firstPage.collection_revision,
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    })).rejects.toThrow(/collection changed/i);
  });

  test("does not expose reply targets from another channel or session", async () => {
    const client = new FakeProjectRegistrationClient();
    const projectId = "wks_ys8tzpsZJMNtx0ORZtLsA";
    const rightId = "chn_00000000000000000000000000000072";
    client.state.channels.set("left", {
      id: "chn_00000000000000000000000000000071",
      name: "left",
      description: null,
      topic: null,
      project_id: projectId,
      created_by: "tester",
      created_at: "2026-08-08T09:00:00.000Z",
      archived_at: null,
      metadata: null,
      tags: null,
    });
    client.state.channels.set("right", {
      id: rightId,
      name: "right",
      description: null,
      topic: null,
      project_id: projectId,
      created_by: "tester",
      created_at: "2026-08-08T09:00:00.000Z",
      archived_at: null,
      metadata: null,
      tags: null,
    });
    client.state.messages.push(
      {
        id: 71,
        uuid: "msg-left-parent",
        session_id: "channel:left",
        from_agent: "alice",
        to_agent: "left",
        channel: "left",
        project_id: projectId,
        content: "left parent",
        priority: "normal",
        reply_to: null,
        created_at: "2026-08-08T09:01:00.000Z",
      },
      {
        id: 72,
        uuid: "msg-right-parent",
        session_id: "channel:right",
        from_agent: "alice",
        to_agent: "right",
        channel: "right",
        project_id: projectId,
        content: "right parent",
        priority: "normal",
        reply_to: null,
        created_at: "2026-08-08T09:02:00.000Z",
      },
      {
        id: 73,
        uuid: "msg-cross-channel-child",
        session_id: "channel:left",
        from_agent: "bob",
        to_agent: "right",
        channel: "right",
        project_id: projectId,
        content: "cross-channel child",
        priority: "normal",
        reply_to: 71,
        created_at: "2026-08-08T09:03:00.000Z",
      },
      {
        id: 74,
        uuid: "msg-cross-session-child",
        session_id: "channel:other",
        from_agent: "carol",
        to_agent: "right",
        channel: "right",
        project_id: projectId,
        content: "cross-session child",
        priority: "normal",
        reply_to: 72,
        created_at: "2026-08-08T09:04:00.000Z",
      },
    );

    const page = await listProjectChannelMessagePagePg(client, {
      project_id: projectId,
      target_id: rightId,
      max_items: 10,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });

    expect(page.items.find((item) => item.target_id === "msg-cross-channel-child")?.reply_to_target_id)
      .toBeNull();
    expect(page.items.find((item) => item.target_id === "msg-cross-session-child")?.reply_to_target_id)
      .toBeNull();
  });

  test("locks the stable step identity before the selector for changed requests", async () => {
    const client = new FakeProjectRegistrationClient();
    const firstRequest = await forwardRequest(client);
    const accepted = await registerProjectChannelPg(client, firstRequest);
    const firstLocks = [...client.state.advisoryLockKeys];

    const changedSlug = "fleet-operations";
    const changedDesired = {
      ...firstRequest.desired,
      channel: changedSlug,
      project_slug: changedSlug,
    };
    client.state.advisoryLockKeys = [];
    const changed = await registerProjectChannelPg(client, await forwardRequest(client, {
      project_slug: changedSlug,
      desired: changedDesired,
      request_digest: projectChannelRegistrationDigest(changedDesired),
      precondition_digest: projectChannelRegistrationDigest({
        target_selector: changedSlug,
        expected: "absent",
      }),
    }));
    const changedLocks = [...client.state.advisoryLockKeys];

    expect(accepted.outcome).toBe("accepted");
    expect(changed).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "changed_request_or_precondition_for_step",
    });
    expect(firstLocks).toHaveLength(2);
    expect(changedLocks).toHaveLength(2);
    expect(firstLocks[0]).toBe(changedLocks[0]);
    expect(firstLocks[1]).not.toBe(changedLocks[1]);
  });

  test("matches SQLite accepted/duplicate/readback/lookup/inverse behavior", async () => {
    const client = new FakeProjectRegistrationClient();
    const request = await forwardRequest(client);
    const accepted = await registerProjectChannelPg(client, request);
    const lookupRequest = {
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: "channel" as const,
      direction: "forward" as const,
      authority: "conversations" as const,
      authority_route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      request_digest: request.request_digest,
      precondition_digest: request.precondition_digest,
      target_id: accepted.target_id!,
      max_items: 1 as const,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1 as const,
    };
    const acceptedLookup = await lookupProjectChannelRegistrationReceiptPg(client, lookupRequest);
    expect(acceptedLookup.receipt.receipt_id).toBe(accepted.receipt_id);

    const duplicate = await registerProjectChannelPg(client, request);

    expect(accepted.target_id).toMatch(/^chn_[0-9a-f]{32}$/);
    expect(duplicate).toMatchObject({
      outcome: "duplicate_of_accepted",
      duplicate_of_receipt_id: accepted.receipt_id,
      target_id: accepted.target_id,
    });
    expect((await readProjectChannelRegistrationExactPg(client, {
      resource_kind: "channel",
      target_id: accepted.target_id!,
      target_selector: "fleet-resources",
      target: targetHandle,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    })).digest).toBe(accepted.result_digest!);
    const lookup = await lookupProjectChannelRegistrationReceiptPg(client, lookupRequest);
    expect(lookup.receipt.receipt_id).toBe(duplicate.receipt_id);
    expect(lookup.response_control).toMatchObject({
      calls_used: 1,
      max_items: 1,
      items_returned: 1,
      complete: true,
      truncated: false,
    });

    const changedDesired = { ...request.desired, project_name: "Changed" };
    const changed = await registerProjectChannelPg(client, {
      ...request,
      desired: changedDesired,
      request_digest: projectChannelRegistrationDigest(changedDesired),
    });
    expect(changed.reason).toBe("changed_request_or_precondition_for_step");
    expect((await lookupProjectChannelRegistrationReceiptPg(client, lookupRequest)).receipt.receipt_id)
      .toBe(duplicate.receipt_id);
    await expect(lookupProjectChannelRegistrationReceiptPg(client, {
      ...lookupRequest,
      target_selector: "wrong-selector",
    })).rejects.toThrow("does not bind target_selector");

    const inverse = inverseRequest(accepted);
    const removed = await compensateProjectChannelRegistrationPg(client, inverse);
    expect(removed).toMatchObject({
      outcome: "accepted",
      direction: "inverse",
      accepted_receipt_id: accepted.receipt_id,
    });
    expect(await verifyProjectChannelRegistrationInversePg(client, inverse)).toMatchObject({
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
      absent: true,
    });
  });

  test("matches SQLite guarded bind-existing and ownership restoration", async () => {
    const client = new FakeProjectRegistrationClient();
    const projectId = "wks_ys8tzpsZJMNtx0ORZtLsA";
    const legacyProjectId = "1217f372-08e4-4217-aaf0-1ace5232982f";
    const channel: ChannelRow = {
      id: "chn_383ef12f615eb9afeaf0017e3424f1d3",
      name: "dubai-fraud",
      description: "Existing description",
      topic: "Existing topic",
      project_id: legacyProjectId,
      created_by: "human",
      created_at: "2026-08-01T09:00:00.000Z",
      archived_at: null,
      metadata: JSON.stringify({ source: "legacy", retained: true }),
      tags: JSON.stringify(["fraud", "dubai"]),
    };
    client.state.channels.set(channel.name, channel);
    client.state.members.add(`${channel.name}:human`);
    client.state.members.add(`${channel.name}:second-member`);
    client.state.messages.push({
      id: 229,
      uuid: "msg-existing-history",
      session_id: "channel:dubai-fraud",
      from_agent: "human",
      to_agent: channel.name,
      channel: channel.name,
      project_id: legacyProjectId,
      content: "existing history",
      priority: "normal",
      reply_to: null,
      created_at: "2026-08-01T09:01:00.000Z",
    });
    const beforeRecord = projectChannelRegistrationChannelRecord(channel as never);
    const desired = {
      channel: channel.name,
      project_id: projectId,
      project_slug: channel.name,
      project_kind: "work",
      registration_mode: "bind_existing",
      target_id: channel.id,
      expected_project_id: legacyProjectId,
    };
    const request = await forwardRequest(client, {
      operation_intent: "bind_existing",
      operation_id: "pg-bind-existing",
      idempotency_key: "pg-bind-existing:forward",
      project_slug: channel.name,
      target_selector: channel.name,
      desired,
      request_digest: projectChannelRegistrationDigest(desired),
      precondition_digest: projectChannelRegistrationDigest({
        target_id: channel.id,
        target_selector: channel.name,
        expected_project_id: legacyProjectId,
        expected_revision: beforeRecord.revision,
        expected_digest: beforeRecord.digest,
        desired_project_id: projectId,
      }),
      bind_existing: {
        target_id: channel.id,
        expected_project_id: legacyProjectId,
        expected_revision: beforeRecord.revision,
        expected_digest: beforeRecord.digest,
      },
    });

    await expect(registerProjectChannelPg(client, request, {
      faultInjector(point) {
        if (point === "after_message_bind") throw new Error("injected pg bind failure");
      },
    })).rejects.toThrow("injected pg bind failure");
    expect(client.state.channels.get(channel.name)).toEqual(channel);
    expect(client.state.receipts.size).toBe(0);

    const accepted = await registerProjectChannelPg(client, request);
    expect(accepted).toMatchObject({
      outcome: "accepted",
      target_id: channel.id,
      created_by_operation: false,
      prior_state: {
        target_id: channel.id,
        project_id: legacyProjectId,
        bound_project_id: projectId,
        revision: beforeRecord.revision,
        digest: beforeRecord.digest,
        message_transition: {
          source_project_id: legacyProjectId,
          target_project_id: projectId,
          message_count: 1,
        },
      },
    });
    if (!accepted.prior_state || "adoption" in accepted.prior_state) throw new Error("expected bind prior state");
    const transition = accepted.prior_state.message_transition;
    expect(transition.first_message_id).toBe(229);
    expect(transition.last_message_id).toBe(229);
    expect(transition.message_ids_digest).toBeString();
    expect(transition.before_digest).toBeString();
    expect(transition.after_digest).toBeString();
    expect(transition.preserved_digest).toBeString();
    expect(client.state.channels.get(channel.name)).toEqual({
      ...channel,
      project_id: projectId,
    });
    expect(client.state.members).toEqual(new Set([
      `${channel.name}:human`,
      `${channel.name}:second-member`,
    ]));
    expect(client.state.messages).toEqual([
      {
        id: 229,
        uuid: "msg-existing-history",
        session_id: "channel:dubai-fraud",
        from_agent: "human",
        to_agent: channel.name,
        channel: channel.name,
        project_id: projectId,
        content: "existing history",
        priority: "normal",
        reply_to: null,
        created_at: "2026-08-01T09:01:00.000Z",
      },
    ]);
    expect((await listProjectChannelMessagePagePg(client, {
      project_id: projectId,
      target_id: channel.id,
      max_items: 10,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    })).items).toEqual([
      expect.objectContaining({
        target_id: "msg-existing-history",
        project_id: projectId,
      }),
    ]);
    expect((await listProjectChannelRegistrationPagePg(client, {
      project_id: projectId,
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    }))).toMatchObject({
      item_count: 1,
      complete: true,
      truncated: false,
      items: [expect.objectContaining({ target_id: channel.id })],
    });

    const duplicate = await registerProjectChannelPg(client, request);
    expect(duplicate).toMatchObject({
      outcome: "duplicate_of_accepted",
      duplicate_of_receipt_id: accepted.receipt_id,
      prior_state: accepted.prior_state,
    });

    const inverse = inverseRequest(accepted);
    await expect(compensateProjectChannelRegistrationPg(client, inverse, {
      faultInjector(point) {
        if (point === "after_message_restore") throw new Error("injected pg restore failure");
      },
    })).rejects.toThrow("injected pg restore failure");
    expect(client.state.channels.get(channel.name)).toEqual({
      ...channel,
      project_id: projectId,
    });
    expect(client.state.messages[0].project_id).toBe(projectId);
    expect(client.state.receipts.size).toBe(2);

    const restored = await compensateProjectChannelRegistrationPg(client, inverse);
    expect(restored).toMatchObject({
      outcome: "accepted",
      target_id: channel.id,
      created_by_operation: false,
      result_revision: beforeRecord.revision,
      result_digest: beforeRecord.digest,
      prior_state: accepted.prior_state,
    });
    expect(client.state.channels.get(channel.name)).toEqual(channel);
    expect(client.state.messages[0].project_id).toBe(legacyProjectId);
    expect(await verifyProjectChannelRegistrationInversePg(client, inverse)).toEqual({
      target_id: channel.id,
      accepted_receipt_id: accepted.receipt_id,
      absent: false,
      restored: true,
      project_id: legacyProjectId,
      revision: beforeRecord.revision,
      digest: beforeRecord.digest,
    });
  });

  test("matches SQLite operation-intent, message-owner conflict, and inverse-drift refusal", async () => {
    const projectId = "wks_ys8tzpsZJMNtx0ORZtLsA";
    const legacyProjectId = "wks_legacy_project_00000001";
    const foreignProjectId = "wks_foreign_project_00000001";

    const createClient = new FakeProjectRegistrationClient();
    const ordinaryCreate = await forwardRequest(createClient, {
      operation_intent: undefined,
    });
    expect(await registerProjectChannelPg(createClient, ordinaryCreate)).toMatchObject({
      outcome: "accepted",
      created_by_operation: true,
    });
    await expect(registerProjectChannelPg(createClient, {
      ...ordinaryCreate,
      operation_intent: "bind_existing",
    })).rejects.toThrow("bind-existing surface requires bind-existing intent");

    const conflictClient = new FakeProjectRegistrationClient();
    const conflictChannel: ChannelRow = {
      id: "chn_11111111111111111111111111111112",
      name: "legacy-owner-conflict",
      description: null,
      topic: null,
      project_id: legacyProjectId,
      created_by: "human",
      created_at: "2026-08-01T10:00:00.000Z",
      archived_at: null,
      metadata: null,
      tags: null,
    };
    conflictClient.state.channels.set(conflictChannel.name, conflictChannel);
    conflictClient.state.messages.push({
      id: 310,
      uuid: "msg-owner-conflict",
      session_id: `channel:${conflictChannel.name}`,
      from_agent: "human",
      to_agent: conflictChannel.name,
      channel: conflictChannel.name,
      project_id: foreignProjectId,
      content: "conflicting history",
      priority: "normal",
      reply_to: null,
      created_at: "2026-08-01T10:01:00.000Z",
    });
    const conflictRequest = await bindExistingRequest(
      conflictClient,
      conflictChannel,
      projectId,
      "pg-bind-owner-conflict",
    );
    await expect(registerProjectChannelPg(conflictClient, {
      ...conflictRequest,
      operation_intent: "create",
    })).rejects.toThrow("create surface rejects bind-existing intent");
    expect(await registerProjectChannelPg(conflictClient, conflictRequest)).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "bind_message_owner_conflict",
      target_id: conflictChannel.id,
    });
    expect(conflictClient.state.channels.get(conflictChannel.name)).toEqual(conflictChannel);
    expect(conflictClient.state.messages[0].project_id).toBe(foreignProjectId);

    const driftClient = new FakeProjectRegistrationClient();
    const driftChannel: ChannelRow = {
      ...conflictChannel,
      id: "chn_11111111111111111111111111111113",
      name: "legacy-owner-drift",
    };
    driftClient.state.channels.set(driftChannel.name, driftChannel);
    driftClient.state.messages.push({
      ...conflictClient.state.messages[0],
      id: 311,
      uuid: "msg-owner-drift",
      session_id: `channel:${driftChannel.name}`,
      to_agent: driftChannel.name,
      channel: driftChannel.name,
      project_id: legacyProjectId,
      content: "stable history",
    });
    const driftRequest = await bindExistingRequest(
      driftClient,
      driftChannel,
      projectId,
      "pg-bind-owner-drift",
    );
    const accepted = await registerProjectChannelPg(driftClient, driftRequest);
    expect(accepted.outcome).toBe("accepted");
    driftClient.state.messages[0] = {
      ...driftClient.state.messages[0],
      content: "drifted after bind",
    };
    expect(await compensateProjectChannelRegistrationPg(
      driftClient,
      inverseRequest(accepted),
    )).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "message_ownership_drifted",
      target_id: driftChannel.id,
      accepted_receipt_id: accepted.receipt_id,
    });
    expect(driftClient.state.channels.get(driftChannel.name)?.project_id).toBe(projectId);
    expect(driftClient.state.messages[0]).toMatchObject({
      project_id: projectId,
      content: "drifted after bind",
    });
  });

  test("finds an exact historical PostgreSQL receipt after the advertised corpus identity changes", async () => {
    const client = new FakeProjectRegistrationClient();
    const request = await forwardRequest(client);
    const accepted = await registerProjectChannelPg(client, request);
    const lookupRequest = {
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: "channel" as const,
      direction: "forward" as const,
      authority: "conversations" as const,
      authority_route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      request_digest: request.request_digest,
      precondition_digest: request.precondition_digest,
      target_id: accepted.target_id!,
      max_items: 1 as const,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1 as const,
    };

    client.state.corpusId = "cor_22222222222222222222222222222222";
    expect((await projectChannelRegistrationPgCapability(client)).corpus_id)
      .toBe(client.state.corpusId);

    const historical = await lookupProjectChannelRegistrationReceiptPg(client, lookupRequest);
    expect(historical.receipt).toEqual(accepted);
    expect({
      authority: historical.receipt.authority,
      authority_route: historical.receipt.route,
      package_version: historical.receipt.package_version,
      authority_id: historical.receipt.authority_id,
      tenant_id: historical.receipt.tenant_id,
      corpus_id: historical.receipt.corpus_id,
    }).toEqual({
      authority: lookupRequest.authority,
      authority_route: lookupRequest.authority_route,
      package_version: lookupRequest.package_version,
      authority_id: lookupRequest.authority_id,
      tenant_id: lookupRequest.tenant_id,
      corpus_id: lookupRequest.corpus_id,
    });
    expect(historical.response_control).toMatchObject({
      call_limit: 1,
      calls_used: 1,
      max_items: 1,
      items_returned: 1,
      complete: true,
      truncated: false,
    });
    expect(historical.response_control.response_bytes).toBeGreaterThan(0);
    expect(historical.response_control.response_bytes).toBeLessThanOrEqual(32_768);
    expect(historical.response_control.elapsed_ms).toBeLessThanOrEqual(5_000);
    await expect(lookupProjectChannelRegistrationReceiptPg(client, {
      ...lookupRequest,
      tenant_id: "other-tenant",
    })).rejects.toThrow("authority identity mismatch");
    await expect(lookupProjectChannelRegistrationReceiptPg(client, {
      ...lookupRequest,
      corpus_id: client.state.corpusId,
    })).rejects.toThrow("terminal receipt not found");
    await expect(lookupProjectChannelRegistrationReceiptPg(client, {
      ...lookupRequest,
      target_id: "chn_33333333333333333333333333333333",
    })).rejects.toThrow("terminal receipt not found");
  });

  test("validates the inverse envelope before PostgreSQL persistence", async () => {
    const client = new FakeProjectRegistrationClient();
    const forward = await forwardRequest(client);

    await expect(compensateProjectChannelRegistrationPg(client, {
      ...forward,
      accepted_receipt: undefined,
    })).rejects.toThrow("direction must be inverse");
    expect(client.state.receipts.size).toBe(0);
  });

  test("rolls back an injected PostgreSQL failure and preserves no partial evidence", async () => {
    const client = new FakeProjectRegistrationClient();
    const request = await forwardRequest(client);
    await expect(registerProjectChannelPg(client, request, {
      faultInjector(point) {
        if (point === "after_channel_insert") throw new Error("injected pg failure");
      },
    })).rejects.toThrow("injected pg failure");
    expect(client.state.channels.size).toBe(0);
    expect(client.state.receipts.size).toBe(0);
    expect(client.state.members.size).toBe(0);
  });

  test("serves the authority only through authenticated /v1 and ApiStore stays remote", async () => {
    const client = new FakeProjectRegistrationClient();
    const verifier = {
      async authenticate(headers: Headers) {
        if (headers.get("x-api-key") !== "test-key") {
          return {
            ok: false,
            status: 401,
            reason: "missing",
            message: "API key required",
          };
        }
        return {
          ok: true,
          principal: {
            agent: "projects-adapter",
            scopes: ["conversations:read", "conversations:write"],
          },
        };
      },
    };
    server = startApiServer({
      host: "127.0.0.1",
      port: 0,
      deps: {
        client,
        keys: {} as ApiServerDeps["keys"],
        verifier: verifier as unknown as ApiServerDeps["verifier"],
      },
    });
    const origin = `http://127.0.0.1:${server.port}`;
    const unauthorizedTransport = createHasnaHttpTransport({
      name: "conversations",
      baseUrl: `${origin}/v1`,
      apiKey: "wrong",
      retry: false,
    });
    try {
      await unauthorizedTransport.get("project-registration/channels/capability");
      throw new Error("expected capability request to require authentication");
    } catch (error) {
      expect(error).toBeInstanceOf(HasnaHttpError);
      expect((error as HasnaHttpError).status).toBe(401);
    }

    const transport = createHasnaHttpTransport({
      name: "conversations",
      baseUrl: `${origin}/v1`,
      apiKey: "test-key",
      retry: false,
    });
    const apiStore = new ApiStore(createHasnaStorageClient("conversations", transport));
    const authority = createProjectChannelRegistrationAuthority(apiStore);
    const cap = await authority.capability();
    expect(cap.corpus_id).toBe(client.state.corpusId);
    const existingChannel: ChannelRow = {
      id: "chn_44444444444444444444444444444444",
      name: "api-existing",
      description: "preserved",
      topic: "preserved",
      project_id: "legacy-api-project",
      created_by: "human",
      created_at: "2026-08-08T09:00:00.000Z",
      archived_at: null,
      metadata: JSON.stringify({ preserved: true }),
      tags: JSON.stringify(["preserved"]),
    };
    client.state.channels.set(existingChannel.name, existingChannel);
    const existingRecord = projectChannelRegistrationChannelRecord(existingChannel as never);
    const bindDesired = {
      channel: existingChannel.name,
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      project_slug: existingChannel.name,
      project_kind: "work",
      registration_mode: "bind_existing",
      target_id: existingChannel.id,
      expected_project_id: existingChannel.project_id,
    };
    const bindBody = {
      operation_intent: "bind_existing",
      operation_id: "api-bind-existing",
      step_id: "conversations-channel",
      resource_kind: "channel",
      direction: "forward",
      authority_route: cap.route,
      package_version: cap.package_version,
      authority_id: cap.authority_id,
      tenant_id: cap.tenant_id,
      corpus_id: cap.corpus_id,
      target_selector: existingChannel.name,
      idempotency_key: "api-bind-existing:forward",
      request_digest: projectChannelRegistrationDigest(bindDesired),
      precondition_digest: projectChannelRegistrationDigest({
        target_id: existingChannel.id,
        target_selector: existingChannel.name,
        expected_project_id: existingChannel.project_id,
        expected_revision: existingRecord.revision,
        expected_digest: existingRecord.digest,
        desired_project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      }),
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      project_slug: existingChannel.name,
      project_name: "API Existing",
      desired: bindDesired,
      bind_existing: {
        target_id: existingChannel.id,
        expected_project_id: existingChannel.project_id,
        expected_revision: existingRecord.revision,
        expected_digest: existingRecord.digest,
      },
      target_digest: "api-target-digest",
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    };
    const bound = await transport.post<Record<string, unknown>>(
      "project-registration/channels/bind-existing",
      bindBody,
    );
    expect(bound).toMatchObject({
      outcome: "accepted",
      target_id: existingChannel.id,
      created_by_operation: false,
      prior_state: {
        project_id: "legacy-api-project",
        bound_project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      },
    });
    expect(client.state.channels.get(existingChannel.name)).toEqual({
      ...existingChannel,
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
    });
    expect(await transport.post<Record<string, unknown>>(
      "project-registration/channels/bind-existing",
      bindBody,
    )).toMatchObject({
      outcome: "duplicate_of_accepted",
      duplicate_of_receipt_id: bound.receipt_id,
    });
    const adoptedChannel = client.state.channels.get(existingChannel.name)!;
    const adoptedRecord = projectChannelRegistrationChannelRecord(adoptedChannel as never);
    const emptyMessageDigest = projectChannelRegistrationDigest([]);
    const adoptionOwnership = {
      message_count: 0,
      first_message_id: null,
      last_message_id: null,
      message_ids_digest: emptyMessageDigest,
      message_project_digest: emptyMessageDigest,
      digest: emptyMessageDigest,
      preserved_digest: emptyMessageDigest,
    };
    const adoptDesired = {
      channel: existingChannel.name,
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      project_slug: existingChannel.name,
      project_kind: "work",
      registration_mode: "adopt_existing",
      target_id: existingChannel.id,
      expected_project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      expected_revision: adoptedRecord.revision,
      expected_digest: adoptedRecord.digest,
      expected_message_ownership: adoptionOwnership,
    };
    const adoptBody = {
      ...bindBody,
      operation_intent: "adopt_existing",
      operation_id: "api-adopt-existing",
      idempotency_key: "api-adopt-existing:forward",
      request_digest: projectChannelRegistrationDigest(adoptDesired),
      precondition_digest: projectChannelRegistrationDigest({
        target_id: existingChannel.id,
        target_selector: existingChannel.name,
        expected_project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
        expected_revision: adoptedRecord.revision,
        expected_digest: adoptedRecord.digest,
        expected_message_ownership: adoptionOwnership,
        desired_project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      }),
      desired: adoptDesired,
      bind_existing: undefined,
      adopt_existing: {
        target_id: existingChannel.id,
        expected_project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
        expected_revision: adoptedRecord.revision,
        expected_digest: adoptedRecord.digest,
        expected_message_ownership: adoptionOwnership,
      },
    };
    const adopted = await transport.post<Record<string, unknown>>(
      "project-registration/channels/adopt-existing",
      adoptBody,
    );
    expect(adopted).toMatchObject({
      outcome: "accepted",
      reason: "adopted_preexisting",
      target_id: existingChannel.id,
      created_by_operation: false,
      prior_state: { adoption: true },
    });
    expect(client.state.channels.get(existingChannel.name)).toEqual(adoptedChannel);
    expect(await transport.post<Record<string, unknown>>(
      "project-registration/channels/adopt-existing",
      adoptBody,
    )).toMatchObject({
      outcome: "duplicate_of_accepted",
      duplicate_of_receipt_id: adopted.receipt_id,
    });
    await expect(transport.post(
      "project-registration/channels",
      bindBody,
    )).rejects.toMatchObject({ status: 400 });
    const { operation_intent: _bindIntent, ...bindBodyWithoutIntent } = bindBody;
    await expect(transport.post(
      "project-registration/channels",
      bindBodyWithoutIntent,
    )).rejects.toMatchObject({ status: 400 });
    await expect(transport.post(
      "project-registration/channels/bind-existing",
      bindBodyWithoutIntent,
    )).rejects.toMatchObject({ status: 400 });
    const desired = {
      channel: "iapp-sms",
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      project_slug: "iapp-sms",
      project_kind: "repo",
    };
    const receipt = await authority.create({
      operation_id: "api-operation",
      step_id: "conversations-channel",
      resource_kind: "channel",
      direction: "forward",
      authority_route: cap.route,
      package_version: cap.package_version,
      authority_id: cap.authority_id,
      tenant_id: cap.tenant_id,
      corpus_id: cap.corpus_id,
      target_selector: "iapp-sms",
      idempotency_key: "api-operation:conversations-channel:forward",
      request_digest: projectChannelRegistrationDigest(desired),
      precondition_digest: projectChannelRegistrationDigest({
        target_selector: "iapp-sms",
        expected: "absent",
      }),
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      project_slug: "iapp-sms",
      project_name: "IApp SMS",
      desired,
      target: targetHandle,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    await expect(transport.post(
      "project-registration/channels/bind-existing",
      {
        ...bindBody,
        operation_intent: "create",
        operation_id: "api-wrong-bind-intent",
        idempotency_key: "api-wrong-bind-intent:forward",
      },
    )).rejects.toMatchObject({ status: 400 });
    expect(receipt).toMatchObject({
      outcome: "accepted",
      authority: "conversations",
    });
    expect(receipt.target_id).toMatch(/^chn_[0-9a-f]{32}$/);
    expect(client.state.channels.get("iapp-sms")?.id).toBe(receipt.target_id!);
    const channelPage = await apiStore.listProjectChannelRegistrationPage({
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      max_items: 10,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    expect(channelPage.items.map((item) => item.target_id).sort()).toEqual([
      receipt.target_id!,
      existingChannel.id,
    ].sort());
    const firstApiPage = await apiStore.listProjectChannelRegistrationPage({
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    client.state.channels.set("api-late-first", {
      id: "chn_00000000000000000000000000000000",
      name: "api-late-first",
      description: null,
      topic: null,
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      created_by: "tester",
      created_at: "2026-08-11T18:00:00.000Z",
      archived_at: null,
      metadata: null,
      tags: null,
    });
    await expect(apiStore.listProjectChannelRegistrationPage({
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      cursor: firstApiPage.next_cursor!,
      collection_revision: firstApiPage.collection_revision,
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    })).rejects.toMatchObject({ status: 409 });
    client.state.messages.push({
      id: 1,
      uuid: "msg-api-project-link",
      session_id: "session-api",
      from_agent: "projects-adapter",
      to_agent: "iapp-sms",
      channel: "iapp-sms",
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      content: "linked",
      priority: "normal",
      reply_to: null,
      created_at: "2026-08-08T09:05:00.000Z",
    });
    const messagePage = await apiStore.listProjectChannelMessagePage({
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      target_id: receipt.target_id!,
      max_items: 10,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    expect(messagePage.items).toEqual([
      expect.objectContaining({
        target_id: "msg-api-project-link",
        channel_id: receipt.target_id,
        project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      }),
    ]);
    client.state.corpusId = "cor_33333333333333333333333333333333";
    expect((await authority.capability()).corpus_id).toBe(client.state.corpusId);
    const lookupRequest = {
      operation_id: "api-operation",
      step_id: "conversations-channel",
      resource_kind: "channel",
      direction: "forward",
      authority: "conversations",
      authority_route: cap.route,
      package_version: cap.package_version,
      authority_id: cap.authority_id,
      tenant_id: cap.tenant_id,
      corpus_id: cap.corpus_id,
      target_selector: "iapp-sms",
      idempotency_key: "api-operation:conversations-channel:forward",
      request_digest: projectChannelRegistrationDigest(desired),
      precondition_digest: projectChannelRegistrationDigest({
        target_selector: "iapp-sms",
        expected: "absent",
      }),
      target_id: receipt.target_id!,
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    } as const;
    const lookup = await authority.lookupReceipt(lookupRequest);
    expect(lookup.receipt.receipt_id).toBe(receipt.receipt_id);
    // The server refuses a target_selector that does not bind the receipt. The
    // shared transport carries the refusal as a 400 HasnaHttpError whose
    // server-provided detail lives on `.body` (never stringified into the
    // message — @hasna/contracts 1.0.2).
    const wrong = await authority
      .lookupReceipt({ ...lookupRequest, target_selector: "wrong-selector" })
      .catch((e: unknown) => e);
    expect(wrong).toMatchObject({ name: "HasnaHttpError", status: 400 });
    const body = (wrong as { body?: { error?: string } }).body;
    expect(body?.error).toContain("does not bind target_selector");
  });
});
