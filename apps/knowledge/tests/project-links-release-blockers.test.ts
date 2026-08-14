import { describe, expect, test } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import {
  KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
  createPostgresKnowledgeProjectLinksAuthority,
  digestKnowledgeProjectLinksValue,
  type KnowledgeProjectLinksAuthority,
  type KnowledgeProjectRegistrationCapability,
  type KnowledgeProjectRegistrationReceipt,
} from '../src/project-links';
import type {
  PoolQueryClient,
  QueryResult,
  TypedQueryClient,
} from '../src/generated/storage-kit/index.js';
import type { KnowledgeItem } from '../src/store';
import { createMigratedPglite, pgliteClient } from './fixtures/pglite-client';

const fixedNow = () => '2026-08-10T12:00:00.000Z';
const options = {
  packageVersion: '9.9.9',
  authorityId: 'knowledge-test',
  tenantId: 'tenant-test',
  corpusId: 'corpus-test',
  now: fixedNow,
};

function item(id: string, tags: string[] = []): KnowledgeItem {
  return {
    id,
    short_id: id.slice(0, 8),
    title: `Item ${id}`,
    content: `Body ${id}`,
    url: null,
    tags,
    metadata: {},
    archived: false,
    created_at: fixedNow(),
    updated_at: fixedNow(),
    version: 1,
  };
}

async function insertItem(db: PGlite, value: KnowledgeItem): Promise<void> {
  await db.query(
    `INSERT INTO knowledge_items (
       id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`,
    [
      value.id,
      value.short_id,
      value.title,
      value.content,
      value.url,
      JSON.stringify(value.tags),
      JSON.stringify(value.metadata),
      value.archived,
      value.created_at,
      value.updated_at,
    ],
  );
}

async function registrationRequest(
  authority: KnowledgeProjectLinksAuthority,
  input: {
    operationId?: string;
    stepId?: string;
    idempotencyKey?: string;
  } = {},
) {
  const capability = await authority.capability();
  return {
    operation_id: input.operationId ?? 'op-register-alpha',
    step_id: input.stepId ?? 'step-register-alpha',
    resource_kind: 'collection' as const,
    direction: 'forward' as const,
    authority_route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    target_selector: 'wks_project_alpha',
    idempotency_key: input.idempotencyKey ?? 'idem-register-alpha',
    request_digest: digestKnowledgeProjectLinksValue({
      action: 'register_collection',
      source_project_id: 'wks_project_alpha',
      project_slug: 'alpha',
      project_name: 'Alpha',
      collection_slug: 'alpha-knowledge',
      collection_name: 'Alpha Knowledge',
      membership_rule: 'explicit_collection_binding',
    }),
    precondition_digest: digestKnowledgeProjectLinksValue({
      source_project_id: 'wks_project_alpha',
      expected: 'absent_or_exact_match',
    }),
    project_id: 'wks_project_alpha',
    project_slug: 'alpha',
    project_name: 'Alpha',
    desired: {
      collection_slug: 'alpha-knowledge',
      collection_name: 'Alpha Knowledge',
    },
  };
}

async function bindingRequest(
  authority: KnowledgeProjectLinksAuthority,
  collectionId: string,
  itemId: string,
  input: {
    operationId?: string;
    stepId?: string;
    idempotencyKey?: string;
  } = {},
) {
  const capability = await authority.capability();
  return {
    operation_id: input.operationId ?? `op-bind-${itemId}`,
    step_id: input.stepId ?? `step-bind-${itemId}`,
    direction: 'forward' as const,
    authority_route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    idempotency_key: input.idempotencyKey ?? `idem-bind-${itemId}`,
    request_digest: digestKnowledgeProjectLinksValue({
      action: 'bind_item',
      collection_id: collectionId,
      item_id: itemId,
    }),
    precondition_digest: digestKnowledgeProjectLinksValue({
      collection_id: collectionId,
      item_id: itemId,
      expected: 'unbound_or_exact_membership',
    }),
    collection_id: collectionId,
    item_id: itemId,
  };
}

