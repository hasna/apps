import { afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNOWLEDGE_API_KEY_ENV_KEYS,
  KNOWLEDGE_API_URL_ENV_KEYS,
  KNOWLEDGE_LOCAL_ENV,
  RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS,
} from '../src/client-transport';

/**
 * Bun loads this module before every test file through bunfig.toml. Keep the
 * parent test process on the hermetic on-box store even when the developer's
 * login shell selects a production API/PostgreSQL route.
 *
 * The client transport now FAILS CLOSED without hosted API config: the on-box
 * store is served only under the explicit HASNA_KNOWLEDGE_LOCAL=1 opt-in, so
 * this preload sets that opt-in for the whole suite and deletes every route
 * var that could point a child at production. Fail-closed tests pass an env
 * with neither the hosted pair nor the opt-in and assert the rejection.
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

/**
 * Explicit on-box opt-in for the suite (the resolver refuses to serve the
 * on-box store without it). Restored in afterAll so the developer's own value
 * survives the run.
 */
const savedKnowledgeLocalEnv = process.env[KNOWLEDGE_LOCAL_ENV];
process.env[KNOWLEDGE_LOCAL_ENV] = '1';

/**
 * The canonical project-scoped knowledge home resolves under the HOME root
 * (~/.hasna/knowledge/projects/<key>). Point the whole suite at a throwaway
 * HOME so project-scope tests that write (initDb, setup, sync, app-wiki)
 * never touch the developer's real ~/.hasna/knowledge. Tests that set their
 * own HOME for a fixture restore the preload value afterwards.
 */
const savedHome = process.env.HOME;
const savedUserProfile = process.env.USERPROFILE;
const isolatedTestHome = mkdtempSync(join(tmpdir(), 'ok-knowledge-suite-home-'));
process.env.HOME = isolatedTestHome;
process.env.USERPROFILE = isolatedTestHome;

afterAll(() => {
  for (const [key, value] of savedKnowledgeRouteEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (savedKnowledgeLocalEnv === undefined) delete process.env[KNOWLEDGE_LOCAL_ENV];
  else process.env[KNOWLEDGE_LOCAL_ENV] = savedKnowledgeLocalEnv;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  rmSync(isolatedTestHome, { recursive: true, force: true });
});
