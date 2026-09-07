/**
 * The routing preamble every surface runs before the credential chain: "did the
 * environment configure an attachments authority, and if not, did the operator
 * ask for the on-box store?"
 *
 * It lives in one leaf module because the CLI, the MCP server and the package
 * root all answer through the SAME store seam (`resolveStore`), and the seam
 * must be able to ask without pulling a second spelling of the resolver's env
 * names into existence. Its only import is the env-key derivation from
 * @hasna/contracts, so the NAMES it looks for are the resolver's own rather
 * than a copy that can fall behind.
 *
 * SINCE the 1720 adoption every hosted Hasna CLI resolves its credential and
 * its service authority through the ONE resolver in `@hasna/contracts/client`
 * (see `client-config.ts`). attachments contributes no tier of its own: no
 * `~/.hasna/fleet-env`, no `~/.hasna/cloud`, no `~/.config/hasna`, no
 * `$XDG_CONFIG_HOME`, no credential in `~/.attachments/config.json`, and no
 * `*_MODE` / `*_STORAGE_MODE` switch (the retired storage-mode variables are
 * inert; nothing reads them).
 *
 * LOCAL MODE IS DELIBERATE, NEVER A FALLBACK FROM FAILURE. The on-box SQLite
 * store is reachable ONLY through the deliberate unhosted opt-in:
 * `HASNA_ATTACHMENTS_DB_PATH` / `ATTACHMENTS_DB_PATH` (an explicit file — the
 * narrowest, most specific signal, and the precedence-1 local selector) or
 * `HASNA_ATTACHMENTS_LOCAL=1` (alias `ATTACHMENTS_LOCAL=1`) when the
 * environment configures no authority. Hosted mode with no credential exits
 * non-zero with one clear line; there is no local fallback and no
 * `*-local-fallback` event.
 *
 * ORDER, AND WHY IT IS THIS WAY ROUND. A configured environment outranks the
 * flag opt-in: a run with `HASNA_ATTACHMENTS_API_KEY` set goes hosted (and a
 * half-configured one fails loudly) rather than quietly serving a different
 * dataset because a stale `HASNA_ATTACHMENTS_LOCAL` was lying around. But when
 * the environment configures nothing, the opt-in is answered WITHOUT calling
 * the resolver at all — no Keychain item and no credential file is read — and
 * that is what lets the test suite promise that a scrubbed test environment
 * physically cannot reach the shared store.
 *
 * `ATTACHMENTS_DB_PATH` is the one deliberate exception to "the flag loses to
 * a configured environment": an explicit file path has always outranked even a
 * complete API configuration, because it is the operator saying "THIS file, on
 * THIS box" — the same narrowest-signal rule the resolver's own tiers use for
 * credentials. It is answered before the resolver too.
 */
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";
import type { AttachmentsCredentialChainOptions } from "./client-config";

/** The deliberate unhosted opt-in flag, canonical name first. */
export const ATTACHMENTS_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_ATTACHMENTS_LOCAL", "ATTACHMENTS_LOCAL"] as const;

/** The explicit local SQLite file — the narrowest signal, precedence 1. */
export const ATTACHMENTS_DB_PATH_ENV_KEYS = ["HASNA_ATTACHMENTS_DB_PATH", "ATTACHMENTS_DB_PATH"] as const;

/**
 * The retired storage-mode variables. The resolver never reads them — they are
 * inert since the adoption stripped the fail-loud ratchet — but test harnesses
 * DELETE them so a fixture can never depend on a stale fragment from the host
 * environment, and docs list them as removed.
 */
export const REMOVED_ATTACHMENTS_MODE_ENV_KEYS = [
  "HASNA_ATTACHMENTS_STORAGE_MODE",
  "HASNA_ATTACHMENTS_MODE",
  "ATTACHMENTS_STORAGE_MODE",
  "ATTACHMENTS_MODE",
] as const;

export type AttachmentsLocalOptInEnv = Record<string, string | undefined>;

