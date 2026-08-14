import { afterAll } from 'bun:test';
import {
  KNOWLEDGE_API_KEY_ENV_KEYS,
  KNOWLEDGE_API_URL_ENV_KEYS,
  RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS,
} from '../src/client-transport';

/**
 * Bun loads this module before every test file through bunfig.toml. Keep the
 * parent test process on the hermetic SQLite default even when the developer's
 * login shell selects a production API/PostgreSQL route.
 *
 * Tests that exercise routing pass an explicit env object or set and restore
 * process.env inside their own lifecycle. The outbound network guard remains
 * the primary safety control; this preload removes machine-dependent suite
 * behavior rather than substituting for that guard.
 */
export const KNOWLEDGE_TEST_ROUTE_ENV_KEYS = [
  ...KNOWLEDGE_API_URL_ENV_KEYS,
  ...KNOWLEDGE_API_KEY_ENV_KEYS,
  ...RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS,
  'HASNA_KNOWLEDGE_DATABASE_URL',
] as const;

export function knowledgeTestEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const inherited = { ...process.env } as Record<string, string>;
  for (const key of KNOWLEDGE_TEST_ROUTE_ENV_KEYS) delete inherited[key];
  return { ...inherited, ...overrides };
}

const savedKnowledgeRouteEnv = new Map<string, string | undefined>(
  KNOWLEDGE_TEST_ROUTE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

for (const key of KNOWLEDGE_TEST_ROUTE_ENV_KEYS) delete process.env[key];

afterAll(() => {
  for (const [key, value] of savedKnowledgeRouteEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
