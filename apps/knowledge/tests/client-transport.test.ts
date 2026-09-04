import { describe, expect, spyOn, test } from 'bun:test';
import {
  KNOWLEDGE_API_KEY_ENV,
  KNOWLEDGE_API_URL_ENV,
  KNOWLEDGE_LOCAL_ENV,
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
      local_opt_in_present: false,
    });
  });

  test('the local opt-in never downgrades a live hosted configuration to on-box', () => {
    // Owner directive 2026-09-04 fail-closed semantics: a stray
    // HASNA_KNOWLEDGE_LOCAL in the operator shell must not silently send reads
    // to the on-box store while HASNA_KNOWLEDGE_API_URL + KEY are exported —
    // that silent downgrade is the incident class (715712) this module closes.
    expect(resolveKnowledgeClientTransport({
      [KNOWLEDGE_API_URL_ENV]: 'https://knowledge.example.test',
      [KNOWLEDGE_API_KEY_ENV]: 'test-only-key',
      [KNOWLEDGE_LOCAL_ENV]: '1',
    })).toMatchObject({
      transport: 'http',
      source: KNOWLEDGE_API_URL_ENV,
      local_opt_in_present: true,
    });
  });

  test('no hosted API config and no explicit on-box opt-in fails closed', () => {
    expect(() => resolveKnowledgeClientTransport({})).toThrow(
      new RegExp(`knowledge: no hosted API configuration.*${KNOWLEDGE_API_URL_ENV}.*${KNOWLEDGE_API_KEY_ENV}.*${KNOWLEDGE_LOCAL_ENV}=1`, 's'),
    );
  });

  test('the explicit local opt-in alone selects the on-box store, silently', () => {
    // Explicit on-box choice: transport reports sqlite with the opt-in env as
    // the source — and no knowledge-local-fallback notice is ever emitted
    // (that event only ever announced an UNAUTHORIZED fallback, which no
    // longer exists as a behavior).
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(resolveKnowledgeClientTransport({
        [KNOWLEDGE_LOCAL_ENV]: '1',
      })).toMatchObject({
        transport: 'sqlite',
        source: KNOWLEDGE_LOCAL_ENV,
        api_url_present: false,
        local_opt_in_present: true,
      });
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  test('a blank local opt-in does not authorize the on-box store', () => {
    expect(() => resolveKnowledgeClientTransport({
      [KNOWLEDGE_LOCAL_ENV]: ' ',
    })).toThrow(/HASNA_KNOWLEDGE_LOCAL/);
  });

  test('unprefixed URL alias does not configure HTTP and still fails closed', () => {
    // KNOWLEDGE_API_URL (no prefix) is not a supported selector. Without the
    // canonical URL and without the explicit opt-in the process must fail
    // closed rather than drift to an unconfigured on-box read.
    expect(() => resolveKnowledgeClientTransport({
      KNOWLEDGE_API_URL: 'https://knowledge.example.test',
      [KNOWLEDGE_API_KEY_ENV]: 'test-only-key',
    })).toThrow(/HASNA_KNOWLEDGE_API_URL/);
  });

  test('inherited environment properties cannot select HTTP and still fail closed', () => {
    const env = Object.create({
      HASNA_KNOWLEDGE_API_URL: 'https://inherited.example.test',
      HASNA_KNOWLEDGE_API_KEY: 'inherited-key',
    }) as NodeJS.ProcessEnv;
    expect(() => resolveKnowledgeClientTransport(env)).toThrow(/HASNA_KNOWLEDGE_API_URL/);
  });

  test('canonical URL without key fails closed', () => {
    expect(() => resolveKnowledgeClientTransport({
      [KNOWLEDGE_API_URL_ENV]: 'https://knowledge.example.test',
    })).toThrow(/HASNA_KNOWLEDGE_API_KEY.*HASNA_KNOWLEDGE_LOCAL=1/s);
  });

  test('no configuration emits no local-fallback notice and never a false green', () => {
    // Regression for incident 715712's first mitigation: the old resolver
    // served the on-box store at exit 0 and printed a one-line
    // knowledge-local-fallback notice on stderr. A notice-and-continue is
    // still a false green to anything checking the exit code, so the default
    // branch is now a throw and the event name must not reappear in stderr.
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => resolveKnowledgeClientTransport({})).toThrow(/no hosted API configuration/);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
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
