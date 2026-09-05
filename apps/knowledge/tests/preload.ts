import { afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNOWLEDGE_API_KEY_ENV_KEYS,
  KNOWLEDGE_API_URL_ENV_KEYS,
  KNOWLEDGE_APP_SLUG,
  RETIRED_KNOWLEDGE_LOCAL_ENV,
  RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS,
} from '../src/client-transport';
import {
  CREDENTIAL_PROFILE_ENV_KEY,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  HASNA_CONFIG_HOME_ENV_KEY,
  HASNA_HOME_ENV_KEY,
} from '@hasna/contracts/client';

/**
 * Bun loads this module before every test file through bunfig.toml. Keep the
 * parent test process on the hermetic on-box store even when the developer's
 * login shell — or their macOS login keychain — selects a production route.
 *
 * Credentials now resolve through the shared @hasna/contracts chain, which has
 * FIVE tiers, so hermeticity needs all five closed rather than two variables
 * cleared:
 *
 *   - the env tiers (canonical, alias, override, vault pointer, profile) are
 *     deleted below, and re-deleted from any env a test builds via
 *     {@link knowledgeTestEnv};
 *   - the DISK tier is anchored to a throwaway HOME (and HASNA_HOME /
 *     HASNA_CONFIG_HOME are cleared), so `~/.hasna/knowledge/config/credentials`
 *     resolves inside the temp dir and is simply absent;
 *   - the KEYCHAIN tier is off for the whole suite because `NODE_ENV=test`
 *     arms the outbound network guard, and `knowledgeKeychainTierOptions`
 *     turns tier 3 off whenever that guard is armed. A developer machine with
 *     a real `hasna.credentials.knowledge.api-key` item therefore measures the
 *     same thing CI does.
 *
 * With every tier closed the transport resolves to the on-box store — the
 * package's local mode — so no opt-in variable is set or needed. Tests that
 * exercise routing pass an explicit env object (which never reaches the
 * Keychain) or set and restore process.env inside their own lifecycle. The
 * outbound network guard remains the primary safety control; this preload
 * removes machine-dependent suite behavior rather than substituting for it.
 */
export const KNOWLEDGE_TEST_ROUTE_ENV_KEYS = [
  ...KNOWLEDGE_API_URL_ENV_KEYS,
  ...KNOWLEDGE_API_KEY_ENV_KEYS,
  ...RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS,
  RETIRED_KNOWLEDGE_LOCAL_ENV,
  credentialOverrideEnvKey(KNOWLEDGE_APP_SLUG),
  credentialPointerEnvKey(KNOWLEDGE_APP_SLUG),
  CREDENTIAL_PROFILE_ENV_KEY,
  HASNA_HOME_ENV_KEY,
  HASNA_CONFIG_HOME_ENV_KEY,
  'HASNA_KNOWLEDGE_DATABASE_URL',
] as const;

// The Keychain tier keys off this exact value; `bun test` sets it, and a
// runner that did not would otherwise let tier 3 read the login keychain.
process.env.NODE_ENV ??= 'test';

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
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  rmSync(isolatedTestHome, { recursive: true, force: true });
});
