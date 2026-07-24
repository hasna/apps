import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createKnowledgeService,
} from '../src/index.ts';
import {
  assertKnowledgeLocalRuntime,
  resolveKnowledgeRuntimeRole,
} from '../src/runtime-role.ts';
import * as builtKnowledge from '../dist/index.js';

const ROLE_KEYS = [
  'CODEWITH_RUNTIME_ROLE',
  'CODEWITH_EXECUTION_ROLE',
  'CODEWITH_AGENT_ROLE',
  'CODEWITH_ROLE',
  'KNOWLEDGE_RUNTIME_ROLE',
  'KNOWLEDGE_EXECUTION_ROLE',
  'KNOWLEDGE_AGENT_ROLE',
  'KNOWLEDGE_ROLE',
] as const;

const HOSTED_BOOLEAN_KEYS = [
  'CODEWITH_HOSTED',
  'KNOWLEDGE_HOSTED',
] as const;

function assertTypedContainment(run: () => unknown, role?: string): void {
  try {
    run();
    throw new Error('expected typed Stage-A containment');
  } catch (error) {
    expect(error).toMatchObject({
      name: 'KnowledgeContainmentError',
      status: 503,
      ...(role ? { role } : {}),
    });
  }
}

afterEach(() => {
  for (const key of [...ROLE_KEYS, ...HOSTED_BOOLEAN_KEYS]) delete process.env[key];
});

describe('effective ambient and supplied runtime intent', () => {
  test('an empty supplied env cannot erase ambient hosted intent in source or dist SDKs', () => {
    process.env.CODEWITH_RUNTIME_ROLE = 'hosted';

    for (const createService of [createKnowledgeService, builtKnowledge.createKnowledgeService]) {
      const cwd = join(process.env.HOME ?? '/synthetic', 'ambient-hosted-sdk');
      assertTypedContainment(() => createService({ cwd, env: {} } as never), 'hosted-client');
      expect(existsSync(join(cwd, '.hasna'))).toBe(false);
    }
  });

  test('a supplied local mode cannot downgrade ambient hosted intent', () => {
    process.env.KNOWLEDGE_RUNTIME_ROLE = 'hosted';
    const supplied = { HASNA_KNOWLEDGE_STORAGE_MODE: 'local' };

    expect(resolveKnowledgeRuntimeRole({ env: supplied })).toMatchObject({
      role: 'invalid',
      issues: expect.arrayContaining(['conflicting-modes']),
    });
    assertTypedContainment(() => assertKnowledgeLocalRuntime({ env: supplied }), 'invalid');
  });

  test('a supplied hosted mode cannot be downgraded by ambient local intent', () => {
    process.env.HASNA_KNOWLEDGE_STORAGE_MODE = 'local';
    expect(resolveKnowledgeRuntimeRole({ env: { CODEWITH_ROLE: 'hosted' } })).toMatchObject({
      role: 'invalid',
      issues: expect.arrayContaining(['conflicting-modes']),
    });
  });
});

describe('canonical Codewith and Knowledge role families', () => {
  for (const key of ROLE_KEYS) {
    test(`${key} selects hosted and unknown values fail closed`, () => {
      expect(resolveKnowledgeRuntimeRole({ env: { [key]: 'hosted' } })).toMatchObject({
        role: 'hosted-client',
      });
      expect(resolveKnowledgeRuntimeRole({ env: { [key]: 'synthetic-unknown-role' } })).toMatchObject({
        role: 'invalid',
      });
    });
  }

  for (const key of HOSTED_BOOLEAN_KEYS) {
    test(`${key} recognizes true, false, and malformed intent`, () => {
      expect(resolveKnowledgeRuntimeRole({ env: { [key]: 'true' } })).toMatchObject({
        role: 'hosted-client',
      });
      expect(resolveKnowledgeRuntimeRole({ env: { [key]: 'false' } })).toMatchObject({
        role: 'local',
      });
      expect(resolveKnowledgeRuntimeRole({ env: { [key]: 'maybe' } })).toMatchObject({
        role: 'invalid',
      });
    });
  }

  test('conflicting role families fail closed regardless of key order', () => {
    for (const env of [
      { CODEWITH_ROLE: 'local', KNOWLEDGE_ROLE: 'hosted' },
      { KNOWLEDGE_HOSTED: 'true', CODEWITH_RUNTIME_ROLE: 'local' },
      { KNOWLEDGE_EXECUTION_ROLE: 'hosted', CODEWITH_HOSTED: 'false' },
    ]) {
      expect(resolveKnowledgeRuntimeRole({ env })).toMatchObject({
        role: 'invalid',
        issues: expect.arrayContaining(['conflicting-modes']),
      });
    }
  });
});
