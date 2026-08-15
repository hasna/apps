import { describe, expect, test } from 'bun:test';
import {
  KNOWLEDGE_API_KEY_ENV,
  KNOWLEDGE_API_URL_ENV,
  RetiredKnowledgeStorageSelectorError,
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