/** True when the operator deliberately asked for the unhosted local store. */
export function isAttachmentsLocalOptIn(env: AttachmentsLocalOptInEnv = process.env): boolean {
  return ATTACHMENTS_LOCAL_OPT_IN_ENV_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/** True when the environment pins an explicit local SQLite file. */
export function hasExplicitLocalDbPath(env: AttachmentsLocalOptInEnv = process.env): boolean {
  return ATTACHMENTS_DB_PATH_ENV_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/** Every env name that can configure an attachments authority or credential, resolver-derived. */
export function attachmentsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("attachments");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("attachments"),
    credentialPointerEnvKey("attachments"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure an attachments authority or credential?
 *
 * Deliberately narrower than "does a credential resolve": answering it must not
 * touch the Keychain or the filesystem, because doing so would defeat the
 * isolation the opt-in short-circuit exists to provide. It reads the env
 * dictionary and nothing else.
 *
 * A DECLARED-BUT-BLANK variable counts as absent HERE — a blank has always been
 * this package's spelling for "not configured", and helpers in the wild blank
 * rather than delete. It is NOT absent once we do go hosted: the resolver
 * refuses a blank loudly rather than falling through to another identity,
 * which is the behaviour that matters at that point.
 */
export function hasAttachmentsEnvAuthorityIntent(env: AttachmentsLocalOptInEnv = process.env): boolean {
  return attachmentsAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/**
 * True when this environment should be served by the on-box SQLite store.
 *
 * An explicit DB path wins unconditionally (precedence 1 — the narrowest
 * signal). The flag opt-in wins only when the environment configures no
 * authority or credential at all, and both are answered WITHOUT the resolver,
 * so the Keychain and the credential file are never read for a local run.
 */
export function selectsAttachmentsLocalStore(env: AttachmentsLocalOptInEnv = process.env): boolean {
  if (hasExplicitLocalDbPath(env)) return true;
  return !hasAttachmentsEnvAuthorityIntent(env) && isAttachmentsLocalOptIn(env);
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * A blank has always been this package's spelling for "not configured" — it is
 * how fixtures scrubbed an inherited environment and how the CLI's test
 * harnesses neutralise routing. @hasna/contracts takes the opposite and, for
 * its purposes, correct view: a declared-but-blank credential is a
 * misconfiguration it refuses loudly rather than resolving around.
 *
 * Both are right at their own layer, and the mismatch is not hypothetical: an
 * environment carrying a real `HASNA_ATTACHMENTS_API_KEY` alongside a blank
 * legacy alias — the exact shape a scrubbed-then-overridden fixture produces —
 * is a complete, unambiguous configuration that would otherwise be refused for
 * the alias nobody set. Normalising here keeps "blank means unset" true at the
 * attachments seam while leaving the resolver's stricter rule intact for
 * everything it does receive.
 */
export function attachmentsResolverEnv<T extends AttachmentsLocalOptInEnv>(env: T): T {
  const blanks = attachmentsAuthorityEnvKeys().filter(
    (key) => key in env && (env[key] ?? "").trim() === "",
  );
  if (blanks.length === 0) return env;
  const next = { ...env } as T;
  for (const key of blanks) delete next[key];
  return next;
}

/**
 * @hasna/contracts marks the LIVE process environment with this symbol so its
 * ambient tiers — the macOS Keychain `api-key` and `api-url` items, which
 * belong to the machine rather than to any env object — know they were handed
 * the real environment and not a caller-built one. It is a registry symbol
 * precisely so a normaliser like ours can read it without importing internals.
 */
const CONTRACTS_AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

/**
 * Is this the environment the machine's ambient credential stores belong to?
 *
 * The same test @hasna/contracts performs, run on the env BEFORE we normalise
 * it — which is the whole point of asking here.
 */
function isAmbientAttachmentsEnv(env: AttachmentsLocalOptInEnv): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/** The env object and credential options a surfaces hands @hasna/contracts. */
export interface AttachmentsResolverInputs<T extends AttachmentsLocalOptInEnv> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: AttachmentsCredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * WHY THIS IS NOT JUST {@link attachmentsResolverEnv}. Blanking a variable and
 * deleting it are not the same operation to @hasna/contracts, because dropping
 * a key forces us to hand the resolver a COPY, and the resolver gates its
 * ambient tiers on OBJECT IDENTITY (`env === process.env`, or the registry
 * symbol its own snapshot carries). A copy is, by that test, a caller-built
 * world — the hermetic seam — so the Keychain is outside it and tier 3 turns
 * itself off. Silently: there is no error, no warning and no diagnostic,
 * because from the resolver's side nothing went wrong.
 *
 * On a station whose Keychain holds `hasna.credentials.attachments.api-key`,
 * ONE declared-but-blank authority variable — any name in
 * {@link attachmentsAuthorityEnvKeys}, canonical or legacy — would drop the
 * run from the Keychain identity to whatever came next. A deliberate tier must
 * never fall through to another identity, so the gate is decided HERE, on the
 * original env, and carried across the copy as the documented
 * `keychain.enabled` control rather than being left to an identity test the
 * copy cannot pass.
 *
 * An explicit `enabled` from the caller still wins, and an injected `run`
 * (which @hasna/contracts already treats as "enabled") is left alone, so the
 * hermetic seam tests rely on is untouched. When there is no blank to remove
 * the inputs pass through by identity, exactly as before.
 */
export function attachmentsResolverInputs<T extends AttachmentsLocalOptInEnv>(
  env: T,
  credentials: AttachmentsCredentialChainOptions = {},
): AttachmentsResolverInputs<T> {
  const normalised = attachmentsResolverEnv(env);
  // Identity survived: the resolver can run its own ambient test as usual.
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientAttachmentsEnv(env);
  }
  return { env: normalised, credentials: { ...credentials, keychain } };
}

let localModeNoticePrinted = false;

/** Reset the once-per-process local-mode notice. Test seam only. */
export function __resetAttachmentsLocalModeNotice(): void {
  localModeNoticePrinted = false;
}

/**
 * The one stderr line a local-mode run MUST print (owner ruling 2026-09-04,
 * fail-closed wave): "local" — so a run that is deliberately serving the
 * on-box store can never be mistaken for a hosted one. Printed once per
 * process by the store seam (`resolveStore`); a long-lived server that
 * re-resolves per request does not spam the notice. A no-op unless the
 * environment actually selects the on-box store.
 */
export function announceAttachmentsLocalMode(
  env: AttachmentsLocalOptInEnv = process.env,
  stderr: (line: string) => void = (line) => {
    if (typeof process !== "undefined") process.stderr.write(`${line}\n`);
  },
): void {
  if (localModeNoticePrinted) return;
  if (!selectsAttachmentsLocalStore(env)) return;
  const explicitDbPath = ATTACHMENTS_DB_PATH_ENV_KEYS.find((key) => (env[key] ?? "").trim() !== "");
  const flag = ATTACHMENTS_LOCAL_OPT_IN_ENV_KEYS.find((key) => (env[key] ?? "").trim() !== "");
  const reason = explicitDbPath
    ? `explicit ${explicitDbPath}`
    : flag
      ? `explicit ${flag}`
      : "nothing configures an attachments authority";
  localModeNoticePrinted = true;
  stderr(`attachments: LOCAL mode — serving the on-box SQLite store (${reason}), not the hosted fleet.`);
}