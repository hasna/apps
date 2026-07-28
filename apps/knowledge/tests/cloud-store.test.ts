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
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).toBeNull();
  });

  test('throws (never silent local drift) when self_hosted requested but API key missing', () => {
    expect(() =>
      resolveKnowledgeCloudStore({
        HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  test('resolves a cloud-http store pointed at the configured URL when self_hosted + url + key', () => {
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe('https://knowledge.md/v1');
  });

  test('stays local when ONLY API url+key are set — presence is not a selection', () => {
    // INVERTED, deliberately. This case used to route to cloud so that a fleet
    // flip writing only the two pointer vars would take effect. That made the
    // backend a function of ambient environment: those two variables exported in
    // a login shell are inherited by every pane from the tmux server, so a test
    // run believing it was isolated wrote to the live store, and it surfaced as
    // 99 unrelated test failures rather than as "you are pointed at production".
    //
    // The flip must now write an explicit mode as well. That is a coordination
    // cost paid once, against a class of silent production writes.
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).toBeNull();
  });

  test('the same pointers WITH an explicit cloud mode do route to cloud', () => {
    // The other half of the inverted case above: nothing about reaching the
    // cloud got harder, it just has to be asked for.
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud',
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe('https://knowledge.md/v1');
  });

  test('stays local when only the API url is set (key missing -> not both)', () => {
    expect(
      resolveKnowledgeCloudStore({
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
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

  test('defaults the base URL to the @hasna/contracts host template when only mode+key set', () => {
    // NOTE: this default is NOT sourced from this package's DEFAULT_KNOWLEDGE_API_URL.
    // It comes from `defaultCloudBaseUrl()` in the @hasna/contracts dependency,
    // which still templates `https://<app>.hasna.xyz`. That default needs its own
    // fix in the @hasna/contracts package; tracked separately from this repo.
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe('https://knowledge.hasna.xyz/v1');
  });
});
