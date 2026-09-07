/**
 * Runtime configuration for @hasna/hooks.
 *
 * Transport policy (fleet fail-closed doctrine, 2026-09-04): the remote
 * registry is selected and authenticated by the ONE resolver in
 * `@hasna/contracts/client` (strict URL+key pair, resolved fresh per call —
 * see `src/lib/transport.ts`). Without a resolved pair the CLI must FAIL
 * CLOSED instead of silently serving the local store. Local mode (bundled
 * registry + local SQLite at the effective data root) is an explicit opt-in
 * via HASNA_HOOKS_LOCAL=1 / HOOKS_LOCAL=1 — never the default for a CLI run.
 *
 * The app's own credential chain is gone: no `~/.hasna/fleet-env`,
 * `~/.hasna/cloud`, `~/.config/hasna` or `$XDG_CONFIG_HOME` read, no
 * `~/.hasna/hooks/config.json` `api_url` / `api_key_ref` key store, no
 * `HASNA_HOOKS_REGISTRY_URL` / `HOOKS_REGISTRY_URL` spellings, no `*_MODE`
 * transport switches. The authority and the credential both come from
 * @hasna/contracts, which resolves per call: Keychain `hasna.credentials.hooks.*`,
 * disk `~/.hasna/hooks/config/credentials`, then `HASNA_HOOKS_API_URL` /
 * `HASNA_HOOKS_API_KEY` (the unprefixed `HOOKS_*` spellings remain only as the
 * resolver's silent alias fallback).
 */

import { join } from "path";
import { getEffectiveDataRoot } from "./lib/app-home.js";

export function getHooksDataDir(): string {
  return getEffectiveDataRoot();
}

export function getCustomHooksDir(): string {
  return join(getHooksDataDir(), "hooks");
}

export function getLockPath(): string {
  const explicit = process.env.HASNA_HOOKS_LOCK_PATH ?? process.env.HOOKS_LOCK_PATH;
  if (explicit) return explicit;
  return join(getHooksDataDir(), "hooks.lock");
}

/**
 * The legacy `config.json` reader/writer and its `api_url` / `api_key_ref`
 * fields were REMOVED (hasna/apps#1720): the file was this package's own
 * configuration key store, outranked the canonical env names for operators who
 * had both, and carried a secret-valued reference outside the resolver's
 * chain. The registry authority and its credential now resolve exclusively
 * through `@hasna/contracts` (env, Keychain item `hasna.credentials.hooks.api-url`
 * / `.api-key`, and `~/.hasna/hooks/config/credentials`).
 */