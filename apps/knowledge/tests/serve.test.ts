import { describe, expect, test } from 'bun:test';
import {
  createServeHandler,
  knowledgeOpenApi,
  normalizeCloudDatabaseUrl as normalizeSourceCloudDatabaseUrl,
  startKnowledgeServe,
  type ServeDeps,
} from '../src/serve.ts';
import {
  normalizeCloudDatabaseUrl as normalizeBuiltCloudDatabaseUrl,
} from '../dist/serve.js';

function tripwireDeps(overrides: Partial<ServeDeps> & { authority?: unknown } = {}) {
  const calls = { client: 0, verifier: 0, store: 0 };
  const deps: Record<string, unknown> = { version: '0.0.0-test', ...overrides };
  for (const key of ['client', 'verifier', 'store'] as const) {
    Object.defineProperty(deps, key, {
      enumerable: true,
      get() {
        calls[key] += 1;
        throw new Error(`forbidden ${key} construction`);
      },
    });
  }
  return { calls, deps: deps as unknown as ServeDeps };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('knowledge-serve Stage-A containment', () => {
  test('source and dist database URL compatibility is a fixed zero-read stub', () => {
    const cases = [
      {
        env: { HASNA_KNOWLEDGE_DATABASE_URL: 'postgres://synthetic.invalid/knowledge?sslmode=require' },
      },
      {
        env: { KNOWLEDGE_DATABASE_URL: 'postgres://synthetic.invalid/knowledge?sslmode=prefer' },
      },
    ];

    for (const normalize of [normalizeSourceCloudDatabaseUrl, normalizeBuiltCloudDatabaseUrl]) {
      for (const scenario of cases) {
        const env = { ...scenario.env };
        const before = { ...env };
        expect(normalize(env)).toBeUndefined();
        expect(env).toEqual(before);
      }
      let reads = 0;
      const hostileEnv = new Proxy({}, {
        get() { reads += 1; throw new Error('env get tripwire'); },
        getOwnPropertyDescriptor() { reads += 1; throw new Error('env descriptor tripwire'); },
        getPrototypeOf() { reads += 1; throw new Error('env prototype tripwire'); },
      });
      expect(normalize(hostileEnv)).toBeUndefined();
      expect(reads).toBe(0);
    }
  });

  test('pure liveness, version, and OpenAPI metadata remain available', async () => {
    const { deps, calls } = tripwireDeps();
    const handler = createServeHandler(deps);

    const health = await handler(new Request('http://localhost/health'));
    expect(health.status).toBe(200);
    expect(await body(health)).toMatchObject({ status: 'ok', mode: 'contained' });

    const version = await handler(new Request('http://localhost/version'));
    expect(version.status).toBe(200);

    const openapi = await handler(new Request('http://localhost/openapi.json'));
    expect(openapi.status).toBe(200);
    expect(await body(openapi)).toHaveProperty('openapi', '3.0.3');
    expect(calls).toEqual({ client: 0, verifier: 0, store: 0 });
  });

  test('/ready is always 503 while contained and touches no dependency', async () => {
    const { deps, calls } = tripwireDeps({
      authority: { trust: 'trusted', projectGrants: ['synthetic-project'] },
    });
    const response = await createServeHandler(deps)(new Request('http://localhost/ready'));
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({
      code: 'KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED',
      status: 'unavailable',
      http_status: 503,
    });
    expect(calls).toEqual({ client: 0, verifier: 0, store: 0 });
  });

  const dataRequests = [
    new Request('http://localhost/v1/registry'),
    new Request('http://localhost/v1/notes'),
    new Request('http://localhost/v1/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'synthetic' }),
    }),
    new Request('http://localhost/v1/notes/synthetic-id'),
    new Request('http://localhost/v1/notes/synthetic-id', { method: 'PATCH', body: '{}' }),
    new Request('http://localhost/v1/notes/synthetic-id', { method: 'DELETE' }),
  ];

  test('missing and untrusted authority return 503 across every data route', async () => {
    for (const authority of [undefined, { trust: 'untrusted' as const }]) {
      for (const request of dataRequests) {
        const { deps, calls } = tripwireDeps({ authority });
        const response = await createServeHandler(deps)(request.clone());
        expect(response.status).toBe(503);
        expect(await body(response)).toMatchObject({
          code: 'KNOWLEDGE_AUTHORITY_UNAVAILABLE',
          status: 503,
        });
        expect(calls).toEqual({ client: 0, verifier: 0, store: 0 });
      }
    }
  });

  test('trusted authority with zero project grants returns 403 before auth/store', async () => {
    const { deps, calls } = tripwireDeps({
      authority: { trust: 'trusted', projectGrants: [] },
    });
    const response = await createServeHandler(deps)(new Request('http://localhost/v1/notes'));
    expect(response.status).toBe(403);
    expect(await body(response)).toMatchObject({
      code: 'KNOWLEDGE_PROJECT_FORBIDDEN',
      status: 403,
    });
    expect(calls).toEqual({ client: 0, verifier: 0, store: 0 });
  });

  test('positive trusted authority remains disabled before auth/store', async () => {
    const { deps, calls } = tripwireDeps({
      authority: { trust: 'trusted', projectGrants: ['synthetic-project'] },
    });
    const response = await createServeHandler(deps)(new Request('http://localhost/v1/notes'));
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({
      code: 'KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED',
      status: 503,
    });
    expect(calls).toEqual({ client: 0, verifier: 0, store: 0 });
  });

  test('caller authority claims in headers, query, and body are inert data', async () => {
    const { deps, calls } = tripwireDeps();
    const response = await createServeHandler(deps)(new Request(
      'http://localhost/v1/notes?tenant_id=caller-tenant&project_id=caller-project',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'caller-tenant',
          'x-project-id': 'caller-project',
        },
        body: JSON.stringify({
          title: 'synthetic',
          metadata: { tenant_id: 'caller-tenant', project_id: 'caller-project' },
        }),
      },
    ));
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ code: 'KNOWLEDGE_AUTHORITY_UNAVAILABLE' });
    expect(calls).toEqual({ client: 0, verifier: 0, store: 0 });
  });

  test('OpenAPI remains deterministic metadata', () => {
    const doc = knowledgeOpenApi('9.9.9') as { info: { version: string }; paths: Record<string, unknown> };
    expect(doc.info.version).toBe('9.9.9');
    expect(doc.paths).toHaveProperty('/v1/notes');
    expect(doc.paths).toHaveProperty('/v1/notes/{id}');
  });

  test('black-box server startup constructs only contained liveness routes', async () => {
    const running = await startKnowledgeServe({
      hostname: '127.0.0.1',
      port: 0,
      version: '0.0.0-test',
      env: {},
    } as never);
    try {
      const baseUrl = `http://${running.hostname}:${running.port}`;
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      const ready = await fetch(`${baseUrl}/ready`);
      expect(ready.status).toBe(503);
      const data = await fetch(`${baseUrl}/v1/notes`);
      expect(data.status).toBe(503);
      expect(await body(data)).toMatchObject({ code: 'KNOWLEDGE_AUTHORITY_UNAVAILABLE' });
    } finally {
      await running.stop();
    }
  });
});
