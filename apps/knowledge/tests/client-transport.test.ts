import { describe, expect, spyOn, test } from 'bun:test';
import {
  KNOWLEDGE_API_KEY_ENV,
  KNOWLEDGE_API_URL_ENV,
  RetiredKnowledgeStorageSelectorError,
  resetKnowledgeLocalFallbackNotice,
  resolveKnowledgeClientTransport,
} from '../src/client-transport';

describe('Knowledge client transport', () => {
  test('canonical API URL and key select HTTP', () => {
    expect(resolveKnowledgeClientTransport({
      [KNOWLEDGE_API_URL_ENV]: 'https://knowledge.example.test',
      [KNOWLEDGE_API_KEY_ENV]: 'test-only-key',
    })).toMatchObject({
      transport: 'http',
      source: KNOWLEDGE_API_URL_ENV,
      api_url_present: true,
      api_key_present: true,
    });
  });

  test('canonical API URL absent selects on-box SQLite', () => {
    expect(resolveKnowledgeClientTransport({})).toMatchObject({
      transport: 'sqlite',
      source: 'default',
      api_url_present: false,
    });
  });

  test('unprefixed URL alias does not select HTTP', () => {
    expect(resolveKnowledgeClientTransport({
      KNOWLEDGE_API_URL: 'https://knowledge.example.test',
      [KNOWLEDGE_API_KEY_ENV]: 'test-only-key',
    })).toMatchObject({
      transport: 'sqlite',
      source: 'default',
    });
  });

  test('inherited environment properties cannot select HTTP', () => {
    const env = Object.create({
      HASNA_KNOWLEDGE_API_URL: 'https://inherited.example.test',
      HASNA_KNOWLEDGE_API_KEY: 'inherited-key',
    }) as NodeJS.ProcessEnv;
    expect(resolveKnowledgeClientTransport(env).transport).toBe('sqlite');
  });

  test('canonical URL without key fails closed', () => {
    expect(() => resolveKnowledgeClientTransport({
      [KNOWLEDGE_API_URL_ENV]: 'https://knowledge.example.test',
    })).toThrow(/HASNA_KNOWLEDGE_API_KEY.*unset HASNA_KNOWLEDGE_API_URL/s);
  });

  test('retired selector fails loudly even when blank', () => {
    for (const value of ['', 'selector-value-must-not-be-rendered']) {
      try {
        resolveKnowledgeClientTransport({ HASNA_KNOWLEDGE_STORAGE_MODE: value });
        throw new Error('expected retired selector rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(RetiredKnowledgeStorageSelectorError);
        expect(String(error)).toMatch(/HASNA_KNOWLEDGE_STORAGE_MODE/);
        expect(String(error)).toMatch(/HASNA_KNOWLEDGE_API_URL/);
        expect(String(error)).toMatch(/HASNA_KNOWLEDGE_DATABASE_URL/);
        expect(String(error)).not.toContain(value || 'value-was-blank');
      }
    }
  });
});

describe('local-fallback notice (incident 715712)', () => {
  // Regression: a harness session-env re-provision dropped
  // HASNA_KNOWLEDGE_API_URL + HASNA_KNOWLEDGE_API_KEY and the CLI silently
  // served the on-box store at rc=0 — items appeared gone. Before serving
  // local on the default branch, the resolver must emit one machine-readable
  // stderr notice naming the mode switch (the same family as the merged
  // secrets fix, PR #681 / incident 715558).

  test('default branch emits one stderr notice naming HASNA_KNOWLEDGE_API_URL before serving local', () => {
    resetKnowledgeLocalFallbackNotice();
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = resolveKnowledgeClientTransport({});
      expect(report).toMatchObject({ transport: 'sqlite', source: 'default' });
      expect(errSpy).toHaveBeenCalledTimes(1);
      const notice = JSON.parse(errSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
      expect(notice.event).toBe('knowledge-local-fallback');
      expect(notice.notice).toContain(KNOWLEDGE_API_URL_ENV);
      expect(notice.notice).toContain('local SQLite');
      expect(notice.apiUrlPresent).toBe(false);
      // Once-only per process: repeated local resolutions stay silent.
      resolveKnowledgeClientTransport({});
      expect(errSpy).toHaveBeenCalledTimes(1);
    } finally {
      errSpy.mockRestore();
    }
  });

  test('http selection emits no fallback notice', () => {
    resetKnowledgeLocalFallbackNotice();
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      resolveKnowledgeClientTransport({
        [KNOWLEDGE_API_URL_ENV]: 'https://knowledge.example.test',
        [KNOWLEDGE_API_KEY_ENV]: 'test-only-key',
      });
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  test('URL without key still fails closed and emits no notice', () => {
    resetKnowledgeLocalFallbackNotice();
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => resolveKnowledgeClientTransport({
        [KNOWLEDGE_API_URL_ENV]: 'https://knowledge.example.test',
      })).toThrow(/HASNA_KNOWLEDGE_API_KEY/);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});
