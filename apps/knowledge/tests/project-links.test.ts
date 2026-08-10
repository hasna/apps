import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ItemStore } from '../src/item-store';
import {
  KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
  KnowledgeProjectLinksError,
  createKnowledgeProjectLinksHttpClient,
  createLocalKnowledgeProjectLinksAuthority,
  createPostgresKnowledgeProjectLinksAuthority,
  digestKnowledgeProjectLinksValue,
  type KnowledgeProjectLinksAuthority,
  type KnowledgeProjectRegistrationCapability,
  type KnowledgeProjectRegistrationReceipt,
} from '../src/project-links';
import type { KnowledgeItem } from '../src/store';
import { createKnowledgeClient } from '../src/sdk';
import { createServeHandler, knowledgeOpenApi } from '../src/serve';
import { createMigratedPglite } from './fixtures/pglite-client';

const tempRoots: string[] = [];
const fixedNow = () => '2026-08-10T12:00:00.000Z';
const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-project-links-'));
  tempRoots.push(root);
  return root;
}

function item(id: string, title: string, tags: string[] = []): KnowledgeItem {
  return {
    id,
    short_id: id.slice(0, 8),
    title,
    content: `${title} body`,
    url: null,
    tags,
    metadata: {},
    archived: false,
    created_at: fixedNow(),
    updated_at: fixedNow(),
    version: 1,
  };
}

function mapItemStore(items: Map<string, KnowledgeItem>): ItemStore {
  return {
    kind: 'local',
    location: 'test-map',
    exists: true,
    supportsVersions: false,
    async list() {
      return { items: [...items.values()], total: items.size, exists: true };
    },
    async listAll() {
      return { items: [...items.values()], total: items.size, exists: true };
    },
    async get(id) {
      return items.get(id) ?? null;
    },
    async create(input) {
      const created = item(input.id ?? `k_${items.size + 1}`, input.title, input.tags);
      items.set(created.id, created);
      return created;
    },
    async update() {
      throw new Error('not used');
    },
    async delete() {
      throw new Error('not used');
    },
    async deleteMany() {
      throw new Error('not used');
    },
    async listVersions() {
      throw new Error('not used');
    },
    async getVersion() {
      throw new Error('not used');
    },
  };
}

