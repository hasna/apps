import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ApiKeyStore, mintApiKey, verifyApiKey } from '@hasna/contracts/auth';
import type { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as publicApi from '../src/index';
import {
  DEFAULT_KNOWLEDGE_GUARDED_LIMITS,
  KNOWLEDGE_GUARDED_WRITE_CONTRACT,
  KNOWLEDGE_RELATIONS_METADATA_KEY,
  KNOWLEDGE_RELATIONS_SCHEMA,
  KnowledgeGuardedAdoptionRejectedError,
  KnowledgeGuardedManifestConflictError,
  KnowledgeGuardedManifestStepRefusedError,
  KnowledgeGuardedOperationConflictError,
  KnowledgePrivateQueryResponseError,
  KnowledgeGuardedWriteRejectedError,
  assertKnowledgeGuardedManifestTerminalCompleteness,
  assertKnowledgeTerminalCompleteness,
  computeKnowledgeGuardedAdoptionDeterministicKey,
  computeKnowledgeGuardedAdoptionReceiptId,
  computeKnowledgeGuardedDeterministicKey,
  computeKnowledgeGuardedManifestId,
  computeKnowledgeGuardedReceiptId,
  computeKnowledgeGuardedRecoveryKey,
  createKnowledgeGuardedWriter,
  executeKnowledgeGuardedCliQuery,
  executeKnowledgeGuardedCliReadback,
  executeKnowledgeGuardedCliWrite,
  createKnowledgePrivateInputDescriptor,
  createKnowledgePrivateQueryDescriptor,
  createKnowledgePrivateTitleLookupDescriptor,
  inspectKnowledgePrivateResult,
  knowledgeGuardedDigest,
  revokeKnowledgePrivateQueryDescriptor,
  type KnowledgeGuardedBinding,
  type KnowledgeGuardedManifestBinding,
  type KnowledgeGuardedManifestRecovery,
  type KnowledgeGuardedManifestStep,
  type KnowledgePrivateInputDescriptor,
} from '../src/index';
import { createServeHandler } from '../src/serve';
import type {
  PoolQueryClient,
  TypedQueryClient,
} from '../src/generated/storage-kit/index.js';
import { createMigratedPglite } from './fixtures/pglite-client';
import { budget } from './support/budget';

const SIGNING = 'test-signing-secret-not-a-real-key';
const TENANT = 'tenant-fcame-test';
const AUTHORITY = {
  classification: 'user_hosted',
  authority_id: 'knowledge-authority-test',
} as const;
const BINDING: KnowledgeGuardedBinding = {
  authority: AUTHORITY,
  tenant_id: TENANT,
  scope: 'global',
  parent_id: 'global:global',
};
const SUPPLIED_SENTINEL_KEY = 'fake-supplied-guarded-writer-env-key';
const AMBIENT_SENTINEL_KEY = 'fake-ambient-guarded-writer-env-key';

let db: PGlite;
let server: { port: number; stop: (closeActive?: boolean) => void };
let env: NodeJS.ProcessEnv;
const guardedSqlTrace: string[] = [];

function tracedQueryClient(base: PoolQueryClient): PoolQueryClient {
  const trace = (client: TypedQueryClient): TypedQueryClient => ({
    query: (sql, params) => {
      guardedSqlTrace.push(sql);
      return client.query(sql, params);
    },
    many: (sql, params) => {
      guardedSqlTrace.push(sql);
      return client.many(sql, params);
    },
    get: (sql, params) => {
      guardedSqlTrace.push(sql);
      return client.get(sql, params);
    },
    one: (sql, params) => {
      guardedSqlTrace.push(sql);
      return client.one(sql, params);
    },
    execute: (sql, params) => {
      guardedSqlTrace.push(sql);
      return client.execute(sql, params);
    },
  });
  const traced = trace(base);
  return {
    ...traced,
    pool: base.pool,
    transaction: (fn) => base.transaction((client) => fn(trace(client))),
    close: () => base.close(),
  };
}

beforeAll(async () => {
  const created = await createMigratedPglite();
  db = created.db;
  const client = tracedQueryClient(created.client);
  const store = new ApiKeyStore(client);
  const verifier = verifyApiKey({
    app: 'knowledge',
    signingSecret: SIGNING,
    keyStatus: () => Promise.resolve('active' as const),
  });
  const handler = createServeHandler({
    client,
    verifier,
    store,
    version: '9.9.9',
    guardedAuthority: AUTHORITY,
  });
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler });
  env = {
    NODE_ENV: 'test',
    HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
    HASNA_KNOWLEDGE_API_KEY: mintApiKey({
      app: 'knowledge',
      scopes: ['knowledge:read', 'knowledge:write'],
      tid: TENANT,
      signingSecret: SIGNING,
    }).token,
  };
});

afterAll(async () => {
  server?.stop(true);
  await db?.close().catch(() => {});
});

function writer(binding: KnowledgeGuardedBinding = BINDING, requireManifest = false) {
  return createKnowledgeGuardedWriter({
    binding,
    env,
    require_manifest: requireManifest,
  });
}