async function inverseRequest(
  capability: KnowledgeProjectRegistrationCapability,
  receipt: KnowledgeProjectRegistrationReceipt,
  suffix: string,
) {
  return {
    operation_id: `op-inverse-${suffix}`,
    step_id: `step-inverse-${suffix}`,
    authority_route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    idempotency_key: `idem-inverse-${suffix}`,
    accepted_receipt_id: receipt.receipt_id,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface RaceControl {
  target: 'collection' | 'membership';
  forwardRead: Deferred<void>;
  resumeForward: Deferred<void>;
  inverseBlocked: Deferred<void>;
  paused: boolean;
}

function raceControl(target: RaceControl['target']): RaceControl {
  return {
    target,
    forwardRead: deferred<void>(),
    resumeForward: deferred<void>(),
    inverseBlocked: deferred<void>(),
    paused: false,
  };
}

class AdvisoryTransactionLocks {
  private readonly locks = new Map<string, Array<() => void>>();

  async acquire(key: string, lane: 'forward' | 'inverse', control: RaceControl): Promise<() => void> {
    const waiters = this.locks.get(key);
    if (!waiters) {
      this.locks.set(key, []);
    } else {
      if (lane === 'inverse') control.inverseBlocked.resolve();
      await new Promise<void>((resolve) => waiters.push(resolve));
    }

    return () => {
      const current = this.locks.get(key);
      const next = current?.shift();
      if (next) next();
      else this.locks.delete(key);
    };
  }
}

function isForwardTargetRead(sql: string, target: RaceControl['target']): boolean {
  if (target === 'collection') {
    return sql.includes('FROM knowledge_projects p')
      && sql.includes('p.source_project_id =');
  }
  return sql.includes('FROM knowledge_project_collection_memberships')
    && sql.includes('SELECT *')
    && sql.includes('item_id =');
}

function interleavingClient(
  db: PGlite,
  lane: 'forward' | 'inverse',
  control: RaceControl,
  locks: AdvisoryTransactionLocks,
): PoolQueryClient {
  const transaction = async <T>(fn: (client: TypedQueryClient) => Promise<T>): Promise<T> => {
    const releases: Array<() => void> = [];

    const execute = async <T extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<QueryResult<T>> => {
      if (sql.includes('pg_advisory_xact_lock')) {
        const release = await locks.acquire(String(params[0]), lane, control);
        releases.push(release);
        return {
          rows: [{ pg_advisory_xact_lock: null } as T],
          rowCount: 1,
        };
      }

      const result = await db.query<T>(sql, params as unknown[]);
      const rows = result.rows;
      if (
        lane === 'forward'
        && !control.paused
        && rows.length > 0
        && isForwardTargetRead(sql, control.target)
      ) {
        control.paused = true;
        control.forwardRead.resolve();
        await control.resumeForward.promise;
      }
      return {
        rows,
        rowCount: result.affectedRows ?? rows.length,
      };
    };

    const typed: TypedQueryClient = {
      query: execute,
      async many<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
        return (await execute<T>(sql, params)).rows;
      },
      async get<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
        return (await execute<T>(sql, params)).rows[0] ?? null;
      },
      async one<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
        const rows = (await execute<T>(sql, params)).rows;
        if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
        return rows[0]!;
      },
      async execute(sql: string, params: readonly unknown[] = []) {
        await execute(sql, params);
      },
    };

    try {
      return await fn(typed);
    } finally {
      for (const release of releases.reverse()) release();
    }
  };

  const root = pgliteClient(db);
  return {
    ...root,
    transaction,
  };
}

interface PageMetrics {
  manyRows: number;
  maxManyRows: number;
}

