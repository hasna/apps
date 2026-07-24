import { describe, expect, test } from 'bun:test';
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
      DEEPSEEK_API_KEY: 'synthetic-deepseek-key',
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

  test('contains credential and usage persistence capabilities before client access', () => {
    expect(() => assertProviderCredentials('anthropic', defaultKnowledgeConfig(), {}))
      .toThrow('KNOWLEDGE_HOSTED_CONTAINED');
    expect(() => assertProviderCredentials('openai', defaultKnowledgeConfig(), { OPENAI_API_KEY: 'synthetic' }))
      .toThrow('KNOWLEDGE_HOSTED_CONTAINED');

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

    let clientCalls = 0;
    const db = new Proxy({}, {
      get() { clientCalls += 1; throw new Error('database client tripwire'); },
    });
    expect(() => recordProviderUsage(db as never, normalized))
      .toThrow('KNOWLEDGE_HOSTED_CONTAINED');
    expect(clientCalls).toBe(0);
  });
});