async function createLegacyItem(
  id: string,
  content: string,
  input: Record<string, unknown> = {},
) {
  const response = await fetch(`http://127.0.0.1:${server.port}/v1/notes`, {
    method: 'POST',
    headers: {
      'x-api-key': env.HASNA_KNOWLEDGE_API_KEY!,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id,
      title: `Legacy ${id}`,
      content,
      url: 'https://example.invalid/legacy',
      tags: ['legacy'],
      metadata: { source: 'pre-fcame' },
      ...input,
    }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

async function itemSnapshot(id: string) {
  const result = await db.query<Record<string, unknown>>(
    `SELECT
       id, title, content, url, tags, metadata, archived, created_at, updated_at, version,
       authority_classification, authority_id, tenant_id, scope, parent_id,
       guarded_adoption_receipt_id
     FROM knowledge_items WHERE id = $1`,
    [id],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

test('REGRESSION: guarded writer uses the supplied env endpoint and credential, not ambient credentials', async () => {
  const originalFetch = globalThis.fetch;
  const savedAmbient = {
    url: process.env.HASNA_KNOWLEDGE_API_URL,
    key: process.env.HASNA_KNOWLEDGE_API_KEY,
  };
  const home = mkdtempSync(join(tmpdir(), 'knowledge-guarded-writer-env-'));
  const credentialDir = join(home, '.hasna', 'cloud');
  mkdirSync(credentialDir, { recursive: true });
  await Bun.write(
    join(credentialDir, 'knowledge.env'),
    `HASNA_KNOWLEDGE_API_KEY=${AMBIENT_SENTINEL_KEY}\n`,
  );

  const captured: Array<{ url: string; xApiKey: string | null; authorization: string | null }> = [];
  globalThis.fetch = (async (input, init) => {
    const headers = new Headers(init?.headers);
    captured.push({
      url: String(input),
      xApiKey: headers.get('x-api-key'),
      authorization: headers.get('authorization'),
    });
    return new Response(JSON.stringify({
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      manifest: { manifest_id: 'manifest-env-precedence' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    process.env.HASNA_KNOWLEDGE_API_URL = 'http://127.0.0.1:65530/ambient';
    process.env.HASNA_KNOWLEDGE_API_KEY = AMBIENT_SENTINEL_KEY;

    const suppliedEnv = {
      ...process.env,
      HOME: home,
      HASNA_KNOWLEDGE_API_URL: 'http://127.0.0.1:65531/supplied',
      HASNA_KNOWLEDGE_API_KEY: SUPPLIED_SENTINEL_KEY,
      KNOWLEDGE_API_KEY: SUPPLIED_SENTINEL_KEY,
    } as NodeJS.ProcessEnv;

    const guarded = createKnowledgeGuardedWriter({ binding: BINDING, env: suppliedEnv });
    await guarded.reconcileManifest('manifest-env-precedence');

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toStartWith('http://127.0.0.1:65531/supplied/v1/guarded-manifests/');
    expect(captured[0].xApiKey).toBe(SUPPLIED_SENTINEL_KEY);
    expect(captured[0].authorization).toBe(`Bearer ${SUPPLIED_SENTINEL_KEY}`);
    expect(captured[0].xApiKey).not.toBe(AMBIENT_SENTINEL_KEY);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(home, { recursive: true, force: true });
    if (savedAmbient.url === undefined) delete process.env.HASNA_KNOWLEDGE_API_URL;
    else process.env.HASNA_KNOWLEDGE_API_URL = savedAmbient.url;
    if (savedAmbient.key === undefined) delete process.env.HASNA_KNOWLEDGE_API_KEY;
    else process.env.HASNA_KNOWLEDGE_API_KEY = savedAmbient.key;
  }
});

test('private query transport failures are controlled and never disclose selector material', async () => {
  const originalFetch = globalThis.fetch;
  const selectorMaterial = 'private-query-selector-must-not-cross-error-boundary';
  const guarded = createKnowledgeGuardedWriter({
    binding: BINDING,
    env: {
      HASNA_KNOWLEDGE_API_URL: 'http://127.0.0.1:65532',
      HASNA_KNOWLEDGE_API_KEY: SUPPLIED_SENTINEL_KEY,
    },
  });
  const query = createKnowledgePrivateQueryDescriptor({
    operation_id: 'op-private-query-malformed-response',
    step_id: 'step-private-query-malformed-response',
    binding: BINDING,
    selector: { kind: 'exact_title', title: selectorMaterial },
    limit: 1,
  });

  try {
    for (const response of [undefined, new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })]) {
      globalThis.fetch = (async () => response as Response) as unknown as typeof fetch;
      let caught: unknown;
      try {
        await guarded.query(query);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(KnowledgePrivateQueryResponseError);
      expect((caught as KnowledgePrivateQueryResponseError).code).toBe('private_query_response_invalid');
      expect(String(caught)).not.toContain(selectorMaterial);
      expect(JSON.stringify(caught)).not.toContain(selectorMaterial);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guarded CLI accepts only opaque descriptors and proves create, update, query, readback, and replay', async () => {
  const targetId = 'k_fcame_private_cli_descriptor';
  const privateTitle = 'Private CLI descriptor title';
  const privateBody = 'private CLI descriptor body must stay off process surfaces';
  const privateTags = ['private-cli', 'fcame'];
  const create = descriptor({
    operation: 'op-private-cli-create',
    step: 'step-create',
    target: targetId,
    payload: { title: privateTitle, content: privateBody, tags: privateTags },
  });

  const created = await executeKnowledgeGuardedCliWrite(create, { env });
  expect(created.transport).toBe('process_ipc');
  expect(created.proof).toMatchObject({
    kind: 'write',
    item_count: 1,
    duplicate: false,
  });
  expect(created.proof.items[0]).toMatchObject({
    id: targetId,
    version: 1,
    title_sha256: createHash('sha256').update(privateTitle).digest('hex'),
    content_sha256: createHash('sha256').update(privateBody).digest('hex'),
  });
  expect(JSON.stringify(created)).not.toContain(privateTitle);
  expect(JSON.stringify(created)).not.toContain(privateBody);
  expect(JSON.stringify(created)).not.toContain(privateTags.join(','));

  const replay = await executeKnowledgeGuardedCliWrite(create, { env });
  expect(replay.proof.duplicate).toBe(true);
  expect(replay.proof.receipt_id).toBe(created.proof.receipt_id);
  expect(replay.proof.items).toEqual(created.proof.items);

  const exactTitle = createKnowledgePrivateQueryDescriptor({
    operation_id: 'op-private-cli-query',
    step_id: 'step-query',
    binding: BINDING,
    selector: { kind: 'exact_title', title: privateTitle },
    limit: 1,
  });
  const queried = await executeKnowledgeGuardedCliQuery(exactTitle, { env });
  expect(queried.proof).toMatchObject({
    kind: 'query',
    query_kind: 'exact_title',
    item_count: 1,
    total: 1,
  });
  expect(JSON.stringify(queried)).not.toContain(privateTitle);
  expect(JSON.stringify(queried)).not.toContain(privateBody);

  const currentVersion = createKnowledgePrivateQueryDescriptor({
    operation_id: 'op-private-cli-readback',
    step_id: 'step-readback',
    binding: BINDING,
    selector: { kind: 'current_version', item_id: targetId },
    limit: 1,
  });
  const readback = await executeKnowledgeGuardedCliReadback(currentVersion, { env });
  expect(readback.proof).toMatchObject({ kind: 'readback', item_count: 1 });
  expect(readback.proof.items).toEqual(created.proof.items);

  const updatedBody = 'private CLI updated body';
  const update = descriptor({
    operation: 'op-private-cli-update',
    step: 'step-update',
    target: targetId,
    verb: 'update',
    version: 1,
    payload: { content: updatedBody },
  });
  const updated = await executeKnowledgeGuardedCliWrite(update, { env });
  expect(updated.proof.items[0]).toMatchObject({
    id: targetId,
    version: 2,
    content_sha256: createHash('sha256').update(updatedBody).digest('hex'),
  });
  expect(JSON.stringify(updated)).not.toContain(updatedBody);

  const conflictingBody = 'private conflicting body must not leak';
  const conflict = descriptor({
    operation: 'op-private-cli-update',
    step: 'step-update',
    target: targetId,
    verb: 'update',
    version: 1,
    payload: { content: conflictingBody },
  });
  let caught: unknown;
  try {
    await executeKnowledgeGuardedCliWrite(conflict, { env });
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code: 'guarded_operation_conflict' });
  expect(String(caught)).not.toContain(conflictingBody);
  expect(JSON.stringify(caught)).not.toContain(conflictingBody);

  const fixedMetadataContent = 'anonymous_fd';
  const fixedMetadataUpdate = descriptor({
    operation: 'op-private-cli-fixed-metadata-content',
    step: 'step-fixed-metadata-content',
    target: targetId,
    verb: 'update',
    version: 2,
    payload: { content: fixedMetadataContent },
  });
  const fixedMetadataResult = await executeKnowledgeGuardedCliWrite(fixedMetadataUpdate, { env });
  expect(fixedMetadataResult.proof.items[0]).toMatchObject({
    id: targetId,
    version: 3,
    content_sha256: createHash('sha256').update(fixedMetadataContent).digest('hex'),
  });

  let timeoutCaught: unknown;
  try {
    await executeKnowledgeGuardedCliWrite(create, {
      env,
      timeoutMs: 1,
    });
  } catch (error) {
    timeoutCaught = error;
  }
  expect(timeoutCaught).toMatchObject({ code: 'guarded_cli_timeout' });
  expect(String(timeoutCaught)).not.toContain(privateBody);
}, budget(20_000));

function deterministicManifestId(
  operationId: string,
  binding: KnowledgeGuardedBinding = BINDING,
): string {
  return computeKnowledgeGuardedManifestId(binding, operationId);
}

function descriptor(options: {
  operation: string;
  step: string;
  target: string;
  verb?: 'create' | 'update';
  version?: number;
  binding?: KnowledgeGuardedBinding;
  manifest?: KnowledgeGuardedManifestBinding;
  payload?: Record<string, unknown>;
}): KnowledgePrivateInputDescriptor {
  const verb = options.verb ?? 'create';
  return createKnowledgePrivateInputDescriptor({
    operation_id: options.operation,
    step_id: options.step,
    verb,
    target_id: options.target,
    precondition: verb === 'create'
      ? { kind: 'absent' }
      : { kind: 'version', expected_version: options.version ?? 1 },
    binding: options.binding ?? BINDING,
    manifest: options.manifest,
    payload: options.payload ?? { title: options.target, content: `body:${options.target}` },
  });
}

function keyFor(input: KnowledgePrivateInputDescriptor): string {
  return computeKnowledgeGuardedDeterministicKey({
    binding: input.binding,
    operation_id: input.operation_id,
    step_id: input.step_id,
    verb: input.verb,
    target_id: input.target_id,
    payload_digest: input.payload_digest,
    precondition: input.precondition,
    manifest: input.manifest,
  });
}

type RecoveryPlan = {
  payload: Record<string, unknown>;
  recovery: KnowledgeGuardedManifestRecovery;
};

function recoveryPlan(
  input: KnowledgePrivateInputDescriptor,
  strategy: 'forward_repair' | 'receipt_scoped_compensation' = 'receipt_scoped_compensation',
): RecoveryPlan {
  if (!input.manifest) throw new Error('test descriptor must be manifest-bound');
  const deterministicKey = keyFor(input);
  const compensation = strategy === 'receipt_scoped_compensation';
  const payload = compensation
    ? { archived: true }
    : {
      title: `Forward repair for ${input.target_id}`,
      metadata: { repairs_step: input.step_id },
    };
  const recoveryBase = {
    strategy,
    operation_id: `${input.operation_id}:${compensation ? 'compensate' : 'repair'}`,
    step_id: `${input.step_id}:${compensation ? 'compensate' : 'repair'}`,
    verb: compensation ? 'update' as const : 'create' as const,
    target_id: compensation ? input.target_id : `${input.target_id}:forward-repair`,
    semantic_digest: knowledgeGuardedDigest(payload),
    precondition: compensation
      ? {
        kind: 'version' as const,
        expected_version: input.precondition.kind === 'version'
          ? input.precondition.expected_version + 1
          : 1,
      }
      : { kind: 'absent' as const },
    binding: input.binding,
    limits: DEFAULT_KNOWLEDGE_GUARDED_LIMITS,
    receipt_scope: compensation ? 'accepted_step_receipt' as const : null,
    compensates_receipt_id: compensation
      ? computeKnowledgeGuardedReceiptId(deterministicKey)
      : null,
  };
  return {
    payload,
    recovery: {
      ...recoveryBase,
      deterministic_key: computeKnowledgeGuardedRecoveryKey({
        manifest_id: input.manifest.manifest_id,
        ordinal: input.manifest.ordinal,
        step_deterministic_key: deterministicKey,
        ...recoveryBase,
      }),
    },
  };
}

function recoveryDescriptor(
  manifestId: string,
  ordinal: number,
  plan: RecoveryPlan,
): KnowledgePrivateInputDescriptor {
  return createKnowledgePrivateInputDescriptor({
    operation_id: plan.recovery.operation_id,
    step_id: plan.recovery.step_id,
    verb: plan.recovery.verb,
    target_id: plan.recovery.target_id,
    precondition: plan.recovery.precondition,
    binding: plan.recovery.binding,
    manifest: {
      manifest_id: manifestId,
      ordinal,
      phase: 'recovery',
      compensates_receipt_id: plan.recovery.compensates_receipt_id,
    },
    payload: plan.payload,
  });
}

function manifestStep(
  input: KnowledgePrivateInputDescriptor,
  strategy: 'forward_repair' | 'receipt_scoped_compensation' = 'receipt_scoped_compensation',
): KnowledgeGuardedManifestStep {
  if (!input.manifest) throw new Error('test descriptor must be manifest-bound');
  const deterministicKey = keyFor(input);
  const plan = recoveryPlan(input, strategy);
  return {
    ordinal: input.manifest.ordinal,
    operation_id: input.operation_id,
    step_id: input.step_id,
    deterministic_key: deterministicKey,
    verb: input.verb,
    target_id: input.target_id,
    binding: input.binding,
    semantic_digest: input.payload_digest,
    precondition: input.precondition,
    dependencies: Array.from({ length: input.manifest.ordinal }, (_unused, index) => index),
    limits: DEFAULT_KNOWLEDGE_GUARDED_LIMITS,
    recovery: plan.recovery,
  };
}

describe('FCAME-1 guarded Knowledge writer', () => {
  test('REGRESSION: legacy rows can be inspected and adopted without changing their content', async () => {
    const targetId = 'k_fcame_legacy_adoption_regression';
    const content = 'legacy doctrine body requiring guarded adoption';
    await createLegacyItem(targetId, content, { title: 'Legacy adoption regression' });
    const before = await itemSnapshot(targetId);

    const ordinaryRead = await fetch(`http://127.0.0.1:${server.port}/v1/notes/${targetId}`, {
      headers: { 'x-api-key': env.HASNA_KNOWLEDGE_API_KEY! },
    });
    expect(ordinaryRead.status).toBe(200);
    expect((await ordinaryRead.json() as { content: string }).content).toBe(content);

    // This is the shipped failure: exact ordinary reads work, while the
    // binding-scoped guarded readback cannot see an existing unbound row.
    let guardedReadbackError: unknown = null;
    try {
      await writer().readback(targetId);
    } catch (error) {
      guardedReadbackError = error;
    }
    expect(guardedReadbackError).toBeInstanceOf(Error);
    expect((guardedReadbackError as Error).message).toMatch(/404/);
    console.log('CONTROL: ordinary_exact_read=200 guarded_binding_readback=404');

    const guarded = writer();
    const state = await guarded.readBindingState(targetId);
    expect(state.state).toBe('legacy_unbound');
    expect(state.item_version).toBe(1);
    expect(state.content_sha256)
      .toBe(createHash('sha256').update(content, 'utf8').digest('hex'));

    const adopted = await guarded.adoptLegacy({
      operation_id: 'op-legacy-adoption-regression',
      step_id: 'step-adopt',
      target_id: targetId,
      expected_version: state.item_version!,
      expected_content_sha256: state.content_sha256!,
    });
    expect(adopted.duplicate).toBe(false);
    expect(adopted.receipt.status).toBe('accepted');
    expect(adopted.receipt.code).toBe('adopted');
    expect(adopted.receipt.effect_count).toBe(1);
    expect(adopted.readback.item.content).toBe(content);
    expect(adopted.readback.item.version).toBe(1);
    expect(adopted.receipt.prior_tenant_id).toBeNull();

    const after = await itemSnapshot(targetId);
    for (const field of [
      'title',
      'content',
      'url',
      'tags',
      'metadata',
      'archived',
      'created_at',
      'updated_at',
      'version',
    ]) {
      expect(after[field]).toEqual(before[field]);
    }
    expect(after.authority_classification).toBe(BINDING.authority.classification);
    expect(after.authority_id).toBe(BINDING.authority.authority_id);
    expect(String(after.tenant_id)).toBe(BINDING.tenant_id);
    expect(after.scope).toBe(BINDING.scope);
    expect(after.parent_id).toBe(BINDING.parent_id);
    expect(after.guarded_adoption_receipt_id).toBe(adopted.receipt.receipt_id);
    const history = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM knowledge_item_versions WHERE item_id = $1`,
      [targetId],
    );
    expect(history.rows[0]!.count).toBe('0');

    const replay = await guarded.adoptLegacy({
      operation_id: 'op-legacy-adoption-regression',
      step_id: 'step-adopt',
      target_id: targetId,
      expected_version: state.item_version!,
      expected_content_sha256: state.content_sha256!,
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.receipt.receipt_id).toBe(adopted.receipt.receipt_id);
    const receiptCount = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM knowledge_guarded_adoption_receipts
        WHERE deterministic_key = $1`,
      [adopted.deterministic_key],
    );
    expect(receiptCount.rows[0]!.count).toBe('1');
    await expect(
      db.query(
        `UPDATE knowledge_guarded_adoption_receipts
            SET code = 'rewritten'
          WHERE receipt_id = $1`,
        [adopted.receipt.receipt_id],
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      db.query(
        `DELETE FROM knowledge_guarded_adoption_receipts WHERE receipt_id = $1`,
        [adopted.receipt.receipt_id],
      ),
    ).rejects.toThrow(/immutable/i);

    const legacyPatch = await fetch(`http://127.0.0.1:${server.port}/v1/notes/${targetId}`, {
      method: 'PATCH',
      headers: {
        'x-api-key': env.HASNA_KNOWLEDGE_API_KEY!,
        'content-type': 'application/json',
        'if-match': '1',
      },
      body: JSON.stringify({ content: 'ordinary-cas-must-not-adopt-or-overwrite' }),
    });
    expect(legacyPatch.status).toBe(404);
    expect((await guarded.readback(targetId)).item.content).toBe(content);
  });

  test('binding-state readback distinguishes legacy, requested, and elsewhere without leaking elsewhere', async () => {
    const legacyId = 'k_fcame_binding_state_legacy';
    const legacy = await createLegacyItem(legacyId, 'legacy binding state') as {
      short_id: string;
    };
    const requestedId = 'k_fcame_binding_state_requested';
    await writer().execute(descriptor({
      operation: 'op-binding-state-requested',
      step: 'step-create',
      target: requestedId,
      payload: { title: 'Requested binding', content: 'requested binding body' },
    }));
    const otherBinding: KnowledgeGuardedBinding = {
      ...BINDING,
      scope: 'project:elsewhere',
      parent_id: 'project:elsewhere',
    };
    const elsewhereId = 'k_fcame_binding_state_elsewhere';
    await writer(otherBinding).execute(descriptor({
      operation: 'op-binding-state-elsewhere',
      step: 'step-create',
      target: elsewhereId,
      binding: otherBinding,
      payload: { title: 'Elsewhere binding', content: 'must not disclose its hash' },
    }));

    const legacyState = await writer().readBindingState(legacyId);
    expect(legacyState.state).toBe('legacy_unbound');
    expect(legacyState.item_version).toBe(1);
    expect(legacyState.content_sha256)
      .toBe(createHash('sha256').update('legacy binding state').digest('hex'));

    const requestedState = await writer().readBindingState(requestedId);
    expect(requestedState.state).toBe('bound_to_requested');
    expect(requestedState.item_version).toBe(1);
    expect(requestedState.content_sha256)
      .toBe(createHash('sha256').update('requested binding body').digest('hex'));

    const elsewhereState = await writer().readBindingState(elsewhereId);
    expect(elsewhereState.state).toBe('bound_elsewhere');
    expect(elsewhereState.item_version).toBeNull();
    expect(elsewhereState.content_sha256).toBeNull();

    const otherTenant = 'tenant-fcame-other';
    const otherTenantWriter = createKnowledgeGuardedWriter({
      binding: { ...BINDING, tenant_id: otherTenant },
      env: {
        ...env,
        HASNA_KNOWLEDGE_API_KEY: mintApiKey({
          app: 'knowledge',
          scopes: ['knowledge:read', 'knowledge:write'],
          tid: otherTenant,
          signingSecret: SIGNING,
        }).token,
      },
    });
    await expect(otherTenantWriter.readBindingState(requestedId)).rejects.toThrow(/404/);
    await expect(writer().readBindingState(legacy.short_id)).rejects.toThrow(/404/);
    await expect(writer().readBindingState('k_fcame_binding_state_absent')).rejects.toThrow(/404/);
  });

  test('cross-tenant and absent adoption targets share one detail-free not-found surface', async () => {
    const otherTenant = 'tenant-fcame-adoption-private';
    const otherBinding: KnowledgeGuardedBinding = {
      ...BINDING,
      tenant_id: otherTenant,
      scope: 'project:adoption-private',
      parent_id: 'project:adoption-private',
    };
    const otherEnv = {
      ...env,
      HASNA_KNOWLEDGE_API_KEY: mintApiKey({
        app: 'knowledge',
        scopes: ['knowledge:read', 'knowledge:write'],
        tid: otherTenant,
        signingSecret: SIGNING,
      }).token,
    };
    const otherWriter = createKnowledgeGuardedWriter({ binding: otherBinding, env: otherEnv });
    const crossTenantId = 'k_fcame_adoption_cross_tenant_private';
    const crossTenantContent = 'cross-tenant adoption content must remain private';
    await otherWriter.execute(descriptor({
      operation: 'op-adoption-cross-tenant-create',
      step: 'step-create',
      target: crossTenantId,
      binding: otherBinding,
      payload: { title: 'Cross-tenant private adoption target', content: crossTenantContent },
    }));
    const before = await itemSnapshot(crossTenantId);
    const missingId = 'k_fcame_adoption_absent_private';
    const expectedContentSha256 = createHash('sha256').update(crossTenantContent).digest('hex');

    const directPost = async (targetId: string, operationId: string) => {
      const deterministicKey = computeKnowledgeGuardedAdoptionDeterministicKey({
        action: 'adopt',
        operation_id: operationId,
        step_id: 'step-adopt',
        target_id: targetId,
        binding: BINDING,
        expected_version: 1,
        expected_content_sha256: expectedContentSha256,
        adoption_receipt_id: null,
      });
      const submission = DEFAULT_KNOWLEDGE_GUARDED_LIMITS.submission;
      return fetch(`http://127.0.0.1:${server.port}/v1/guarded-adoptions`, {
        method: 'POST',
        headers: {
          'x-api-key': env.HASNA_KNOWLEDGE_API_KEY!,
          'x-knowledge-tenant-id': TENANT,
          'content-type': 'application/json',
          'idempotency-key': deterministicKey,
          'x-knowledge-max-calls': String(submission.max_calls),
          'x-knowledge-max-items': String(submission.max_items),
          'x-knowledge-max-bytes': String(submission.max_bytes),
          'x-knowledge-wall-time-ms': String(submission.wall_time_ms),
        },
        body: JSON.stringify({
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          action: 'adopt',
          deterministic_key: deterministicKey,
          operation_id: operationId,
          step_id: 'step-adopt',
          target_id: targetId,
          binding: BINDING,
          expected_version: 1,
          expected_content_sha256: expectedContentSha256,
          adoption_receipt_id: null,
          limits: DEFAULT_KNOWLEDGE_GUARDED_LIMITS,
        }),
      });
    };

    const crossTenantResponse = await directPost(
      crossTenantId,
      'op-adoption-cross-tenant-direct-private',
    );
    const absentResponse = await directPost(missingId, 'op-adoption-absent-direct-private');
    expect(crossTenantResponse.status).toBe(404);
    expect(absentResponse.status).toBe(404);
    expect(await crossTenantResponse.json()).toEqual({ error: 'not_found' });
    expect(await absentResponse.json()).toEqual({ error: 'not_found' });

    const sdkErrors: unknown[] = [];
    for (const [targetId, operationId] of [
      [crossTenantId, 'op-adoption-cross-tenant-sdk-private'],
      [missingId, 'op-adoption-absent-sdk-private'],
    ] as const) {
      try {
        await writer().adoptLegacy({
          operation_id: operationId,
          step_id: 'step-adopt',
          target_id: targetId,
          expected_version: 1,
          expected_content_sha256: expectedContentSha256,
        });
      } catch (error) {
        sdkErrors.push(error);
      }
    }
    expect(sdkErrors).toHaveLength(2);
    for (const error of sdkErrors) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/404/);
      expect('receipt' in (error as object)).toBe(false);
    }
    expect(await itemSnapshot(crossTenantId)).toEqual(before);
    expect((await db.query(`SELECT 1 FROM knowledge_items WHERE id = $1`, [missingId])).rows)
      .toHaveLength(0);
  });

  test('legacy adoption rejects binding, version, and content-SHA conflicts without effects', async () => {
    const otherBinding: KnowledgeGuardedBinding = {
      ...BINDING,
      scope: 'project:adoption-conflict',
      parent_id: 'project:adoption-conflict',
    };
    const boundId = 'k_fcame_adoption_conflict_binding';
    await writer(otherBinding).execute(descriptor({
      operation: 'op-adoption-conflict-binding-create',
      step: 'step-create',
      target: boundId,
      binding: otherBinding,
      payload: { title: 'Bound elsewhere', content: 'bound elsewhere body' },
    }));
    const versionId = 'k_fcame_adoption_conflict_version';
    await createLegacyItem(versionId, 'version conflict body');
    const hashId = 'k_fcame_adoption_conflict_hash';
    await createLegacyItem(hashId, 'hash conflict body');

    const cases = [
      {
        name: 'binding',
        target: boundId,
        version: 1,
        sha: createHash('sha256').update('bound elsewhere body').digest('hex'),
        code: 'binding_mismatch',
      },
      {
        name: 'version',
        target: versionId,
        version: 2,
        sha: createHash('sha256').update('version conflict body').digest('hex'),
        code: 'version_conflict',
      },
      {
        name: 'hash',
        target: hashId,
        version: 1,
        sha: '0'.repeat(64),
        code: 'content_digest_conflict',
      },
    ] as const;

    for (const item of cases) {
      const before = await itemSnapshot(item.target);
      let caught: unknown = null;
      try {
        await writer().adoptLegacy({
          operation_id: `op-adoption-conflict-${item.name}`,
          step_id: 'step-adopt',
          target_id: item.target,
          expected_version: item.version,
          expected_content_sha256: item.sha,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(KnowledgeGuardedAdoptionRejectedError);
      expect((caught as KnowledgeGuardedAdoptionRejectedError).receipt.code).toBe(item.code);
      expect((caught as KnowledgeGuardedAdoptionRejectedError).receipt.effect_count).toBe(0);
      expect(await itemSnapshot(item.target)).toEqual(before);
    }
  });

  test('database trigger refuses stale or content-mutating live-looking adoption claims', async () => {
    const insertClaim = async (options: {
      target: string;
      operation: string;
      version: number;
      contentSha: string;
    }) => {
      const deterministicKey = computeKnowledgeGuardedAdoptionDeterministicKey({
        action: 'adopt',
        operation_id: options.operation,
        step_id: 'step-adopt',
        target_id: options.target,
        binding: BINDING,
        expected_version: options.version,
        expected_content_sha256: options.contentSha,
        adoption_receipt_id: null,
      });
      await db.query(
        `INSERT INTO knowledge_guarded_adoption_claims (
           deterministic_key, planned_receipt_id, operation_id, step_id, action, target_id,
           authority_classification, authority_id, tenant_id, scope, parent_id,
           expected_version, expected_content_sha256, adoption_receipt_id
         ) VALUES ($1,$2,$3,'step-adopt','adopt',$4,$5,$6,$7,$8,$9,$10,$11,NULL)`,
        [
          deterministicKey,
          computeKnowledgeGuardedAdoptionReceiptId(deterministicKey),
          options.operation,
          options.target,
          BINDING.authority.classification,
          BINDING.authority.authority_id,
          BINDING.tenant_id,
          BINDING.scope,
          BINDING.parent_id,
          options.version,
          options.contentSha,
        ],
      );
      return deterministicKey;
    };

    const contentTarget = 'k_fcame_adoption_trigger_content_change';
    const content = 'trigger-protected legacy content';
    await createLegacyItem(contentTarget, content);
    const contentKey = await insertClaim({
      target: contentTarget,
      operation: 'op-adoption-trigger-content-change',
      version: 1,
      contentSha: createHash('sha256').update(content).digest('hex'),
    });
    await db.query(
      `SELECT set_config('hasna.knowledge_guarded_adoption_key', $1, false)`,
      [contentKey],
    );
    try {
      await expect(db.query(
        `UPDATE knowledge_items SET
           content = 'must-not-change-during-adoption',
           authority_classification = $1,
           authority_id = $2,
           tenant_id = $3,
           scope = $4,
           parent_id = $5,
           guarded_adoption_receipt_id = $6
         WHERE id = $7`,
        [
          BINDING.authority.classification,
          BINDING.authority.authority_id,
          BINDING.tenant_id,
          BINDING.scope,
          BINDING.parent_id,
          computeKnowledgeGuardedAdoptionReceiptId(contentKey),
          contentTarget,
        ],
      )).rejects.toThrow(/does not match its live adoption claim/i);
    } finally {
      await db.query(`SELECT set_config('hasna.knowledge_guarded_adoption_key', '', false)`);
    }
    expect((await itemSnapshot(contentTarget)).content).toBe(content);

    const staleTarget = 'k_fcame_adoption_trigger_stale_version';
    const staleContent = 'stale-version legacy content';
    await createLegacyItem(staleTarget, staleContent);
    const staleKey = await insertClaim({
      target: staleTarget,
      operation: 'op-adoption-trigger-stale-version',
      version: 2,
      contentSha: createHash('sha256').update(staleContent).digest('hex'),
    });
    await db.query(
      `SELECT set_config('hasna.knowledge_guarded_adoption_key', $1, false)`,
      [staleKey],
    );
    try {
      await expect(db.query(
        `UPDATE knowledge_items SET
           authority_classification = $1,
           authority_id = $2,
           tenant_id = $3,
           scope = $4,
           parent_id = $5,
           guarded_adoption_receipt_id = $6
         WHERE id = $7`,
        [
          BINDING.authority.classification,
          BINDING.authority.authority_id,
          BINDING.tenant_id,
          BINDING.scope,
          BINDING.parent_id,
          computeKnowledgeGuardedAdoptionReceiptId(staleKey),
          staleTarget,
        ],
      )).rejects.toThrow(/does not match its live adoption claim/i);
    } finally {
      await db.query(`SELECT set_config('hasna.knowledge_guarded_adoption_key', '', false)`);
    }
    expect((await writer().readBindingState(staleTarget)).state).toBe('legacy_unbound');
  });

  test('database trigger refuses a primary-key change under a valid live adoption claim', async () => {
    const target = 'k_fcame_adoption_trigger_primary_key';
    const replacement = 'k_fcame_adoption_trigger_primary_key_replacement';
    const content = 'primary-key-stable legacy content';
    await createLegacyItem(target, content);
    const before = await itemSnapshot(target);
    const deterministicKey = computeKnowledgeGuardedAdoptionDeterministicKey({
      action: 'adopt',
      operation_id: 'op-adoption-trigger-primary-key-change',
      step_id: 'step-adopt',
      target_id: target,
      binding: BINDING,
      expected_version: 1,
      expected_content_sha256: createHash('sha256').update(content).digest('hex'),
      adoption_receipt_id: null,
    });
    const receiptId = computeKnowledgeGuardedAdoptionReceiptId(deterministicKey);
    await db.query(
      `INSERT INTO knowledge_guarded_adoption_claims (
         deterministic_key, planned_receipt_id, operation_id, step_id, action, target_id,
         authority_classification, authority_id, tenant_id, scope, parent_id,
         expected_version, expected_content_sha256, adoption_receipt_id
       ) VALUES ($1,$2,'op-adoption-trigger-primary-key-change','step-adopt','adopt',
                 $3,$4,$5,$6,$7,$8,1,$9,NULL)`,
      [
        deterministicKey,
        receiptId,
        target,
        BINDING.authority.classification,
        BINDING.authority.authority_id,
        BINDING.tenant_id,
        BINDING.scope,
        BINDING.parent_id,
        createHash('sha256').update(content).digest('hex'),
      ],
    );
    await db.query(
      `SELECT set_config('hasna.knowledge_guarded_adoption_key', $1, false)`,
      [deterministicKey],
    );
    try {
      await expect(db.query(
        `UPDATE knowledge_items SET
           id = $1,
           authority_classification = $2,
           authority_id = $3,
           tenant_id = $4,
           scope = $5,
           parent_id = $6,
           guarded_adoption_receipt_id = $7
         WHERE id = $8`,
        [
          replacement,
          BINDING.authority.classification,
          BINDING.authority.authority_id,
          BINDING.tenant_id,
          BINDING.scope,
          BINDING.parent_id,
          receiptId,
          target,
        ],
      )).rejects.toThrow(/identity and binding are immutable/i);
    } finally {
      await db.query(`SELECT set_config('hasna.knowledge_guarded_adoption_key', '', false)`);
    }

    expect(await itemSnapshot(target)).toEqual(before);
    expect((await writer().readBindingState(target)).state).toBe('legacy_unbound');
    expect((await db.query(
      `SELECT 1 FROM knowledge_items WHERE id = $1`,
      [replacement],
    )).rows).toHaveLength(0);
  });

  test('adoption claim binds only its planned receipt once', async () => {
    const unrelatedKey = computeKnowledgeGuardedAdoptionDeterministicKey({
      action: 'adopt',
      operation_id: 'op-adoption-claim-unrelated-receipt',
      step_id: 'step-adopt',
      target_id: 'k_fcame_adoption_claim_unrelated_receipt',
      binding: BINDING,
      expected_version: 1,
      expected_content_sha256: '1'.repeat(64),
      adoption_receipt_id: null,
    });
    const unrelatedReceiptId = computeKnowledgeGuardedAdoptionReceiptId(unrelatedKey);
    await db.query(
      `INSERT INTO knowledge_guarded_adoption_receipts (
         receipt_id, deterministic_key, operation_id, step_id, action, target_id,
         authority_classification, authority_id, tenant_id, scope, parent_id,
         expected_version, expected_content_sha256, adoption_receipt_id, prior_tenant_id,
         status, code, effect_count, result_version, result_content_sha256
       ) VALUES ($1,$2,$3,'step-adopt','adopt',$4,$5,$6,$7,$8,$9,1,$10,NULL,NULL,
                 'rejected','not_found',0,NULL,NULL)`,
      [
        unrelatedReceiptId,
        unrelatedKey,
        'op-adoption-claim-unrelated-receipt',
        'k_fcame_adoption_claim_unrelated_receipt',
        BINDING.authority.classification,
        BINDING.authority.authority_id,
        BINDING.tenant_id,
        BINDING.scope,
        BINDING.parent_id,
        '1'.repeat(64),
      ],
    );

    const claimKey = computeKnowledgeGuardedAdoptionDeterministicKey({
      action: 'adopt',
      operation_id: 'op-adoption-claim-planned-receipt',
      step_id: 'step-adopt',
      target_id: 'k_fcame_adoption_claim_planned_receipt',
      binding: BINDING,
      expected_version: 1,
      expected_content_sha256: '2'.repeat(64),
      adoption_receipt_id: null,
    });
    const plannedReceiptId = computeKnowledgeGuardedAdoptionReceiptId(claimKey);
    await db.query(
      `INSERT INTO knowledge_guarded_adoption_claims (
         deterministic_key, planned_receipt_id, operation_id, step_id, action, target_id,
         authority_classification, authority_id, tenant_id, scope, parent_id,
         expected_version, expected_content_sha256, adoption_receipt_id
       ) VALUES ($1,$2,$3,'step-adopt','adopt',$4,$5,$6,$7,$8,$9,1,$10,NULL)`,
      [
        claimKey,
        plannedReceiptId,
        'op-adoption-claim-planned-receipt',
        'k_fcame_adoption_claim_planned_receipt',
        BINDING.authority.classification,
        BINDING.authority.authority_id,
        BINDING.tenant_id,
        BINDING.scope,
        BINDING.parent_id,
        '2'.repeat(64),
      ],
    );

    await expect(db.query(
      `UPDATE knowledge_guarded_adoption_claims SET receipt_id = $1
        WHERE deterministic_key = $2`,
      [unrelatedReceiptId, claimKey],
    )).rejects.toThrow(/must match its planned terminal receipt/i);
    await db.query(
      `UPDATE knowledge_guarded_adoption_claims SET receipt_id = $1
        WHERE deterministic_key = $2`,
      [plannedReceiptId, claimKey],
    );
    const bound = await db.query<{ receipt_id: string }>(
      `SELECT receipt_id FROM knowledge_guarded_adoption_claims WHERE deterministic_key = $1`,
      [claimKey],
    );
    expect(bound.rows[0]!.receipt_id).toBe(plannedReceiptId);
    await expect(db.query(
      `UPDATE knowledge_guarded_adoption_claims SET receipt_id = $1
        WHERE deterministic_key = $2`,
      [unrelatedReceiptId, claimKey],
    )).rejects.toThrow(/may only bind one terminal receipt/i);
  });

  test('receipt-scoped rollback is conditional, idempotent, and cannot roll back a later adoption', async () => {
    const targetId = 'k_fcame_adoption_rollback';
    const content = 'rollback-stable legacy body';
    await createLegacyItem(targetId, content);
    const state = await writer().readBindingState(targetId);
    const first = await writer().adoptLegacy({
      operation_id: 'op-adoption-rollback-first',
      step_id: 'step-adopt',
      target_id: targetId,
      expected_version: state.item_version!,
      expected_content_sha256: state.content_sha256!,
    });
    const rolledBack = await writer().rollbackLegacyAdoption({
      operation_id: 'op-adoption-rollback-first',
      step_id: 'step-rollback',
      adoption_receipt: first.receipt,
    });
    expect(rolledBack.receipt.code).toBe('rolled_back');
    expect(rolledBack.binding_state.state).toBe('legacy_unbound');
    expect(rolledBack.binding_state.item_version).toBe(1);
    expect(rolledBack.binding_state.content_sha256)
      .toBe(createHash('sha256').update(content).digest('hex'));
    const rollbackReplay = await writer().rollbackLegacyAdoption({
      operation_id: 'op-adoption-rollback-first',
      step_id: 'step-rollback',
      adoption_receipt: first.receipt,
    });
    expect(rollbackReplay.duplicate).toBe(true);
    expect(rollbackReplay.receipt.receipt_id).toBe(rolledBack.receipt.receipt_id);

    const second = await writer().adoptLegacy({
      operation_id: 'op-adoption-rollback-second',
      step_id: 'step-adopt',
      target_id: targetId,
      expected_version: 1,
      expected_content_sha256: createHash('sha256').update(content).digest('hex'),
    });
    expect(second.receipt.receipt_id).not.toBe(first.receipt.receipt_id);
    let staleReceipt: unknown = null;
    try {
      await writer().rollbackLegacyAdoption({
        operation_id: 'op-adoption-rollback-stale-receipt',
        step_id: 'step-rollback',
        adoption_receipt: first.receipt,
      });
    } catch (error) {
      staleReceipt = error;
    }
    expect(staleReceipt).toBeInstanceOf(KnowledgeGuardedAdoptionRejectedError);
    expect((staleReceipt as KnowledgeGuardedAdoptionRejectedError).receipt.code)
      .toBe('adoption_receipt_not_current');
    expect((await writer().readback(targetId)).item.content).toBe(content);
  });

  test('rollback refuses a row changed after adoption', async () => {
    const targetId = 'k_fcame_adoption_rollback_stale_content';
    await createLegacyItem(targetId, 'before guarded update');
    const state = await writer().readBindingState(targetId);
    const adoption = await writer().adoptLegacy({
      operation_id: 'op-adoption-stale-content',
      step_id: 'step-adopt',
      target_id: targetId,
      expected_version: state.item_version!,
      expected_content_sha256: state.content_sha256!,
    });
    await writer().execute(descriptor({
      operation: 'op-adoption-stale-content-update',
      step: 'step-update',
      target: targetId,
      verb: 'update',
      version: 1,
      payload: { content: 'after guarded update' },
    }));

    let caught: unknown = null;
    try {
      await writer().rollbackLegacyAdoption({
        operation_id: 'op-adoption-stale-content',
        step_id: 'step-rollback',
        adoption_receipt: adoption.receipt,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeGuardedAdoptionRejectedError);
    expect((caught as KnowledgeGuardedAdoptionRejectedError).receipt.code).toBe('version_conflict');
    expect((await writer().readback(targetId)).item.content).toBe('after guarded update');
  });

  test('adoption reconciles a committed POST whose response is lost', async () => {
    const targetId = 'k_fcame_adoption_lost_response';
    const content = 'committed before response loss';
    await createLegacyItem(targetId, content);
    const state = await writer().readBindingState(targetId);
    const originalFetch = globalThis.fetch;
    let dropped = false;
    globalThis.fetch = (async (input, init) => {
      const response = await originalFetch(input, init);
      if (!dropped && init?.method === 'POST' && String(input).includes('/v1/guarded-adoptions')) {
        dropped = true;
        throw new Error('simulated response loss after committed adoption');
      }
      return response;
    }) as typeof fetch;
    try {
      const adopted = await writer().adoptLegacy({
        operation_id: 'op-adoption-lost-response',
        step_id: 'step-adopt',
        target_id: targetId,
        expected_version: state.item_version!,
        expected_content_sha256: state.content_sha256!,
      });
      expect(dropped).toBe(true);
      expect(adopted.receipt.code).toBe('adopted');
      const replay = await writer().adoptLegacy({
        operation_id: 'op-adoption-lost-response',
        step_id: 'step-adopt',
        target_id: targetId,
        expected_version: state.item_version!,
        expected_content_sha256: state.content_sha256!,
      });
      expect(replay.duplicate).toBe(true);
      expect(replay.receipt.receipt_id).toBe(adopted.receipt.receipt_id);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('adoption read and reconciliation phases enforce finite limits', async () => {
    const targetId = 'k_fcame_adoption_bounds';
    await createLegacyItem(targetId, 'bounded adoption body');
    await expect(writer().readBindingState(
      targetId,
      { max_calls: 2, max_items: 1, max_bytes: 4096, wall_time_ms: 1000 },
    )).rejects.toThrow(/max_calls/);
    await expect(writer().readBindingState(
      targetId,
      { max_calls: 1, max_items: 1, max_bytes: 1, wall_time_ms: 1000 },
    )).rejects.toThrow();
    await expect(writer().reconcileAdoption(
      `fcame1_adoption_${'0'.repeat(64)}`,
      'op-bounds',
      'step-bounds',
      { max_calls: 2, max_items: 1, max_bytes: 4096, wall_time_ms: 1000 },
    )).rejects.toThrow(/max_calls/);
    const state = await writer().readBindingState(targetId);
    const tiny = createKnowledgeGuardedWriter({
      binding: BINDING,
      env,
      limits: {
        submission: { max_calls: 1, max_items: 1, max_bytes: 1, wall_time_ms: 1000 },
      },
    });
    await expect(tiny.adoptLegacy({
      operation_id: 'op-adoption-bounds',
      step_id: 'step-adopt',
      target_id: targetId,
      expected_version: state.item_version!,
      expected_content_sha256: state.content_sha256!,
    })).rejects.toThrow(/byte_cap/);
    const claims = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM knowledge_guarded_adoption_claims
        WHERE operation_id = 'op-adoption-bounds'`,
    );
    expect(claims.rows[0]!.count).toBe('0');
  });

  test('REGRESSION: guarded item authority trigger matches TEXT claims to TEXT and UUID tenant ids', async () => {
    for (const variant of [
      {
        tenantIdType: 'text' as const,
        migrationMode: 'direct' as const,
        tenantId: TENANT,
        targetId: 'k_fcame_text_tenant_guarded_create',
      },
      {
        tenantIdType: 'uuid' as const,
        migrationMode: 'direct' as const,
        tenantId: '22222222-2222-4222-8222-222222222222',
        targetId: 'k_fcame_uuid_tenant_guarded_create_fresh',
      },
      {
        tenantIdType: 'uuid' as const,
        migrationMode: 'existing-ledger-upgrade' as const,
        tenantId: '33333333-3333-4333-8333-333333333333',
        targetId: 'k_fcame_uuid_tenant_guarded_create_upgrade',
      },
    ]) {
      const created = await createMigratedPglite({
        knowledgeItemsTenantIdType: variant.tenantIdType,
        migrationMode: variant.migrationMode,
      });
      const client = created.client;
      const store = new ApiKeyStore(client);
      const verifier = verifyApiKey({
        app: 'knowledge',
        signingSecret: SIGNING,
        keyStatus: () => Promise.resolve('active' as const),
      });
      const binding: KnowledgeGuardedBinding = {
        ...BINDING,
        tenant_id: variant.tenantId,
      };
      const variantServer = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: createServeHandler({
          client,
          verifier,
          store,
          version: '9.9.9',
          guardedAuthority: AUTHORITY,
        }),
      });
      try {
        const variantWriter = createKnowledgeGuardedWriter({
          binding,
          env: {
            NODE_ENV: 'test',
            HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${variantServer.port}`,
            HASNA_KNOWLEDGE_API_KEY: mintApiKey({
              app: 'knowledge',
              scopes: ['knowledge:read', 'knowledge:write'],
              tid: variant.tenantId,
              signingSecret: SIGNING,
            }).token,
          },
        });
        const result = await variantWriter.execute(descriptor({
          operation: `op-${variant.tenantIdType}-${variant.migrationMode}-tenant-guarded-create`,
          step: 'step-create',
          target: variant.targetId,
          binding,
          payload: {
            title: `${variant.tenantIdType.toUpperCase()} tenant guarded create`,
            content: `${variant.tenantIdType} tenant guarded trigger accepts its live claim`,
          },
        }));

        expect(result.receipt.status).toBe('accepted');
        expect(result.receipt.effect_count).toBe(1);
        expect(result.readback.item.id).toBe(variant.targetId);
        expect(result.readback.item.content)
          .toBe(`${variant.tenantIdType} tenant guarded trigger accepts its live claim`);
      } finally {
        variantServer.stop(true);
        await created.db.close();
      }
    }
  }, budget(10_000));

  test('legacy adoption works on fresh TEXT/UUID schemas and a pre-adoption ledger upgrade', async () => {
    for (const variant of [
      {
        tenantIdType: 'text' as const,
        migrationMode: 'direct' as const,
        tenantId: TENANT,
        targetId: 'k_fcame_adoption_text_fresh',
      },
      {
        tenantIdType: 'uuid' as const,
        migrationMode: 'direct' as const,
        tenantId: '44444444-4444-4444-8444-444444444444',
        targetId: 'k_fcame_adoption_uuid_fresh',
      },
      {
        tenantIdType: 'uuid' as const,
        migrationMode: 'pre-adoption-ledger-upgrade' as const,
        tenantId: '55555555-5555-4555-8555-555555555555',
        targetId: 'k_fcame_adoption_uuid_upgrade',
      },
    ]) {
      const created = await createMigratedPglite({
        knowledgeItemsTenantIdType: variant.tenantIdType,
        migrationMode: variant.migrationMode,
      });
      const client = created.client;
      const store = new ApiKeyStore(client);
      const verifier = verifyApiKey({
        app: 'knowledge',
        signingSecret: SIGNING,
        keyStatus: () => Promise.resolve('active' as const),
      });
      const binding: KnowledgeGuardedBinding = {
        ...BINDING,
        tenant_id: variant.tenantId,
      };
      const variantServer = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: createServeHandler({
          client,
          verifier,
          store,
          version: '9.9.9',
          guardedAuthority: AUTHORITY,
        }),
      });
      try {
        const content = `${variant.tenantIdType}:${variant.migrationMode}:legacy`;
        await created.db.query(
          `INSERT INTO knowledge_items (
             id, short_id, title, content, url, tags, metadata, archived,
             created_at, updated_at, tenant_id
           ) VALUES ($1,$2,$3,$4,NULL,'[]'::jsonb,'{}'::jsonb,FALSE,$5,$5,$6)`,
          [
            variant.targetId,
            `short_${variant.targetId}`,
            `Legacy ${variant.targetId}`,
            content,
            '2026-08-09T00:00:00.000Z',
            variant.tenantId,
          ],
        );
        const variantWriter = createKnowledgeGuardedWriter({
          binding,
          env: {
            NODE_ENV: 'test',
            HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${variantServer.port}`,
            HASNA_KNOWLEDGE_API_KEY: mintApiKey({
              app: 'knowledge',
              scopes: ['knowledge:read', 'knowledge:write'],
              tid: variant.tenantId,
              signingSecret: SIGNING,
            }).token,
          },
        });
        const state = await variantWriter.readBindingState(variant.targetId);
        expect(state.state).toBe('legacy_unbound');
        const adopted = await variantWriter.adoptLegacy({
          operation_id: `op-${variant.targetId}`,
          step_id: 'step-adopt',
          target_id: variant.targetId,
          expected_version: 1,
          expected_content_sha256: createHash('sha256').update(content).digest('hex'),
        });
        expect(adopted.receipt.prior_tenant_id).toBe(variant.tenantId);
        const rolledBack = await variantWriter.rollbackLegacyAdoption({
          operation_id: `op-${variant.targetId}`,
          step_id: 'step-rollback',
          adoption_receipt: adopted.receipt,
        });
        expect(rolledBack.binding_state.state).toBe('legacy_unbound');
        const restored = await created.db.query<{ tenant_id: string }>(
          `SELECT tenant_id::text AS tenant_id FROM knowledge_items WHERE id = $1`,
          [variant.targetId],
        );
        expect(restored.rows[0]!.tenant_id).toBe(variant.tenantId);
      } finally {
        variantServer.stop(true);
        await created.db.close();
      }
    }
  }, budget(10_000));

  test('accepted create uses a protected descriptor and exact full-ID readback', async () => {
    const privateBody = 'private doctrine body accepted create';
    const input = descriptor({
      operation: 'op-accepted-create',
      step: 'step-create',
      target: 'k_fcame_accepted_create_full_id',
      payload: { title: 'Accepted create', content: privateBody, tags: ['doctrine'] },
    });

    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain(privateBody);
    expect(serialized).toContain(input.payload_digest);
    expect(Object.isFrozen(input.toJSON())).toBe(true);
    expect('materializeKnowledgePrivateInput' in publicApi).toBe(false);

    const result = await writer().execute(input);
    expect(result.duplicate).toBe(false);
    expect(result.receipt.status).toBe('accepted');
    expect(result.receipt.code).toBe('created');
    expect(result.receipt.effect_count).toBe(1);
    expect(result.readback.item.id).toBe(input.target_id);
    expect(result.readback.item.content).toBe(privateBody);

    const boundClaim = await db.query<{ receipt_id: string }>(
      `SELECT receipt_id
         FROM knowledge_guarded_write_claims
        WHERE deterministic_key = $1`,
      [result.receipt.deterministic_key],
    );
    expect(boundClaim.rows).toHaveLength(1);
    expect(boundClaim.rows[0]!.receipt_id).toBe(result.receipt.receipt_id);

    await expect(writer().readback(result.readback.item.short_id!)).rejects.toThrow();
  });

  test('private write and exact readback descriptors expose digests, never private fields or handles', async () => {
    const targetId = 'k_fcame_private_result_descriptor';
    const title = 'Private result descriptor title';
    const content = 'private result descriptor body';
    const tags = ['doctrine', 'private-result'];
    const metadata = { source: 'reviewed-canonical-source', privacy_class: 'internal-redacted' };
    const input = descriptor({
      operation: 'op-private-result-descriptor',
      step: 'step-create',
      target: targetId,
      payload: { title, content, tags, metadata },
    });

    const privateResult = await writer().executePrivate(input);
    const serialized = JSON.stringify(privateResult);
    expect(serialized).not.toContain(title);
    expect(serialized).not.toContain(content);
    expect(serialized).not.toContain(targetId);
    expect(serialized).not.toContain(privateResult.descriptor_id);
    expect(serialized).toContain(privateResult.result_digest);

    const proof = inspectKnowledgePrivateResult(privateResult);
    expect(proof.kind).toBe('write');
    expect(proof.item_count).toBe(1);
    expect(proof.items).toEqual([{
      id: targetId,
      version: 1,
      title_sha256: createHash('sha256').update(title).digest('hex'),
      content_sha256: createHash('sha256').update(content).digest('hex'),
      url_sha256: null,
      tags_sha256: knowledgeGuardedDigest(tags),
      metadata_sha256: knowledgeGuardedDigest(metadata),
      archived: false,
    }]);
    expect(JSON.stringify(proof)).not.toContain(title);
    expect(JSON.stringify(proof)).not.toContain(content);

    const exact = await writer().readbackPrivate(targetId);
    expect(inspectKnowledgePrivateResult(exact).items).toEqual(proof.items);

    const replay = await writer().executePrivate(input);
    const replayProof = inspectKnowledgePrivateResult(replay);
    expect(replayProof.duplicate).toBe(true);
    expect(replayProof.receipt_id).toBe(proof.receipt_id);
    expect(replayProof.items).toEqual(proof.items);
  });

  test('private title lookup is authoritative, bounded, exact-scope, and ambiguity refusing', async () => {
    const title = 'Private title lookup target';
    const targetId = 'k_fcame_private_title_lookup';
    await writer().execute(descriptor({
      operation: 'op-private-title-lookup-create',
      step: 'step-create',
      target: targetId,
      payload: { title, content: 'private title lookup body' },
    }));

    const lookup = createKnowledgePrivateTitleLookupDescriptor({
      operation_id: 'op-private-title-lookup',
      step_id: 'step-lookup',
      binding: BINDING,
      title,
    });
    const serializedLookup = JSON.stringify(lookup);
    expect(serializedLookup).not.toContain(title);
    expect(serializedLookup).not.toContain(lookup.descriptor_id);
    expect(serializedLookup).toContain(lookup.title_digest);

    const result = await writer().lookupTitle(lookup);
    const proof = inspectKnowledgePrivateResult(result);
    expect(proof.kind).toBe('title_lookup');
    expect(proof.item_count).toBe(1);
    const firstProofItem = proof.items[0];
    expect(firstProofItem && 'id' in firstProofItem ? firstProofItem.id : undefined).toBe(targetId);
    expect(proof.items[0]?.title_sha256).toBe(lookup.title_digest);
    expect(JSON.stringify(result)).not.toContain(title);
    expect(JSON.stringify(proof)).not.toContain(title);

    const wrongScope = createKnowledgeGuardedWriter({
      binding: { ...BINDING, scope: 'project:wrong', parent_id: 'project:wrong' },
      env,
    });
    await expect(wrongScope.lookupTitle(lookup)).rejects.toThrow(/binding/i);

    const expired = createKnowledgePrivateTitleLookupDescriptor({
      operation_id: 'op-private-title-lookup-expired',
      step_id: 'step-lookup',
      binding: BINDING,
      title,
      expires_in_ms: 1,
    });
    await Bun.sleep(5);
    await expect(writer().lookupTitle(expired)).rejects.toThrow(/expired/i);

    await writer().execute(descriptor({
      operation: 'op-private-title-lookup-duplicate',
      step: 'step-create',
      target: 'k_fcame_private_title_lookup_duplicate',
      payload: { title, content: 'second item with the same title' },
    }));
    const ambiguous = createKnowledgePrivateTitleLookupDescriptor({
      operation_id: 'op-private-title-lookup-ambiguous',
      step_id: 'step-lookup',
      binding: BINDING,
      title,
    });
    await expect(writer().lookupTitle(ambiguous)).rejects.toThrow(/ambiguous/i);
  });

  test('private bounded queries cover every selector with archive, page, tenant, and proof privacy', async () => {
    const baseId = 'k_private_query_base';
    const canonicalId = 'k_private_query_canonical';
    const successorId = 'k_private_query_successor';
    const versionedId = 'k_private_query_versioned';
    const archivedId = 'k_private_query_archived';
    const duplicateTitle = 'Private bounded duplicate title';
    const lexical = 'private bounded lexical phrase';
    const guarded = writer();

    for (const input of [
      descriptor({
        operation: 'op-private-query-base',
        step: 'step-create',
        target: baseId,
        payload: { title: duplicateTitle, content: `${lexical} base body` },
      }),
      descriptor({
        operation: 'op-private-query-canonical',
        step: 'step-create',
        target: canonicalId,
        payload: { title: 'Private canonical item', content: 'canonical body' },
      }),
      descriptor({
        operation: 'op-private-query-successor',
        step: 'step-create',
        target: successorId,
        payload: {
          title: duplicateTitle,
          content: `${lexical} successor body`,
          metadata: {
            [KNOWLEDGE_RELATIONS_METADATA_KEY]: {
              schema: KNOWLEDGE_RELATIONS_SCHEMA,
              supersedes_item_id: baseId,
              canonical_item_id: canonicalId,
            },
          },
        },
      }),
      descriptor({
        operation: 'op-private-query-versioned',
        step: 'step-create',
        target: versionedId,
        payload: { title: 'Private version one', content: 'historical body one' },
      }),
      descriptor({
        operation: 'op-private-query-archived',
        step: 'step-create',
        target: archivedId,
        payload: { title: 'Private archived query item', content: 'archived body' },
      }),
    ]) {
      await guarded.execute(input);
    }
    await guarded.execute(descriptor({
      operation: 'op-private-query-versioned-update',
      step: 'step-update',
      target: versionedId,
      verb: 'update',
      version: 1,
      payload: { title: 'Private version two', content: 'current body two' },
    }));
    await guarded.execute(descriptor({
      operation: 'op-private-query-archive-update',
      step: 'step-update',
      target: archivedId,
      verb: 'update',
      version: 1,
      payload: { archived: true },
    }));

    const otherTenant = 'tenant-private-query-other';
    const otherBinding = { ...BINDING, tenant_id: otherTenant };
    const otherEnv = {
      ...env,
      HASNA_KNOWLEDGE_API_KEY: mintApiKey({
        app: 'knowledge',
        scopes: ['knowledge:read', 'knowledge:write'],
        tid: otherTenant,
        signingSecret: SIGNING,
      }).token,
    };
    await expect(
      createKnowledgeGuardedWriter({ binding: otherBinding, env: otherEnv }).execute(
        descriptor({
        operation: 'op-private-query-other-tenant',
        step: 'step-create',
        target: 'k_private_query_other_tenant',
        binding: otherBinding,
        payload: {
          title: 'Cross-tenant relation collision',
          content: lexical,
          metadata: {
            [KNOWLEDGE_RELATIONS_METADATA_KEY]: {
              schema: KNOWLEDGE_RELATIONS_SCHEMA,
              supersedes_item_id: baseId,
              canonical_item_id: canonicalId,
            },
          },
        },
        }),
      ),
    ).rejects.toMatchObject({
      receipt: { code: 'relation_binding_mismatch', effect_count: 0 },
    });

    const cases = [
      {
        kind: 'exact_title' as const,
        selector: { kind: 'exact_title' as const, title: duplicateTitle },
        expectedTotal: 2,
      },
      {
        kind: 'lexical_overlap' as const,
        selector: { kind: 'lexical_overlap' as const, query: lexical },
        expectedTotal: 2,
      },
      {
        kind: 'supersession' as const,
        selector: { kind: 'supersession' as const, supersedes_item_id: baseId },
        expectedTotal: 1,
      },
      {
        kind: 'current_version' as const,
        selector: { kind: 'current_version' as const, item_id: versionedId },
        expectedTotal: 1,
      },
      {
        kind: 'historical_version' as const,
        selector: { kind: 'historical_version' as const, item_id: versionedId, version: 1 },
        expectedTotal: 1,
      },
      {
        kind: 'canonical_pointer' as const,
        selector: { kind: 'canonical_pointer' as const, canonical_item_id: canonicalId },
        expectedTotal: 1,
      },
    ];

    for (const [index, entry] of cases.entries()) {
      const rawSelector = Object.values(entry.selector).slice(1).join(':');
      const query = createKnowledgePrivateQueryDescriptor({
        operation_id: `op-private-query-${entry.kind}`,
        step_id: `step-query-${index}`,
        binding: BINDING,
        selector: entry.selector,
        limit: entry.kind === 'exact_title' ? 1 : 2,
      });
      const serialized = JSON.stringify(query);
      expect(serialized).not.toContain(rawSelector);
      expect(serialized).not.toContain(query.descriptor_id);
      const result = await guarded.query(query);
      const proof = inspectKnowledgePrivateResult(result);
      expect(proof.kind).toBe('query');
      expect(proof.query_kind).toBe(entry.kind);
      expect(proof.total).toBe(entry.expectedTotal);
      expect(proof.item_count).toBeLessThanOrEqual(query.page.limit);
      expect(JSON.stringify(result)).not.toContain(rawSelector);
      expect(JSON.stringify(proof)).not.toContain(rawSelector);
      expect(JSON.stringify(proof)).not.toContain(baseId);
      expect(JSON.stringify(proof)).not.toContain(canonicalId);
      expect(JSON.stringify(proof)).not.toContain(versionedId);
      if (entry.kind === 'exact_title') {
        expect(proof.page).toEqual({ limit: 1, offset: 0, returned: 1, has_more: true });
      }
      if (entry.kind === 'historical_version') {
        expect((proof.items[0] as any).record_kind).toBe('historical');
        expect(proof.items[0]!.version).toBe(1);
      }
      if (entry.kind === 'current_version') {
        expect((proof.items[0] as any).record_kind).toBe('current');
        expect(proof.items[0]!.version).toBe(2);
      }
    }

    const activeArchived = createKnowledgePrivateQueryDescriptor({
      operation_id: 'op-private-query-archived-active',
      step_id: 'step-query',
      binding: BINDING,
      selector: { kind: 'current_version', item_id: archivedId },
      archive: 'active',
      limit: 2,
    });
    expect(inspectKnowledgePrivateResult(await guarded.query(activeArchived)).total).toBe(0);
    const archivedOnly = createKnowledgePrivateQueryDescriptor({
      operation_id: 'op-private-query-archived-only',
      step_id: 'step-query',
      binding: BINDING,
      selector: { kind: 'current_version', item_id: archivedId },
      archive: 'archived',
      limit: 2,
    });
    expect(inspectKnowledgePrivateResult(await guarded.query(archivedOnly)).total).toBe(1);

    const semantic = createKnowledgePrivateQueryDescriptor({
      operation_id: 'op-private-query-semantic',
      step_id: 'step-query',
      binding: BINDING,
      selector: { kind: 'semantic_overlap', query: 'private semantic request' },
      limit: 2,
    });
    expect(inspectKnowledgePrivateResult(await guarded.query(semantic))).toMatchObject({
      kind: 'query',
      query_kind: 'semantic_overlap',
      status: 'unavailable',
      code: 'semantic_query_unavailable',
      total: 0,
      item_count: 0,
    });
  }, budget(20_000));

  test('private query descriptors and envelopes fail closed on bounds, binding, expiry, revocation, tampering, and extra keys', async () => {
    const rawTitle = 'Private query fail-closed selector';
    const valid = createKnowledgePrivateQueryDescriptor({
      operation_id: 'op-private-query-fail-closed',
      step_id: 'step-query',
      binding: BINDING,
      selector: { kind: 'exact_title', title: rawTitle },
      limit: 2,
      offset: 3,
    });
    await expect(writer().query(valid, {
      max_calls: 1,
      max_items: 1,
      max_bytes: 1_048_576,
      wall_time_ms: 5_000,
    })).rejects.toThrow(/page\.limit/);
    expect(() => createKnowledgePrivateQueryDescriptor({
      operation_id: 'op-private-query-zero',
      step_id: 'step-query',
      binding: BINDING,
      selector: { kind: 'exact_title', title: rawTitle },
      limit: 0,
    })).toThrow(/page\.limit/);
    expect(() => createKnowledgePrivateQueryDescriptor({
      operation_id: 'op-private-query-max-plus-one',
      step_id: 'step-query',
      binding: BINDING,
      selector: { kind: 'exact_title', title: rawTitle },
      limit: 51,
    })).toThrow(/page\.limit/);
    expect(() => createKnowledgePrivateQueryDescriptor({
      operation_id: 'op-private-query-negative-offset',
      step_id: 'step-query',
      binding: BINDING,
      selector: { kind: 'exact_title', title: rawTitle },
      offset: -1,
    })).toThrow(/page\.offset/);
    expect(() => createKnowledgePrivateQueryDescriptor({
      operation_id: 'op-private-query-extra-selector-key',
      step_id: 'step-query',
      binding: BINDING,
      selector: { kind: 'exact_title', title: rawTitle, extra: true } as any,
    })).toThrow(/unexpected: extra/);

    const wrongScopeWriter = createKnowledgeGuardedWriter({
      binding: { ...BINDING, scope: 'project:wrong', parent_id: 'project:wrong' },
      env,
    });
    await expect(wrongScopeWriter.query(valid)).rejects.toThrow(/binding/i);

    const revoked = createKnowledgePrivateQueryDescriptor({
      operation_id: 'op-private-query-revoked',
      step_id: 'step-query',
      binding: BINDING,
      selector: { kind: 'exact_title', title: rawTitle },
      limit: 2,
    });
    revokeKnowledgePrivateQueryDescriptor(revoked);
    await expect(writer().query(revoked)).rejects.toThrow(/revoked/);

    const expired = createKnowledgePrivateQueryDescriptor({
      operation_id: 'op-private-query-expired',
      step_id: 'step-query',
      binding: BINDING,
      selector: { kind: 'exact_title', title: rawTitle },
      limit: 2,
      expires_in_ms: 1,
    });
    await Bun.sleep(5);
    await expect(writer().query(expired)).rejects.toThrow(/expired/);

    const bounds = {
      max_calls: 1,
      max_items: 2,
      max_bytes: 1_048_576,
      wall_time_ms: 5_000,
    };
    const request = async (body: unknown) => fetch(
      `http://127.0.0.1:${server.port}/v1/guarded-writes/queries`,
      {
        method: 'POST',
        headers: {
          'x-api-key': env.HASNA_KNOWLEDGE_API_KEY!,
          'x-knowledge-tenant-id': BINDING.tenant_id,
          'x-knowledge-max-calls': String(bounds.max_calls),
          'x-knowledge-max-items': String(bounds.max_items),
          'x-knowledge-max-bytes': String(bounds.max_bytes),
          'x-knowledge-wall-time-ms': String(bounds.wall_time_ms),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    const tampered = await request({
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      descriptor: { ...valid.toJSON(), selector_digest: '0'.repeat(64) },
      selector: { kind: 'exact_title', title: rawTitle },
      limits: bounds,
    });
    expect(tampered.status).toBe(400);
    expect(JSON.stringify(await tampered.json())).not.toContain(rawTitle);

    const extraEnvelope = await request({
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      descriptor: valid.toJSON(),
      selector: { kind: 'exact_title', title: rawTitle },
      limits: bounds,
      extra: true,
    });
    expect(extraEnvelope.status).toBe(400);
    expect(JSON.stringify(await extraEnvelope.json())).not.toContain(rawTitle);
  });

  test('same-operation replay proves one effect; changed semantics are refused', async () => {
    const input = descriptor({
      operation: 'op-duplicate-proof',
      step: 'step-create',
      target: 'k_fcame_duplicate_proof',
    });
    const first = await writer().execute(input);
    const replay = await writer().execute(input);
    expect(replay.duplicate).toBe(true);
    expect(replay.receipt.receipt_id).toBe(first.receipt.receipt_id);
    expect(replay.receipt.result_version).toBe(first.receipt.result_version);

    const count = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM knowledge_items WHERE id = $1`,
      [input.target_id],
    );
    expect(count.rows[0]!.count).toBe('1');

    const changed = descriptor({
      operation: input.operation_id,
      step: input.step_id,
      target: input.target_id,
      payload: { title: 'Changed replay', content: 'different private semantics' },
    });
    let caught: unknown = null;
    try {
      await writer().execute(changed);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeGuardedOperationConflictError);
    expect((caught as KnowledgeGuardedOperationConflictError).receipt.receipt_id)
      .toBe(first.receipt.receipt_id);
  });

  test('wrong scope and wrong parent are terminal binding rejections', async () => {
    const created = await writer().execute(descriptor({
      operation: 'op-binding-create',
      step: 'step-create',
      target: 'k_fcame_binding_target',
    }));
    expect(created.receipt.result_version).toBe(1);

    for (const [suffix, binding] of [
      ['scope', { ...BINDING, scope: 'project:wrong' }],
      ['parent', { ...BINDING, parent_id: 'global:wrong' }],
    ] as const) {
      const update = descriptor({
        operation: `op-binding-${suffix}`,
        step: 'step-update',
        target: 'k_fcame_binding_target',
        verb: 'update',
        version: 1,
        binding,
        payload: { content: `must-not-land:${suffix}` },
      });
      let caught: unknown = null;
      try {
        await writer(binding).execute(update);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(KnowledgeGuardedWriteRejectedError);
      expect((caught as KnowledgeGuardedWriteRejectedError).receipt.code).toBe('binding_mismatch');
      expect((caught as KnowledgeGuardedWriteRejectedError).receipt.effect_count).toBe(0);
    }
    expect((await writer().readback('k_fcame_binding_target')).item.content)
      .not.toContain('must-not-land');
  });

  test('stale compare-and-swap is rejected after a known-pass matching update', async () => {
    await writer().execute(descriptor({
      operation: 'op-cas-create',
      step: 'step-create',
      target: 'k_fcame_cas_target',
      payload: { title: 'CAS', content: 'v1' },
    }));
    const accepted = await writer().execute(descriptor({
      operation: 'op-cas-update-pass',
      step: 'step-update',
      target: 'k_fcame_cas_target',
      verb: 'update',
      version: 1,
      payload: { content: 'v2-known-pass' },
    }));
    expect(accepted.receipt.result_version).toBe(2);

    let caught: unknown = null;
    try {
      await writer().execute(descriptor({
        operation: 'op-cas-update-stale',
        step: 'step-update',
        target: 'k_fcame_cas_target',
        verb: 'update',
        version: 1,
        payload: { content: 'v3-must-not-land' },
      }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeGuardedWriteRejectedError);
    expect((caught as KnowledgeGuardedWriteRejectedError).receipt.code).toBe('version_conflict');
    expect((await writer().readback('k_fcame_cas_target')).item.content).toBe('v2-known-pass');
  });

  test('receipts are immutable under direct SQL update and delete attempts', async () => {
    const result = await writer().execute(descriptor({
      operation: 'op-receipt-immutable',
      step: 'step-create',
      target: 'k_fcame_receipt_immutable',
    }));
    await expect(
      db.query(`UPDATE knowledge_guarded_write_receipts SET code = 'rewritten' WHERE receipt_id = $1`, [
        result.receipt.receipt_id,
      ]),
    ).rejects.toThrow(/immutable/i);
    await expect(
      db.query(`DELETE FROM knowledge_guarded_write_receipts WHERE receipt_id = $1`, [
        result.receipt.receipt_id,
      ]),
    ).rejects.toThrow(/immutable/i);
    const row = await db.query<{ code: string }>(
      `SELECT code FROM knowledge_guarded_write_receipts WHERE receipt_id = $1`,
      [result.receipt.receipt_id],
    );
    expect(row.rows[0]!.code).toBe('created');
  });

  test('guarded items reject legacy HTTP and direct-SQL mutation bypasses', async () => {
    const targetId = 'k_fcame_no_direct_bypass';
    await writer().execute(descriptor({
      operation: 'op-no-direct-bypass',
      step: 'step-create',
      target: targetId,
      payload: { title: 'Protected item', content: 'guarded-only-content' },
    }));

    await expect(
      db.query(`UPDATE knowledge_items SET content = 'raw-sql-bypass' WHERE id = $1`, [targetId]),
    ).rejects.toThrow(/FCAME-1 operation claim/i);
    await expect(
      db.query(`DELETE FROM knowledge_items WHERE id = $1`, [targetId]),
    ).rejects.toThrow(/cannot be deleted/i);

    const legacyRead = await fetch(`http://127.0.0.1:${server.port}/v1/notes/${targetId}`, {
      headers: { 'x-api-key': env.HASNA_KNOWLEDGE_API_KEY! },
    });
    expect(legacyRead.status).toBe(200);
    expect((await legacyRead.json() as { content: string }).content).toBe('guarded-only-content');

    const legacyPatch = await fetch(`http://127.0.0.1:${server.port}/v1/notes/${targetId}`, {
      method: 'PATCH',
      headers: {
        'x-api-key': env.HASNA_KNOWLEDGE_API_KEY!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: 'legacy-route-bypass' }),
    });
    expect(legacyPatch.status).toBe(404);

    const legacyUpsert = await fetch(`http://127.0.0.1:${server.port}/v1/notes`, {
      method: 'POST',
      headers: {
        'x-api-key': env.HASNA_KNOWLEDGE_API_KEY!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: targetId,
        title: 'Legacy overwrite',
        content: 'legacy-upsert-bypass',
      }),
    });
    expect(legacyUpsert.status).toBe(409);
    expect((await writer().readback(targetId)).item.content).toBe('guarded-only-content');
  });

  test('bounded exact reconciliation asserts terminal completeness and its guards can fail', async () => {
    const input = descriptor({
      operation: 'op-reconcile-bounded',
      step: 'step-create',
      target: 'k_fcame_reconcile_bounded',
    });
    const result = await writer().execute(input);
    const reconciled = await writer().reconcile(
      result.deterministic_key,
      input.operation_id,
      input.step_id,
    );
    expect(reconciled.receipt_count).toBe(1);
    expect(reconciled.terminal_complete).toBe(true);
    expect(assertKnowledgeTerminalCompleteness(reconciled, {
      deterministic_key: result.deterministic_key,
      operation_id: input.operation_id,
      step_id: input.step_id,
    }).receipt_id).toBe(result.receipt.receipt_id);

    await expect(writer().reconcile(
      result.deterministic_key,
      input.operation_id,
      input.step_id,
      { max_calls: 2, max_items: 1, max_bytes: 4096, wall_time_ms: 1000 },
    )).rejects.toThrow();
    await expect(writer().reconcile(
      result.deterministic_key,
      input.operation_id,
      input.step_id,
      { max_calls: 1, max_items: 1, max_bytes: 1, wall_time_ms: 1000 },
    )).rejects.toThrow();
    expect(() => assertKnowledgeTerminalCompleteness(
      { ...reconciled, terminal_complete: false },
      {
        deterministic_key: result.deterministic_key,
        operation_id: input.operation_id,
        step_id: input.step_id,
      },
    )).toThrow(/terminal_completeness_failed/);
  });

  test('ordered immutable manifest binds two Knowledge writes and fails closed on Instructions authority', async () => {
    const workflowOperation = 'op-doctrine-rollout';
    const manifestId = deterministicManifestId(workflowOperation);
    const first = descriptor({
      operation: 'op-manifest-knowledge-one',
      step: 'step-knowledge-one',
      target: 'k_fcame_manifest_one',
      manifest: {
        manifest_id: manifestId,
        ordinal: 0,
        phase: 'primary',
        compensates_receipt_id: null,
      },
    });
    const second = descriptor({
      operation: 'op-manifest-knowledge-two',
      step: 'step-knowledge-two',
      target: 'k_fcame_manifest_two',
      manifest: {
        manifest_id: manifestId,
        ordinal: 1,
        phase: 'primary',
        compensates_receipt_id: null,
      },
    });
    const externalBinding: KnowledgeGuardedBinding = {
      authority: {
        classification: 'user_hosted',
        authority_id: 'instructions-authority-test',
      },
      tenant_id: TENANT,
      scope: 'global',
      parent_id: 'global:global',
    };
    const externalPayloadDigest = knowledgeGuardedDigest({
      private_payload_owned_by: '@hasna/instructions',
    });
    const externalKey = computeKnowledgeGuardedDeterministicKey({
      binding: externalBinding,
      operation_id: 'op-manifest-instructions',
      step_id: 'step-instructions',
      verb: 'create',
      target_id: 'instructions-doctrine-render',
      payload_digest: externalPayloadDigest,
      precondition: { kind: 'absent' },
      manifest: {
        manifest_id: manifestId,
        ordinal: 2,
        phase: 'primary',
        compensates_receipt_id: null,
      },
    });
    const externalRecoveryPayload = { archived: true };
    const externalRecoveryBase = {
      strategy: 'receipt_scoped_compensation' as const,
      operation_id: 'op-manifest-instructions-compensate',
      step_id: 'step-instructions-compensate',
      verb: 'update' as const,
      target_id: 'instructions-doctrine-render',
      semantic_digest: knowledgeGuardedDigest(externalRecoveryPayload),
      precondition: { kind: 'version' as const, expected_version: 1 },
      binding: externalBinding,
      limits: DEFAULT_KNOWLEDGE_GUARDED_LIMITS,
      receipt_scope: 'accepted_step_receipt' as const,
      compensates_receipt_id: computeKnowledgeGuardedReceiptId(externalKey),
    };
    const externalStep: KnowledgeGuardedManifestStep = {
      ordinal: 2,
      operation_id: 'op-manifest-instructions',
      step_id: 'step-instructions',
      deterministic_key: externalKey,
      verb: 'create',
      target_id: 'instructions-doctrine-render',
      binding: externalBinding,
      semantic_digest: externalPayloadDigest,
      precondition: { kind: 'absent' },
      dependencies: [0, 1],
      limits: DEFAULT_KNOWLEDGE_GUARDED_LIMITS,
      recovery: {
        ...externalRecoveryBase,
        deterministic_key: computeKnowledgeGuardedRecoveryKey({
          manifest_id: manifestId,
          ordinal: 2,
          step_deterministic_key: externalKey,
          ...externalRecoveryBase,
        }),
      },
    };
    const manifest = {
      manifest_id: manifestId,
      operation_id: workflowOperation,
      steps: [manifestStep(first), manifestStep(second), externalStep],
    };
    const manifestWriter = writer(BINDING, true);
    const created = await manifestWriter.createManifest(manifest);
    expect(created.duplicate).toBe(false);
    const duplicate = await manifestWriter.createManifest(manifest);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.manifest.manifest_receipt_id).toBe(created.manifest.manifest_receipt_id);
    const conflictingFirst = descriptor({
      operation: first.operation_id,
      step: first.step_id,
      target: first.target_id,
      manifest: first.manifest!,
      payload: { title: 'Conflicting immutable rewrite', content: 'different semantics' },
    });
    await expect(manifestWriter.createManifest({
      ...manifest,
      steps: [manifestStep(conflictingFirst), manifestStep(second), externalStep],
    })).rejects.toBeInstanceOf(KnowledgeGuardedManifestConflictError);

    await manifestWriter.execute(first);
    guardedSqlTrace.length = 0;
    await manifestWriter.execute(second);
    const manifestLockIndex = guardedSqlTrace.findIndex((sql) => (
      sql.includes('knowledge_guarded_write_manifests')
      && sql.includes('FOR UPDATE')
    ));
    const prerequisiteReceiptIndex = guardedSqlTrace.findIndex((sql) => (
      sql.includes('knowledge_guarded_write_receipts')
      && sql.includes('deterministic_key = $1')
    ));
    expect(manifestLockIndex).toBeGreaterThanOrEqual(0);
    expect(prerequisiteReceiptIndex).toBeGreaterThan(manifestLockIndex);
    const reconciliation = await manifestWriter.reconcileManifest(manifestId);
    expect(reconciliation.steps.map((step) => step.state))
      .toEqual(['accepted', 'accepted', 'unverified_external_authority']);
    expect(reconciliation.steps.map((step) => step.recovery_state))
      .toEqual(['missing', 'missing', 'unverified_external_authority']);
    expect(reconciliation.terminal_complete).toBe(false);
    expect(reconciliation.accepted_complete).toBe(false);
    expect(reconciliation.unsupported_gap)
      .toBe('external_authority_receipt_verifier_required:user_hosted:instructions-authority-test');
    expect(() => assertKnowledgeGuardedManifestTerminalCompleteness(reconciliation, {
      manifest_id: manifestId,
      deterministic_key: created.deterministic_key,
    })).toThrow(/manifest_terminal_completeness_failed/);

    await expect(
      db.query(`UPDATE knowledge_guarded_write_manifests SET operation_id = 'rewritten' WHERE manifest_id = $1`, [
        manifestId,
      ]),
    ).rejects.toThrow(/immutable/i);
    await expect(
      db.query(
        `UPDATE knowledge_guarded_write_manifest_steps
            SET step_id = 'rewritten'
          WHERE manifest_id = $1 AND ordinal = 0`,
        [manifestId],
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      manifestWriter.execute(descriptor({
        operation: 'op-unmanifested-refusal',
        step: 'step-create',
        target: 'k_fcame_unmanifested_refusal',
      })),
    ).rejects.toThrow(/guarded_manifest_required/);
  });

  test('receipt-scoped compensation is executable, immutable, and closes the primary suffix', async () => {
    const workflowOperation = 'op-receipt-compensation-workflow';
    const manifestId = deterministicManifestId(workflowOperation);
    const first = descriptor({
      operation: 'op-compensation-one',
      step: 'step-compensation-one',
      target: 'k_fcame_compensation_one',
      manifest: {
        manifest_id: manifestId,
        ordinal: 0,
        phase: 'primary',
        compensates_receipt_id: null,
      },
    });
    const second = descriptor({
      operation: 'op-compensation-two',
      step: 'step-compensation-two',
      target: 'k_fcame_compensation_two',
      manifest: {
        manifest_id: manifestId,
        ordinal: 1,
        phase: 'primary',
        compensates_receipt_id: null,
      },
    });
    const firstPlan = recoveryPlan(first, 'receipt_scoped_compensation');
    const guarded = writer(BINDING, true);
    await guarded.createManifest({
      manifest_id: manifestId,
      operation_id: workflowOperation,
      steps: [
        manifestStep(first, 'receipt_scoped_compensation'),
        manifestStep(second, 'receipt_scoped_compensation'),
      ],
    });
    const accepted = await guarded.execute(first);
    expect(accepted.receipt.receipt_id).toBe(firstPlan.recovery.compensates_receipt_id);

    const recovery = recoveryDescriptor(manifestId, 0, firstPlan);
    const compensated = await guarded.execute(recovery);
    expect(compensated.receipt.manifest).toEqual({
      manifest_id: manifestId,
      ordinal: 0,
      phase: 'recovery',
      compensates_receipt_id: accepted.receipt.receipt_id,
    });
    expect(compensated.readback.item.archived).toBe(true);
    const replay = await guarded.execute(recovery);
    expect(replay.duplicate).toBe(true);
    expect(replay.receipt.receipt_id).toBe(compensated.receipt.receipt_id);

    const reconciliation = await guarded.reconcileManifest(manifestId);
    expect(reconciliation.steps.map((step) => step.state)).toEqual(['accepted', 'missing']);
    expect(reconciliation.steps.map((step) => step.recovery_state)).toEqual(['accepted', 'missing']);
    expect(reconciliation.terminal_complete).toBe(true);
    expect(reconciliation.accepted_complete).toBe(false);
    expect(assertKnowledgeGuardedManifestTerminalCompleteness(reconciliation, {
      manifest_id: manifestId,
      require_accepted: false,
    }).manifest_id).toBe(manifestId);
    expect(() => assertKnowledgeGuardedManifestTerminalCompleteness(reconciliation, {
      manifest_id: manifestId,
    })).toThrow(/manifest_accepted_completeness_failed/);

    await expect(guarded.execute(second)).rejects.toBeInstanceOf(
      KnowledgeGuardedManifestStepRefusedError,
    );
    const missing = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM knowledge_items WHERE id = $1`,
      [second.target_id],
    );
    expect(missing.rows[0]!.count).toBe('0');
  });

  test('deterministic forward repair executes only for an accepted partial prefix', async () => {
    const workflowOperation = 'op-forward-repair-workflow';
    const manifestId = deterministicManifestId(workflowOperation);
    const first = descriptor({
      operation: 'op-forward-one',
      step: 'step-forward-one',
      target: 'k_fcame_forward_one',
      manifest: {
        manifest_id: manifestId,
        ordinal: 0,
        phase: 'primary',
        compensates_receipt_id: null,
      },
    });
    const second = descriptor({
      operation: 'op-forward-two',
      step: 'step-forward-two',
      target: 'k_fcame_forward_two',
      manifest: {
        manifest_id: manifestId,
        ordinal: 1,
        phase: 'primary',
        compensates_receipt_id: null,
      },
    });
    const plan = recoveryPlan(first, 'forward_repair');
    const guarded = writer(BINDING, true);
    await guarded.createManifest({
      manifest_id: manifestId,
      operation_id: workflowOperation,
      steps: [
        manifestStep(first, 'forward_repair'),
        manifestStep(second, 'receipt_scoped_compensation'),
      ],
    });

    await expect(guarded.execute(recoveryDescriptor(manifestId, 0, plan)))
      .rejects.toBeInstanceOf(KnowledgeGuardedManifestStepRefusedError);
    await guarded.execute(first);
    const repaired = await guarded.execute(recoveryDescriptor(manifestId, 0, plan));
    expect(repaired.receipt.code).toBe('created');
    expect(repaired.readback.item.id).toBe(`${first.target_id}:forward-repair`);
    expect(repaired.receipt.manifest?.compensates_receipt_id).toBeNull();
    const reconciliation = await guarded.reconcileManifest(manifestId);
    expect(reconciliation.terminal_complete).toBe(true);
    expect(reconciliation.accepted_complete).toBe(false);
    expect(assertKnowledgeGuardedManifestTerminalCompleteness(reconciliation, {
      manifest_id: manifestId,
      require_accepted: false,
    }).manifest_id).toBe(manifestId);
    await expect(guarded.execute(second)).rejects.toBeInstanceOf(
      KnowledgeGuardedManifestStepRefusedError,
    );
  });

  test('all-local manifest reconciliation proves accepted terminal completeness', async () => {
    const workflowOperation = 'op-local-complete-workflow';
    const manifestId = deterministicManifestId(workflowOperation);
    const first = descriptor({
      operation: 'op-local-complete-one',
      step: 'step-local-complete-one',
      target: 'k_fcame_local_complete_one',
      manifest: {
        manifest_id: manifestId,
        ordinal: 0,
        phase: 'primary',
        compensates_receipt_id: null,
      },
    });
    const second = descriptor({
      operation: 'op-local-complete-two',
      step: 'step-local-complete-two',
      target: 'k_fcame_local_complete_two',
      manifest: {
        manifest_id: manifestId,
        ordinal: 1,
        phase: 'primary',
        compensates_receipt_id: null,
      },
    });
    const guarded = writer(BINDING, true);
    const created = await guarded.createManifest({
      manifest_id: manifestId,
      operation_id: workflowOperation,
      steps: [manifestStep(first), manifestStep(second)],
    });
    await guarded.execute(first);
    await guarded.execute(second);
    const reconciliation = await guarded.reconcileManifest(manifestId);
    expect(assertKnowledgeGuardedManifestTerminalCompleteness(reconciliation, {
      manifest_id: manifestId,
      deterministic_key: created.deterministic_key,
    }).manifest_receipt_id).toBe(created.manifest.manifest_receipt_id);
  });

  test('guarded writer refuses the local JSON/direct-store path', () => {
    // The client transport fails closed without hosted API config, so reach
    // the FCAME-1 guard through the explicit on-box opt-in: even an opted-in
    // on-box store must never satisfy a guarded (API-only) writer.
    expect(() => createKnowledgeGuardedWriter({
      binding: BINDING,
      env: {
        NODE_ENV: 'test',
        HASNA_KNOWLEDGE_LOCAL: '1',
      },
    })).toThrow(/local JSON, SQLite, and raw-store fallbacks are refused/);
  });
});
