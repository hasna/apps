import { describe, expect, test } from 'bun:test';
import {
  KnowledgeContainmentError,
  assertKnowledgeLocalRuntime,
  assertKnowledgeLocalRuntimeForConfigPath,
  assertKnowledgeLocalRuntimeWithConfig,
  authorityContainmentError,
  knowledgeConfigValidationIssue,
  resolveKnowledgeRuntimeRole,
  resolveKnowledgeRuntimeRoleWithConfig,
} from '../src/runtime-role.ts';
import {
  assertKnowledgeOperatorRuntime,
  createKnowledgeOperatorCapability,
} from '../src/operator-capability.ts';

describe('canonical Knowledge runtime-role resolution', () => {
  const cases = [
    {
      name: 'legacy no-signal local',
      input: { env: {} },
      role: 'local',
    },
    {
      name: 'explicit local',
      input: { env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'local' } },
      role: 'local',
    },
    {
      name: 'explicit hosted alias',
      input: { env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted' } },
      role: 'hosted-client',
    },
    {
      name: 'complete hosted HTTP intent',
      input: {
        env: {
          HASNA_KNOWLEDGE_API_URL: 'https://knowledge.invalid.test',
          HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
        },
      },
      role: 'hosted-client',
    },
    {
      name: 'URL only',
      input: { env: { HASNA_KNOWLEDGE_API_URL: 'https://knowledge.invalid.test' } },
      role: 'invalid',
    },
    {
      name: 'key only',
      input: { env: { HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key' } },
      role: 'invalid',
    },
    {
      name: 'duplicate URL aliases with the same value are one signal',
      input: {
        env: {
          HASNA_KNOWLEDGE_API_URL: 'https://knowledge.invalid.test',
          KNOWLEDGE_API_URL: 'https://knowledge.invalid.test',
          HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
        },
      },
      role: 'hosted-client',
    },
    {
      name: 'conflicting URL alias values',
      input: {
        env: {
          HASNA_KNOWLEDGE_API_URL: 'https://one.invalid.test',
          KNOWLEDGE_API_URL: 'https://two.invalid.test',
          HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
        },
      },
      role: 'invalid',
    },
    {
      name: 'conflicting API key alias values',
      input: {
        env: {
          HASNA_KNOWLEDGE_API_URL: 'https://knowledge.invalid.test',
          HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key-one',
          KNOWLEDGE_API_KEY: 'synthetic-stage-a-key-two',
        },
      },
      role: 'invalid',
    },
    {
      name: 'database URL only',
      input: { env: { HASNA_KNOWLEDGE_DATABASE_URL: 'postgres://synthetic.invalid/knowledge' } },
      role: 'invalid',
    },
    {
      name: 'unknown mode',
      input: { env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'mystery' } },
      role: 'invalid',
    },
    {
      name: 'conflicting aliases',
      input: {
        env: {
          HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
          KNOWLEDGE_STORAGE_MODE: 'cloud',
        },
      },
      role: 'invalid',
    },
    {
      name: 'local plus active hosted HTTP',
      input: {
        env: {
          HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
          HASNA_KNOWLEDGE_API_URL: 'https://knowledge.invalid.test',
          HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
        },
      },
      role: 'invalid',
    },
    {
      name: 'hosted plus local store override',
      input: {
        env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud' },
        localStoreOverride: true,
      },
      role: 'invalid',
    },
    {
      name: 'server surface is contained without env',
      input: { surface: 'server' as const, env: {} },
      role: 'hosted-server',
    },
    {
      name: 'loopback MCP HTTP surface is local without hosted intent',
      input: { surface: 'mcp-http' as const, env: {} },
      role: 'local',
    },
    {
      name: 'loopback MCP HTTP rejects explicit hosted intent as a client role',
      input: { surface: 'mcp-http' as const, env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' } },
      role: 'hosted-client',
    },
  ] as const;

  for (const scenario of cases) {
    test(scenario.name, () => {
      const result = resolveKnowledgeRuntimeRole(scenario.input);
      expect(result.role).toBe(scenario.role);
      expect(JSON.stringify(result)).not.toContain('synthetic-stage-a-key');
      expect(JSON.stringify(result)).not.toContain('postgres://');
    });
  }

  test('non-local assertions throw a typed deterministic containment error', () => {
    try {
      assertKnowledgeLocalRuntime({ env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' } });
      throw new Error('expected containment');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeContainmentError);
      expect((error as KnowledgeContainmentError).toJSON()).toMatchObject({
        ok: false,
        code: 'KNOWLEDGE_HOSTED_CONTAINED',
        status: 503,
        role: 'hosted-client',
      });
    }
  });

  test('proxy environment intent fails closed without invoking traps', () => {
    let reads = 0;
    const env = new Proxy({}, {
      get() { reads += 1; throw new Error('env get tripwire'); },
      getOwnPropertyDescriptor() { reads += 1; throw new Error('env descriptor tripwire'); },
      getPrototypeOf() { reads += 1; throw new Error('env prototype tripwire'); },
    });
    const resolution = resolveKnowledgeRuntimeRole({ env });
    expect(resolution.role).toBe('invalid');
    expect(resolution.issues.some((issue) => issue.startsWith('unreadable-env:supplied:'))).toBe(true);
    expect(reads).toBe(0);
  });

  test('config validation rejects inherited accessors without invoking them', () => {
    let reads = 0;
    const prototype = Object.defineProperty({}, 'version', {
      get() {
        reads += 1;
        throw new Error('config prototype getter tripwire');
      },
    });
    const config = Object.create(prototype);
    expect(knowledgeConfigValidationIssue(config)).toContain('custom prototypes');
    expect(reads).toBe(0);
  });

  test('hosted and invalid intent never invoke the config reader', () => {
    for (const env of [
      { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' },
      { HASNA_KNOWLEDGE_API_URL: 'https://knowledge.invalid.test' },
      { HASNA_KNOWLEDGE_STORAGE_MODE: 'mystery' },
    ]) {
      let reads = 0;
      expect(() => assertKnowledgeLocalRuntimeWithConfig({ env }, () => {
        reads += 1;
        return 'local';
      })).toThrow('KNOWLEDGE_');
      expect(reads).toBe(0);
    }
  });

  test('hosted and invalid intent call neither existsSync nor readFileSync', () => {
    for (const env of [
      { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' },
      { HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key' },
      { HASNA_KNOWLEDGE_STORAGE_MODE: 'mystery' },
    ]) {
      let existsCalls = 0;
      let readCalls = 0;
      expect(() => assertKnowledgeLocalRuntimeForConfigPath({ env }, '/synthetic/config.json', {
        existsSync: () => {
          existsCalls += 1;
          return true;
        },
        readFileSync: () => {
          readCalls += 1;
          return '{"mode":"local"}';
        },
      })).toThrow('KNOWLEDGE_');
      expect(existsCalls).toBe(0);
      expect(readCalls).toBe(0);
    }
  });

  test('supplied hosted config mode fails before persisted config inspection', () => {
    for (const persistedMode of ['local', undefined] as const) {
      let configReads = 0;
      const resolution = resolveKnowledgeRuntimeRoleWithConfig({
        env: {},
        configMode: 'hosted',
      }, () => {
        configReads += 1;
        return persistedMode;
      });
      expect(resolution).toMatchObject({
        role: 'hosted-client',
        source: 'mode',
      });
      expect(configReads).toBe(0);

      let existsCalls = 0;
      let readCalls = 0;
      expect(() => assertKnowledgeLocalRuntimeForConfigPath({
        env: {},
        configMode: 'hosted',
      }, '/synthetic/config.json', {
        existsSync: () => {
          existsCalls += 1;
          return persistedMode !== undefined;
        },
        readFileSync: () => {
          readCalls += 1;
          return JSON.stringify({ mode: persistedMode });
        },
      })).toThrow('KNOWLEDGE_HOSTED_CONTAINED');
      expect(existsCalls).toBe(0);
      expect(readCalls).toBe(0);
    }
  });

  test('only preliminary local intent reads config and applies the second gate', () => {
    let reads = 0;
    expect(() => assertKnowledgeLocalRuntimeWithConfig({ env: {} }, () => {
      reads += 1;
      return 'hosted';
    })).toThrow('KNOWLEDGE_HOSTED_CONTAINED');
    expect(reads).toBe(1);
  });

  test('public operator surface cannot be enabled by a boolean-like input', () => {
    const resolution = resolveKnowledgeRuntimeRole({
      surface: 'operator-migration',
      env: {},
      ...({ operatorCapabilityPresent: true } as Record<string, unknown>),
    });
    expect(resolution.role).toBe('invalid');
  });
});

describe('operator capability', () => {
  test('rejects forged values and accepts only the internal branded capability', () => {
    expect(() => assertKnowledgeOperatorRuntime({ entrypoint: 'internal-storage-test' } as never))
      .toThrow('KNOWLEDGE_OPERATOR_REQUIRED');
    expect(assertKnowledgeOperatorRuntime(createKnowledgeOperatorCapability('internal-storage-test')).role)
      .toBe('operator-migration');
  });
});

describe('Stage-A hosted authority disposition', () => {
  test('missing and untrusted authority are 503', () => {
    expect(authorityContainmentError(undefined).toJSON()).toMatchObject({
      code: 'KNOWLEDGE_AUTHORITY_UNAVAILABLE',
      status: 503,
    });
    expect(authorityContainmentError({ trust: 'untrusted' }).toJSON()).toMatchObject({
      code: 'KNOWLEDGE_AUTHORITY_UNAVAILABLE',
      status: 503,
    });
  });

  test('trusted principal with zero grants is 403', () => {
    expect(authorityContainmentError({ trust: 'trusted', projectGrants: [] }).toJSON()).toMatchObject({
      code: 'KNOWLEDGE_PROJECT_FORBIDDEN',
      status: 403,
    });
  });

  test('positive authority remains disabled in Stage A', () => {
    expect(authorityContainmentError({ trust: 'trusted', projectGrants: ['synthetic-project'] }).toJSON()).toMatchObject({
      code: 'KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED',
      status: 503,
    });
  });
});