function measuredClient(base: PoolQueryClient, metrics: PageMetrics): PoolQueryClient {
  const wrap = (client: TypedQueryClient): TypedQueryClient => ({
    query: client.query.bind(client),
    async many<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const rows = await client.many<T>(sql, params);
      metrics.manyRows += rows.length;
      metrics.maxManyRows = Math.max(metrics.maxManyRows, rows.length);
      return rows;
    },
    get: client.get.bind(client),
    one: client.one.bind(client),
    execute: client.execute.bind(client),
  });
  const root = wrap(base);
  return {
    ...root,
    get pool() {
      return base.pool;
    },
    async transaction<T>(fn: (client: TypedQueryClient) => Promise<T>) {
      return base.transaction((client) => fn(wrap(client)));
    },
    close: base.close.bind(base),
  };
}

async function startInverseWhileForwardPaused<T>(
  inverse: Promise<T>,
  control: RaceControl,
): Promise<T> {
  const first = await Promise.race([
    inverse.then(() => 'inverse-completed' as const),
    control.inverseBlocked.promise.then(() => 'inverse-blocked' as const),
  ]);
  control.resumeForward.resolve();
  if (first === 'inverse-completed') return inverse;
  return inverse;
}

describe('Knowledge project-links release blockers', () => {
  test('PostgreSQL serializes collection adoption against creator compensation', async () => {
    const { db, client } = await createMigratedPglite();
    const resolver = async () => null;
    const setup = createPostgresKnowledgeProjectLinksAuthority({ client, itemResolver: resolver, options });
    const ownerReceipt = await setup.registerCollection(await registrationRequest(setup));
    const capability = await setup.capability();
    const control = raceControl('collection');
    const locks = new AdvisoryTransactionLocks();
    const forward = createPostgresKnowledgeProjectLinksAuthority({
      client: interleavingClient(db, 'forward', control, locks),
      itemResolver: resolver,
      options,
    });
    const inverse = createPostgresKnowledgeProjectLinksAuthority({
      client: interleavingClient(db, 'inverse', control, locks),
      itemResolver: resolver,
      options,
    });

    const adoptionPromise = forward.registerCollection(await registrationRequest(forward, {
      operationId: 'op-adopt-collection-race',
      stepId: 'step-adopt-collection-race',
      idempotencyKey: 'idem-adopt-collection-race',
    }));
    await control.forwardRead.promise;
    const inversePromise = inverse.compensateRegistration(
      await inverseRequest(capability, ownerReceipt, 'collection-race'),
    );
    const inverseReceiptPromise = startInverseWhileForwardPaused(inversePromise, control);
    const [adoption, inverseReceipt] = await Promise.all([adoptionPromise, inverseReceiptPromise]);

    expect(adoption).toMatchObject({
      outcome: 'accepted',
      reason: 'adopted_existing_collection',
      created_by_operation: false,
    });
    expect(inverseReceipt).toMatchObject({
      outcome: 'terminal_nonacceptance',
      reason: 'collection_has_later_accepted_adopter',
    });
    expect(await setup.readCollection(ownerReceipt.collection_id!))
      .toMatchObject({ collection_id: ownerReceipt.collection_id });
    await setup.close();
    await db.close();
  });

  test('PostgreSQL serializes membership adoption against creator compensation', async () => {
    const { db, client } = await createMigratedPglite();
    const value = item('k_membership_race');
    await insertItem(db, value);
    const resolver = async (id: string) => id === value.id ? value : null;
    const setup = createPostgresKnowledgeProjectLinksAuthority({ client, itemResolver: resolver, options });
    const registration = await setup.registerCollection(await registrationRequest(setup));
    const ownerReceipt = await setup.bindItem(
      await bindingRequest(setup, registration.collection_id!, value.id),
    );
    const capability = await setup.capability();
    const control = raceControl('membership');
    const locks = new AdvisoryTransactionLocks();
    const forward = createPostgresKnowledgeProjectLinksAuthority({
      client: interleavingClient(db, 'forward', control, locks),
      itemResolver: resolver,
      options,
    });
    const inverse = createPostgresKnowledgeProjectLinksAuthority({
      client: interleavingClient(db, 'inverse', control, locks),
      itemResolver: resolver,
      options,
    });

    const adoptionPromise = forward.bindItem(
      await bindingRequest(forward, registration.collection_id!, value.id, {
        operationId: 'op-adopt-membership-race',
        stepId: 'step-adopt-membership-race',
        idempotencyKey: 'idem-adopt-membership-race',
      }),
    );
    await control.forwardRead.promise;
    const inversePromise = inverse.compensateItemBinding(
      await inverseRequest(capability, ownerReceipt, 'membership-race'),
    );
    const inverseReceiptPromise = startInverseWhileForwardPaused(inversePromise, control);
    const [adoption, inverseReceipt] = await Promise.all([adoptionPromise, inverseReceiptPromise]);

    expect(adoption).toMatchObject({
      outcome: 'accepted',
      reason: 'adopted_existing_membership',
      created_by_operation: false,
    });
    expect(inverseReceipt).toMatchObject({
      outcome: 'terminal_nonacceptance',
      reason: 'membership_has_later_accepted_adopter',
    });
    expect(await setup.readItemBinding(registration.collection_id!, value.id))
      .toMatchObject({ item_id: value.id });
    await setup.close();
    await db.close();
  });

  test('PostgreSQL resource pages bound returned rows and resolver calls to limit plus one', async () => {
    const { db, client } = await createMigratedPglite();
    const values = new Map<string, KnowledgeItem>();
    for (let index = 0; index < 12; index += 1) {
      const value = item(
        `k_page_${String(index).padStart(2, '0')}`,
        [`Tag ${index % 5}`, index % 2 === 0 ? 'Shared' : 'Odd'],
      );
      values.set(value.id, value);
      await insertItem(db, value);
    }
    const metrics: PageMetrics = { manyRows: 0, maxManyRows: 0 };
    let resolverCalls = 0;
    const authority = createPostgresKnowledgeProjectLinksAuthority({
      client: measuredClient(client, metrics),
      itemResolver: async (id) => {
        resolverCalls += 1;
        return values.get(id) ?? null;
      },
      options,
    });
    const registration = await authority.registerCollection(await registrationRequest(authority));
    for (const value of values.values()) {
      await authority.bindItem(
        await bindingRequest(authority, registration.collection_id!, value.id),
      );
    }

    const limit = 3;
    const workBound = limit + 1;
    const resources = [];
    let cursor: string | null = null;
    let expectedTotal: number | null = null;
    do {
      metrics.manyRows = 0;
      metrics.maxManyRows = 0;
      resolverCalls = 0;
      const page = await authority.listProjectResources('wks_project_alpha', { limit, cursor });
      expectedTotal ??= page.total;
      expect(page.total).toBe(expectedTotal);
      expect(metrics.manyRows).toBeLessThanOrEqual(workBound);
      expect(metrics.maxManyRows).toBeLessThanOrEqual(workBound);
      expect(resolverCalls).toBeLessThanOrEqual(workBound);
      resources.push(...page.resources);
      cursor = page.next_cursor;
    } while (cursor);

    const keys = resources.map((resource) => resource.key);
    expect(keys).toEqual([...keys].sort((left, right) => left.localeCompare(right)));
    expect(new Set(keys).size).toBe(keys.length);
    expect(resources.length).toBe(expectedTotal);
    expect(resources.filter((resource) => resource.kind === 'item')).toHaveLength(values.size);
    for (const resource of resources.filter((entry) => entry.kind === 'taxonomy')) {
      expect(resource.key).toBe(`taxonomy:${resource.id}`);
      const normalizedTag = String(resource.metadata.normalized_tag);
      const expectedMemberIds = [...values.values()]
        .flatMap((value) => (value.tags ?? [])
          .filter((tag) => tag.trim().toLowerCase() === normalizedTag)
          .map(() => value.id))
        .sort();
      expect(resource.metadata.member_digest)
        .toBe(digestKnowledgeProjectLinksValue(expectedMemberIds));
    }
    await authority.close();
    await db.close();
  });
});
