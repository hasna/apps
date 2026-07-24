import { describe, expect, test } from 'bun:test';
import {
  KNOWLEDGE_APP_SLUG,
  KNOWLEDGE_RESOURCE,
  resolveKnowledgeCloudStore,
} from '../src/cloud-store';

const CLEAN_ENV = {} as NodeJS.ProcessEnv;

describe('knowledge cloud-store resolver (self_hosted client flip)', () => {
  test('resource + slug are the contract-stable values', () => {
    expect(KNOWLEDGE_APP_SLUG).toBe('knowledge');
    expect(KNOWLEDGE_RESOURCE).toBe('notes');
  });

  test('returns null (local) when no env is set', () => {
    expect(resolveKnowledgeCloudStore(CLEAN_ENV)).toBeNull();
  });

  test('rejects conflicting local mode plus active hosted HTTP intent', () => {
    expect(() => resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.hasna.xyz',
      HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
    } as NodeJS.ProcessEnv)).toThrow('KNOWLEDGE_RUNTIME_INTENT_INVALID');
  });

  test('throws (never silent local drift) when self_hosted requested but API key missing', () => {
    expect(() =>
      resolveKnowledgeCloudStore({
        HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.hasna.xyz',
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  test('contains explicit self-hosted intent before constructing an HTTP client', () => {
    expect(() => resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.hasna.xyz',
      HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
    } as NodeJS.ProcessEnv)).toThrow('KNOWLEDGE_HOSTED_CONTAINED');
  });

  test('contains complete hosted HTTP intent without an explicit mode', () => {
    expect(() => resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.hasna.xyz',
      HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
    } as NodeJS.ProcessEnv)).toThrow('KNOWLEDGE_HOSTED_CONTAINED');
  });

  test('rejects partial API URL intent', () => {
    expect(() => resolveKnowledgeCloudStore({
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.hasna.xyz',
    } as NodeJS.ProcessEnv)).toThrow('KNOWLEDGE_RUNTIME_INTENT_INVALID');
  });

  test('rejects partial API key intent', () => {
    expect(() => resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
    } as NodeJS.ProcessEnv)).toThrow('KNOWLEDGE_RUNTIME_INTENT_INVALID');
  });

  test('rejects explicit hosted aliases when their HTTP config is incomplete', () => {
    expect(() => resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
      HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key',
    } as NodeJS.ProcessEnv)).toThrow('KNOWLEDGE_RUNTIME_INTENT_INVALID');
  });
});
