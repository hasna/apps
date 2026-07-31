import {
  KNOWLEDGE_API_KEY_ENV_KEYS,
  KNOWLEDGE_API_URL_ENV_KEYS,
  KNOWLEDGE_MODE_ENV_KEYS,
} from '../src/knowledge-mode';

const KNOWLEDGE_TEST_ENV_KEYS = [
  ...KNOWLEDGE_MODE_ENV_KEYS,
  ...KNOWLEDGE_API_URL_ENV_KEYS,
  ...KNOWLEDGE_API_KEY_ENV_KEYS,
] as const;

export function scrubKnowledgeSelectorEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const scrubbed = { ...env };
  for (const key of KNOWLEDGE_TEST_ENV_KEYS) {
    delete scrubbed[key];
  }
  return scrubbed;
}

for (const key of KNOWLEDGE_TEST_ENV_KEYS) {
  delete process.env[key];
}
