import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import {
  assertProviderCredentials,
  listModelRegistry,
  normalizeAiSdkUsage,
  providerStatus,
  recordProviderUsage,
  resolveModelRef,
} from '../src/providers';
import { defaultKnowledgeConfig } from '../src/workspace';

describe('AI SDK provider registry metadata', () => {
  test('lists aliases, capabilities, and BYOK credential status', () => {
    const config = defaultKnowledgeConfig();
    const status = providerStatus(config, {
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: undefined,
      DEEPSEEK_API_KEY: 'deepseek-test',
    });
    expect(status.default_model).toBe('openai:gpt-5.2');
    expect(status.providers.find((entry) => entry.provider === 'openai')?.configured).toBe(true);
    expect(status.providers.find((entry) => entry.provider === 'anthropic')?.configured).toBe(false);
    expect(status.providers.find((entry) => entry.provider === 'deepseek')?.configured).toBe(true);

    const models = listModelRegistry(config);
    expect(models.find((entry) => entry.alias === 'fast')).toMatchObject({
      model_ref: 'openai:gpt-5-mini',
      provider: 'openai',
    });
    expect(models.find((entry) => entry.alias === 'deepseek-reasoning')).toMatchObject({
      model_ref: 'deepseek:deepseek-reasoner',
      provider: 'deepseek',
      capabilities: {
        tool_usage: true,
        structured_output: true,
      },
    });
    expect(resolveModelRef('sonnet', config)).toBe('anthropic:claude-sonnet-4-6');
  });

  test('checks credentials and records normalized provider usage', () => {
    expect(() => assertProviderCredentials('anthropic', defaultKnowledgeConfig(), {})).toThrow('Missing ANTHROPIC_API_KEY');
    expect(assertProviderCredentials('openai', defaultKnowledgeConfig(), { OPENAI_API_KEY: 'sk-test' })).toMatchObject({
      provider: 'openai',
      configured: true,
    });

    const normalized = normalizeAiSdkUsage({
      provider: 'openai',
      model: 'gpt-5.2',
      usage: { inputTokens: 11, outputTokens: 7 },
      providerMetadata: { openai: { itemId: 'item_1' } },
    });
    expect(normalized).toMatchObject({
      input_tokens: 11,
      output_tokens: 7,
      cost_usd: 0,
    });

    const dir = mkdtempSync(join(tmpdir(), 'ok-provider-'));
    const dbPath = join(dir, 'knowledge.db');
    migrateKnowledgeDb(dbPath);
    const db = openKnowledgeDb(dbPath);
    try {
      const id = recordProviderUsage(db, normalized);
      expect(id).toStartWith('usage_');
      const row = db.query<{ provider: string; model: string; input_tokens: number; output_tokens: number }, []>(
        'SELECT provider, model, input_tokens, output_tokens FROM provider_usage LIMIT 1',
      ).get();
      expect(row).toMatchObject({
        provider: 'openai',
        model: 'gpt-5.2',
        input_tokens: 11,
        output_tokens: 7,
      });
    } finally {
      db.close();
    }
  });
});
