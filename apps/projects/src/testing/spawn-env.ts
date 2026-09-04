/**
 * Test-only helper: build the environment for a spawned `projects` CLI/MCP
 * process.
 *
 * Tests inherit `process.env`, and operator machines routinely export hosted
 * API selectors for Projects and its Todos, Mementos, and Conversations
 * authorities. Inheriting those turns local tests into runs against the *real*
 * backends, which both masks local-store regressions and creates real rows as a
 * side effect of `bun test`.
 *
 * So: blank the hosted API selectors from the inherited environment unless the
 * test explicitly opts into the hosted backend by passing them in `overrides`.
 * Blanking (rather than deleting) is load-bearing: the shared
 * @hasna/contracts seam reads the fleet app-config files on disk (e.g.
 * `~/.hasna/cloud/projects.env`) when the environment is silent, so deleting
 * the keys would let the disk tier select the real hosted backend anyway. An
 * explicitly DEFINED-but-blank URL is the seam's own "select the local store"
 * escape hatch and beats any disk pointer.
 *
 * The store resolution FAILS CLOSED (owner ruling 2026-09-04): with the hosted
 * selectors blanked, a registry command would throw unless the local registry
 * is explicitly opted into. Tests that deliberately exercise the on-box SQLite
 * registry therefore default `HASNA_PROJECTS_LOCAL_REGISTRY=1` in the spawned
 * environment. A test that wants to assert the fail-closed behavior overrides
 * the key with an empty string.
 */
import { PROJECTS_LOCAL_REGISTRY_ENV } from "../store/project-store.js";

export const HOSTED_API_ENV_KEYS = [
  "HASNA_PROJECTS_API_URL",
  "HASNA_PROJECTS_API_KEY",
  "PROJECTS_API_URL",
  "PROJECTS_API_KEY",
  "HASNA_TODOS_API_URL",
  "HASNA_TODOS_API_KEY",
  "HASNA_TODOS_DB_PATH",
  "TODOS_API_URL",
  "TODOS_API_KEY",
  "TODOS_DB_PATH",
  "HASNA_MEMENTOS_API_URL",
  "HASNA_MEMENTOS_API_KEY",
  "HASNA_MEMENTOS_DB_PATH",
  "MEMENTOS_API_URL",
  "MEMENTOS_API_KEY",
  "MEMENTOS_DB_PATH",
  "HASNA_CONVERSATIONS_API_URL",
  "HASNA_CONVERSATIONS_API_KEY",
  "HASNA_CONVERSATIONS_DB_PATH",
  "CONVERSATIONS_API_URL",
  "CONVERSATIONS_API_KEY",
  "CONVERSATIONS_DB_PATH",
] as const;

export function testSpawnEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    env[key] = value;
  }
  for (const key of HOSTED_API_ENV_KEYS) {
    if (!(key in overrides)) env[key] = "";
  }
  // Explicit local-registry opt-in for spawned processes: store resolution
  // fails closed without it (no silent local fallback), and these tests run
  // the CLI against the on-box SQLite registry by default.
  if (!(PROJECTS_LOCAL_REGISTRY_ENV in overrides)) env[PROJECTS_LOCAL_REGISTRY_ENV] = "1";
  return { ...env, ...overrides };
}