async function registrationRequest(
  authority: KnowledgeProjectLinksAuthority,
  input: {
    operationId?: string;
    stepId?: string;
    idempotencyKey?: string;
    projectId?: string;
    projectSlug?: string;
    projectName?: string;
  } = {},
) {
  const capability = await authority.capability();
  const projectId = input.projectId ?? 'wks_project_alpha';
  const projectSlug = input.projectSlug ?? 'alpha';
  const projectName = input.projectName ?? 'Alpha';
  const collectionSlug = `${projectSlug}-knowledge`;
  const collectionName = `${projectName} Knowledge`;
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
    target_selector: projectId,
    idempotency_key: input.idempotencyKey ?? 'idem-register-alpha',
    request_digest: digestKnowledgeProjectLinksValue({
      action: 'register_collection',
      source_project_id: projectId,
      project_slug: projectSlug,
      project_name: projectName,
      collection_slug: collectionSlug,
      collection_name: collectionName,
      membership_rule: 'explicit_collection_binding',
    }),
    precondition_digest: digestKnowledgeProjectLinksValue({
      source_project_id: projectId,
      expected: 'absent_or_exact_match',
    }),
    project_id: projectId,
    project_slug: projectSlug,
    project_name: projectName,
    desired: {
      collection_slug: collectionSlug,
      collection_name: collectionName,
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
  input: {
    operationId: string;
    stepId: string;
    idempotencyKey: string;
  },
) {
  return {
    operation_id: input.operationId,
    step_id: input.stepId,
    authority_route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    idempotency_key: input.idempotencyKey,
    accepted_receipt_id: receipt.receipt_id,
  };
}

function localHarness(items = new Map<string, KnowledgeItem>()) {
  const root = tempRoot();
  const store = mapItemStore(items);
  const authority = createLocalKnowledgeProjectLinksAuthority({
    databasePath: join(root, 'knowledge.db'),
    itemStore: store,
    options: {
      packageVersion: '9.9.9',
      authorityId: 'knowledge-test',
      tenantId: 'tenant-test',
      corpusId: 'corpus-test',
      now: fixedNow,
    },
  });
  return { root, store, items, authority };
}

describe('Knowledge Projects resource-link producer', () => {
  test('SQLite owns a real aggregate, explicit later-child membership, stable taxonomy, and complete paging', async () => {
    const first = item('k_first', 'First', ['Policy', 'Shared']);
    const later = item('k_later', 'Later', ['shared', 'Runbook']);
    const unbound = item('k_unbound', 'Unbound', ['Invisible']);
    const harness = localHarness(new Map([
      [first.id, first],
      [unbound.id, unbound],
    ]));

    const registration = await harness.authority.registerCollection(
      await registrationRequest(harness.authority),
    );
    expect(registration.outcome).toBe('accepted');
    expect(registration.created_by_operation).toBe(true);
    expect(registration.collection_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const initial = await harness.authority.readAllProjectResources('wks_project_alpha');
    expect(initial.map((resource) => resource.kind)).toEqual(['collection', 'project']);

    const firstBinding = await harness.authority.bindItem(
      await bindingRequest(harness.authority, registration.collection_id!, first.id),
    );
    expect(firstBinding.created_by_operation).toBe(true);

    const firstPage = await harness.authority.listProjectResources('wks_project_alpha', { limit: 2 });
    expect(firstPage.count).toBe(2);
    expect(firstPage.total).toBe(5);
    expect(firstPage.has_more).toBe(true);
    expect(firstPage.complete).toBe(false);
    expect(firstPage.next_cursor).not.toBeNull();

    const exactFirst = await harness.authority.readProjectResource(
      'wks_project_alpha',
      'item',
      first.id,
    );
    expect(exactFirst.locator.value).toBe('knowledge:item:k_first');
    expect(exactFirst.metadata.tags).toEqual(['Policy', 'Shared']);
    expect((await harness.authority.readAllProjectResources('wks_project_alpha')))
      .not.toContainEqual(expect.objectContaining({ id: unbound.id }));

    harness.items.set(later.id, later);
    const beforeLaterBinding = await harness.authority.readAllProjectResources('wks_project_alpha');
    expect(beforeLaterBinding).not.toContainEqual(expect.objectContaining({ id: later.id }));

    const laterBinding = await harness.authority.bindItem(
      await bindingRequest(harness.authority, registration.collection_id!, later.id),
    );
    expect(laterBinding.result_revision).toBe('r3');
    const afterLaterBinding = await harness.authority.readAllProjectResources('wks_project_alpha', {
      limit: 2,
    });
    expect(afterLaterBinding).toContainEqual(expect.objectContaining({ kind: 'item', id: later.id }));
    expect(afterLaterBinding).not.toContainEqual(expect.objectContaining({ id: unbound.id }));

    const sharedTaxonomy = afterLaterBinding.find(
      (resource) => resource.kind === 'taxonomy' && resource.metadata.normalized_tag === 'shared',
    );
    expect(sharedTaxonomy?.metadata.item_count).toBe(2);
    expect(sharedTaxonomy?.locator.kind).toBe('external_uuid');

    await expect(
      harness.authority.listProjectResources('wks_project_alpha', {
        limit: 2,
        cursor: firstPage.next_cursor,
      }),
    ).rejects.toMatchObject({
      code: 'KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE',
    });

    const preMutationPage = await harness.authority.listProjectResources(
      'wks_project_alpha',
      { limit: 2 },
    );
    harness.items.set(first.id, {
      ...first,
      title: 'First revised',
      tags: ['Policy', 'Changed'],
      version: 2,
    });
    await expect(
      harness.authority.listProjectResources('wks_project_alpha', {
        limit: 2,
        cursor: preMutationPage.next_cursor,
      }),
    ).rejects.toMatchObject({
      code: 'KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE',
    });
    const postMutationResources = await harness.authority.readAllProjectResources(
      'wks_project_alpha',
    );

    const reopened = createLocalKnowledgeProjectLinksAuthority({
      databasePath: join(harness.root, 'knowledge.db'),
      itemStore: harness.store,
      options: {
        packageVersion: '9.9.9',
        authorityId: 'knowledge-test',
        tenantId: 'tenant-test',
        corpusId: 'corpus-test',
        now: fixedNow,
      },
    });
    expect((await reopened.readCollection(registration.collection_id!)).digest)
      .toBe((await harness.authority.readCollection(registration.collection_id!)).digest);
    expect((await reopened.readAllProjectResources('wks_project_alpha')).length)
      .toBe(postMutationResources.length);
  });

  test('registration and bind-existing are idempotent/adoptable, while inverse only removes owned effects', async () => {
    const existing = item('k_existing', 'Existing', ['Convention']);
    const { authority } = localHarness(new Map([[existing.id, existing]]));
    const request = await registrationRequest(authority);
    const accepted = await authority.registerCollection(request);
    expect(await authority.registerCollection(request)).toEqual(accepted);

    const adoptedRegistration = await authority.registerCollection(
      await registrationRequest(authority, {
        operationId: 'op-adopt-collection',
        stepId: 'step-adopt-collection',
        idempotencyKey: 'idem-adopt-collection',
      }),
    );
    expect(adoptedRegistration.reason).toBe('adopted_existing_collection');
    expect(adoptedRegistration.created_by_operation).toBe(false);

    const binding = await authority.bindItem(
      await bindingRequest(authority, accepted.collection_id!, existing.id),
    );
    const adoptedBinding = await authority.bindItem(
      await bindingRequest(authority, accepted.collection_id!, existing.id, {
        operationId: 'op-adopt-membership',
        stepId: 'step-adopt-membership',
        idempotencyKey: 'idem-adopt-membership',
      }),
    );
    expect(adoptedBinding.reason).toBe('adopted_existing_membership');
    expect(adoptedBinding.created_by_operation).toBe(false);

    const capability = await authority.capability();
    const adoptedInverseRequest = await inverseRequest(capability, adoptedBinding, {
      operationId: 'op-inverse-adopted-membership',
      stepId: 'step-inverse-adopted-membership',
      idempotencyKey: 'idem-inverse-adopted-membership',
    });
    const adoptedInverse = await authority.compensateItemBinding(adoptedInverseRequest);
    expect(adoptedInverse.outcome).toBe('terminal_nonacceptance');
    expect(adoptedInverse.reason).toBe('adopted_membership_is_not_inverse_owned');
    expect(await authority.readItemBinding(accepted.collection_id!, existing.id))
      .toMatchObject({ item_id: existing.id });

    const bindingInverseRequest = await inverseRequest(capability, binding, {
      operationId: 'op-inverse-owned-membership',
      stepId: 'step-inverse-owned-membership',
      idempotencyKey: 'idem-inverse-owned-membership',
    });
    const bindingInverse = await authority.compensateItemBinding(bindingInverseRequest);
    expect(bindingInverse.outcome).toBe('accepted');
    expect(await authority.verifyItemBindingInverse(bindingInverseRequest))
      .toMatchObject({ target_id: existing.id, absent: true });

    const registrationInverseRequest = await inverseRequest(capability, accepted, {
      operationId: 'op-inverse-owned-collection',
      stepId: 'step-inverse-owned-collection',
      idempotencyKey: 'idem-inverse-owned-collection',
    });
    const registrationInverse = await authority.compensateRegistration(registrationInverseRequest);
    expect(registrationInverse.outcome).toBe('accepted');
    expect(await authority.verifyRegistrationInverse(registrationInverseRequest))
      .toMatchObject({ target_id: accepted.collection_id, absent: true });
    await expect(authority.readCollection(accepted.collection_id!)).rejects.toBeInstanceOf(
      KnowledgeProjectLinksError,
    );
  });

  test('Postgres executes the same aggregate, membership, receipt, and resource semantics', async () => {
    const { db, client } = await createMigratedPglite();
    const pgItem = item('k_pg', 'Postgres Item', ['Postgres']);
    const authority = createPostgresKnowledgeProjectLinksAuthority({
      client,
      itemResolver: async (id) => id === pgItem.id ? pgItem : null,
      options: {
        packageVersion: '9.9.9',
        authorityId: 'knowledge-test',
        tenantId: 'tenant-test',
        corpusId: 'corpus-test',
        now: fixedNow,
      },
    });
    const registration = await authority.registerCollection(await registrationRequest(authority));
    const binding = await authority.bindItem(
      await bindingRequest(authority, registration.collection_id!, pgItem.id),
    );
    expect(binding.outcome).toBe('accepted');
    expect((await authority.readAllProjectResources('wks_project_alpha')).map(
      (resource) => `${resource.kind}:${resource.id}`,
    )).toEqual([
      `collection:${registration.collection_id}`,
      `item:${pgItem.id}`,
      `project:${registration.project_id}`,
      expect.stringMatching(/^taxonomy:/),
    ]);

    const receiptMutation = await db.query(
      `UPDATE knowledge_project_link_receipts SET reason = 'mutated' WHERE receipt_id = $1`,
      [binding.receipt_id],
    ).then(
      () => 'unexpected-success',
      (error) => String(error),
    );
    expect(receiptMutation).toContain('immutable');
    await db.close();
  });

  test('HTTP routes, SDK group, and OpenAPI expose the same producer contract', async () => {
    const apiItem = item('k_http', 'HTTP Item', ['API']);
    const { authority } = localHarness(new Map([[apiItem.id, apiItem]]));
    const handler = createServeHandler({
      client: {
        async query() {
          return { rows: [], rowCount: 0 };
        },
        async many() {
          return [];
        },
        async get() {
          return null;
        },
        async one() {
          throw new Error('not used');
        },
        async execute() {},
        async transaction(fn) {
          return fn(this);
        },
        async close() {},
        get pool() {
          return {} as never;
        },
      },
      verifier: {
        async authenticate() {
          return {
            ok: true,
            principal: {
              app: 'knowledge',
              tid: 'tenant-test',
              kid: 'kid-test',
              scopes: ['knowledge:read', 'knowledge:write'],
              agent: null,
            },
          };
        },
      } as never,
      store: {
        async touchLastUsed() {},
      } as never,
      version: '9.9.9',
      projectLinksAuthority: () => authority,
    });
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
    const client = createKnowledgeProjectLinksHttpClient({
      baseUrl: `http://127.0.0.1:${server.port}`,
      fetch,
    });
    const registration = await client.registerCollection(await registrationRequest(client));
    await client.bindItem(await bindingRequest(client, registration.collection_id!, apiItem.id));
    expect((await client.readAllProjectResources('wks_project_alpha')).map((entry) => entry.kind))
      .toEqual(['collection', 'item', 'project', 'taxonomy']);
    server.stop(true);

    const sdk = createKnowledgeClient({ projectLinksAuthority: authority });
    expect((await sdk.projectLinks.capability()).route).toBe(KNOWLEDGE_PROJECT_REGISTRATION_ROUTE);
    expect((await sdk.projectLinks.readCollection(registration.collection_id!)).collection_id)
      .toBe(registration.collection_id);

    const openapi = knowledgeOpenApi('9.9.9');
    expect(openapi.paths).toHaveProperty('/v1/project-registration/capability');
    expect(openapi.paths).toHaveProperty('/v1/project-registration/items/bind');
    expect(openapi.paths).toHaveProperty('/v1/projects/{projectId}/resources');
    expect(openapi.paths).toHaveProperty('/v1/projects/{projectId}/resources/{kind}/{resourceId}');
    expect(openapi.components.schemas).toHaveProperty('ProjectResourcePage');
  });

  test('CLI registers, binds, exhausts, and exactly reads the same local producer', () => {
    const root = tempRoot();
    const storePath = join(root, 'db.json');
    const run = (args: string[]) => {
      const result = Bun.spawnSync({
        cmd: ['bun', 'src/cli.ts', ...args],
        cwd: repoRoot,
        env: {
          ...process.env,
          HASNA_KNOWLEDGE_STORAGE_MODE: 'sqlite',
          HASNA_KNOWLEDGE_PROJECT_AUTHORITY_ID: 'knowledge-cli-test',
          HASNA_KNOWLEDGE_PROJECT_TENANT_ID: 'tenant-cli-test',
          HASNA_KNOWLEDGE_PROJECT_CORPUS_ID: 'corpus-cli-test',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdout = result.stdout.toString();
      const stderr = result.stderr.toString();
      expect(
        result.exitCode,
        `command failed: ${args.join(' ')}\nstdout=${stdout}\nstderr=${stderr}`,
      ).toBe(0);
      return JSON.parse(stdout) as Record<string, unknown>;
    };

    run([
      'upsert',
      'CLI Item',
      'CLI body',
      '--id',
      'k_cli',
      '--tag',
      'CLI',
      '--store',
      storePath,
      '--json',
    ]);
    const registered = run([
      'project-registration',
      'create',
      '--operation-id',
      'op-cli-register',
      '--step-id',
      'step-cli-register',
      '--idempotency-key',
      'idem-cli-register',
      '--project',
      'wks_cli',
      '--slug',
      'cli',
      '--name',
      'CLI',
      '--store',
      storePath,
      '--json',
    ]);
    const collectionId = (
      registered.receipt as KnowledgeProjectRegistrationReceipt
    ).collection_id!;
    run([
      'project-membership',
      'bind',
      '--operation-id',
      'op-cli-bind',
      '--step-id',
      'step-cli-bind',
      '--idempotency-key',
      'idem-cli-bind',
      '--collection-id',
      collectionId,
      '--item-id',
      'k_cli',
      '--store',
      storePath,
      '--json',
    ]);
    const exhausted = run([
      'project-resources',
      'wks_cli',
      '--all',
      '--limit',
      '1',
      '--store',
      storePath,
      '--json',
    ]);
    expect(exhausted.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'project' }),
      expect.objectContaining({ kind: 'collection', id: collectionId }),
      expect.objectContaining({ kind: 'item', id: 'k_cli' }),
      expect.objectContaining({ kind: 'taxonomy' }),
    ]));
    const exact = run([
      'project-resource',
      'wks_cli',
      'item',
      'k_cli',
      '--store',
      storePath,
      '--json',
    ]);
    expect(exact.resource).toMatchObject({ kind: 'item', id: 'k_cli' });

    const completions = Bun.spawnSync({
      cmd: ['bun', 'src/cli.ts', '--completions', 'bash'],
      cwd: repoRoot,
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(completions.exitCode).toBe(0);
    expect(completions.stdout.toString()).toContain('project-registration');
    expect(completions.stdout.toString()).toContain('--collection-id');
    expect(completions.stdout.toString()).toContain('--kind');

    for (const command of [
      'project-registration',
      'project-membership',
      'project-resources',
      'project-resource',
    ]) {
      const help = Bun.spawnSync({
        cmd: ['bun', 'src/cli.ts', command, '--help'],
        cwd: repoRoot,
        env: process.env,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(help.exitCode).toBe(0);
      expect(help.stdout.toString()).toStartWith(`Usage: knowledge ${command}`);
      expect(help.stdout.toString()).not.toContain('Commands:');
    }
  });
});
