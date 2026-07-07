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

  test('returns null (local) when mode=local even with API url+key present', () => {
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.hasna.xyz',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).toBeNull();
  });

  test('throws (never silent local drift) when self_hosted requested but API key missing', () => {
    expect(() =>
      resolveKnowledgeCloudStore({
        HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.hasna.xyz',
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  test('resolves a cloud-http store pointed at <app>.hasna.xyz/v1 when self_hosted + url + key', () => {
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.hasna.xyz',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe('https://knowledge.hasna.xyz/v1');
  });

  test('routes to cloud when ONLY API url+key are set (fleet-flip writes no STORAGE_MODE)', () => {
    // Regression: the machines flip writes exactly two vars per app
    // (HASNA_KNOWLEDGE_API_URL + HASNA_KNOWLEDGE_API_KEY) and no STORAGE_MODE.
    // Presence of both must trigger the cloud-http client, else the installed
    // CLI silently keeps reading the local db.json even with the flip applied.
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.hasna.xyz',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe('https://knowledge.hasna.xyz/v1');
  });

  test('stays local when only the API url is set (key missing -> not both)', () => {
    expect(
      resolveKnowledgeCloudStore({
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.hasna.xyz',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  test('stays local when only the API key is set (url missing -> not both)', () => {
    expect(
      resolveKnowledgeCloudStore({
        HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  test('defaults the base URL to https://knowledge.hasna.xyz/v1 when only mode+key set', () => {
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe('https://knowledge.hasna.xyz/v1');
  });
});
