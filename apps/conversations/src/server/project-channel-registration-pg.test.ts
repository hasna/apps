import { afterEach, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import type {
  PoolQueryClient,
  QueryResult,
  TypedQueryClient,
} from "../generated/storage-kit/query.js";
import { createHasnaStorageClient } from "../lib/contracts-client/storage.js";
import {
  createHasnaHttpTransport,
  HasnaHttpError,
} from "../lib/contracts-client/transport.js";
import { ApiStore } from "../lib/store/api-store.js";
import {
  createProjectChannelRegistrationAuthority,
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
        created_at: String(params[22]),
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
    const snapshot = structuredClone(this.state);
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
      max_items: 2,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    expect([
      ...firstChannels.items,
      ...secondChannels.items,
    ].map((item) => item.target_id)).toEqual(channelIds);
    expect(firstChannels).toMatchObject({
      has_more: true,
      complete: false,
      truncated: true,
    });
    expect(secondChannels).toMatchObject({
      has_more: false,
      complete: true,
      truncated: false,
    });
    expect(firstChannels.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(firstChannels), "utf8"),
    );
    expect(secondChannels.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(secondChannels), "utf8"),
    );

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
    expect(channelPage.items.map((item) => item.target_id)).toEqual([receipt.target_id!]);
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
    await expect(authority.lookupReceipt({
      ...lookupRequest,
      target_selector: "wrong-selector",
    })).rejects.toThrow("does not bind target_selector");
  });
});
