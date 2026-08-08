import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ApiKeyStore, mintApiKey, verifyApiKey } from '@hasna/contracts/auth';
import type { PGlite } from '@electric-sql/pglite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as publicApi from '../src/index';
import {
  DEFAULT_KNOWLEDGE_GUARDED_LIMITS,
  KNOWLEDGE_GUARDED_WRITE_CONTRACT,
  KnowledgeGuardedManifestConflictError,
  KnowledgeGuardedManifestStepRefusedError,
  KnowledgeGuardedOperationConflictError,
  KnowledgeGuardedWriteRejectedError,
  assertKnowledgeGuardedManifestTerminalCompleteness,
  assertKnowledgeTerminalCompleteness,
  computeKnowledgeGuardedDeterministicKey,
  computeKnowledgeGuardedManifestId,
  computeKnowledgeGuardedReceiptId,
  computeKnowledgeGuardedRecoveryKey,
  createKnowledgeGuardedWriter,
  createKnowledgePrivateInputDescriptor,
  knowledgeGuardedDigest,
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
    isRevoked: store.isRevoked,
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
    HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
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

test('REGRESSION: guarded writer uses the supplied env endpoint and credential, not ambient credentials', async () => {
  const originalFetch = globalThis.fetch;
  const savedAmbient = {
    mode: process.env.HASNA_KNOWLEDGE_STORAGE_MODE,
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
    process.env.HASNA_KNOWLEDGE_STORAGE_MODE = 'postgres';
    process.env.HASNA_KNOWLEDGE_API_URL = 'http://127.0.0.1:65530/ambient';
    process.env.HASNA_KNOWLEDGE_API_KEY = AMBIENT_SENTINEL_KEY;

    const suppliedEnv = {
      ...process.env,
      HOME: home,
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
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
    if (savedAmbient.mode === undefined) delete process.env.HASNA_KNOWLEDGE_STORAGE_MODE;
    else process.env.HASNA_KNOWLEDGE_STORAGE_MODE = savedAmbient.mode;
    if (savedAmbient.url === undefined) delete process.env.HASNA_KNOWLEDGE_API_URL;
    else process.env.HASNA_KNOWLEDGE_API_URL = savedAmbient.url;
    if (savedAmbient.key === undefined) delete process.env.HASNA_KNOWLEDGE_API_KEY;
    else process.env.HASNA_KNOWLEDGE_API_KEY = savedAmbient.key;
  }
});

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
        isRevoked: store.isRevoked,
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
            HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
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
    expect(() => createKnowledgeGuardedWriter({
      binding: BINDING,
      env: {
        NODE_ENV: 'test',
        HASNA_KNOWLEDGE_STORAGE_MODE: 'sqlite',
      },
    })).toThrow(/local JSON, SQLite, and raw-store fallbacks are refused/);
  });
});
