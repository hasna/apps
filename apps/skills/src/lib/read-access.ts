/**
 * The gate every DATA surface runs before it answers from the bundled corpus,
 * and the one registry those surfaces show.
 *
 * `skills list` has resolved through the fleet ladder since the fail-closed
 * ruling (owner directive 2026-09-04, hasna/apps#1720): with no credential, no
 * authority and no `HASNA_SKILLS_LOCAL=1` opt-in it exits 1 naming the refusal,
 * opens nothing and serves nothing. `skills info` / `docs` / `requires`, the
 * bare non-TTY listing and the MCP discovery tools (`list_skills`,
 * `search_skills`, `get_skill_info`, `get_skill_docs`, `list_categories`,
 * `list_tags`, `get_requirements`) did NOT — they read `loadRegistry()` and
 * answered from the bundled catalog plus `~/.hasna/skills/installed` at exit 0
 * with no notice, on the very machine `skills list` had just refused (#1720
 * validation, round 1). Two surfaces that disagree about whether an install is
 * configured is the false green the ruling removed, so they now share this one
 * gate with the browsing commands.
 *
 *   - refused (nothing configured, no opt-in; an authority with no key; a
 *     deliberate selection that cannot be honoured) → `SkillsFleetCredentialError`
 *     from the shared ladder, carried to the caller unchanged: the CLI prints
 *     its one line and exits 1, an MCP tool answers `AUTH_REQUIRED`.
 *   - the explicit local opt-in → `{ mode: "local" }`; the ladder has announced
 *     local mode once on stderr, and the caller serves the on-machine answer.
 *   - a credential resolves → `{ mode: "hosted", apiOrigin }`. The key is
 *     deliberately NOT returned here: a surface that only reads local data has
 *     no business holding it, and the surfaces that send it resolve it again
 *     at request time (`remoteRequestHeaders`, per call, completing a vault
 *     pointer if that is the tier).
 *
 * Resolved fresh on every call — the resolver contract — so a credential that
 * appears, rotates or disappears mid-process is honoured by the next call.
 */

import { resolveSkillsConnection, type SkillsFleetOptions } from "./fleet-credentials.js";
import { loadRegistryProfile, type SkillMeta, type SkillRegistryProfile } from "./registry.js";
import { mergeSkillRegistryLists } from "./registry-merge.js";
import { loadRemoteRegistry, mergeRemoteRegistry } from "./remote-registry.js";

type Env = Record<string, string | undefined>;

/** Where a read surface stands, once the ladder has let it through. Never carries a key. */
export type SkillsReadAccess = { mode: "hosted"; apiOrigin: string } | { mode: "local" };

/**
 * Run the fail-closed routing preamble for a read surface.
 *
 * Throws {@link SkillsFleetCredentialError} when the ladder refuses; the
 * caller must let that refusal out (as a non-zero exit or a structured error),
 * never swallow it into a local answer.
 */
export async function requireSkillsReadAccess(
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): Promise<SkillsReadAccess> {
  const connection = await resolveSkillsConnection(env, options);
  return connection ? { mode: "hosted", apiOrigin: connection.apiOrigin } : { mode: "local" };
}

/**
 * The registry a browsing surface should show — the CLI's `list` / `search` /
 * `categories` / `tags` and the MCP discovery tools, from ONE implementation.
 *
 * The default read path is folder UNION cloud: whenever the install is pointed
 * at a hosted instance (a resolved credential, and HASNA_SKILLS_API_URL for your
 * own instance) the authenticated remote registry joins the local listing even
 * without `--remote`. The explicit local opt-in keeps today's exact local
 * output; an unconfigured or auth-missing install is a refusal, thrown from the
 * shared ladder (fail-closed R1 — see mergeRemoteRegistry()).
 *
 * `--remote` used to REPLACE the local registry: `skills list --remote` returned exactly
 * what the instance served and nothing else, so the bundled corpus and every skill the
 * operator had written locally disappeared from the listing the moment they pointed the
 * CLI at their own server. It now MERGES, under the precedence documented in
 * src/lib/registry-merge.ts: custom > extension > local > remote > official, "whichever
 * copy this machine would actually use wins the listing".
 *
 * The profile (`all` vs the curated basic set) applies to the local half only. The
 * instance's skills are never filtered by it: the basic profile is a hand-written list of
 * ten bundled names, so applying it to remote entries would drop every published skill
 * from `skills list --remote` - the same disappearance this change exists to fix.
 *
 * A remote failure is still fatal. An explicit `--remote` request (and a configured,
 * authenticated default read) that fails surfaces a clear error, and silently returning
 * the local half of a merge the user asked to include the remote half in would report
 * success for a listing that is missing entries.
 */
export async function getBrowseRegistry(options: { all?: boolean; remote?: boolean } = {}): Promise<SkillMeta[]> {
  const profile: SkillRegistryProfile = options.all ? "all" : "basic";
  const local = loadRegistryProfile(profile);
  if (options.remote) {
    // Explicit request: the merge is mandatory, and a missing origin is an error.
    const remote = await loadRemoteRegistry();
    return mergeSkillRegistryLists(local, remote);
  }
  return mergeRemoteRegistry(local);
}
