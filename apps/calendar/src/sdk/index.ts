/**
 * Calendar SDK — the hosted `/v1` client surface.
 *
 * The credential and the authority come from the ONE fleet resolver in
 * `@hasna/contracts/client` (owner ruling 2026-09-04, hasna/apps#1720),
 * resolved FRESH on every request. The tiers, in order: an explicit argument
 * (`apiKey` / `profile`), the deliberate env pointers (`HASNA_CALENDAR_API_KEY_OVERRIDE`,
 * `HASNA_PROFILE`, `HASNA_CALENDAR_API_KEY_REF`), the macOS Keychain item
 * `hasna.credentials.calendar.api-key`, the credentials file
 * `~/.hasna/calendar/config/credentials` (owner-only 0400/0600), then
 * `HASNA_CALENDAR_API_KEY`. The authority follows `HASNA_CALENDAR_API_URL`,
 * the Keychain `api-url` item, the credentials file, and defaults to the fleet
 * gateway `https://api.hasna.com/calendar` (the client appends `/v1`) once a
 * credential resolves — a key alone is a complete configuration. The
 * unprefixed `CALENDAR_*` spellings remain as the resolver's documented silent
 * alias.
 *
 * THERE IS NO LOCAL FALLBACK: an SDK client with no resolvable credential
 * THROWS, so a caller can never read a local dataset while believing it is
 * talking to the fleet.
 *
 * THE AUTHORITY IS PINNED (#1794). An explicit `baseUrl` is a deliberate
 * selection and is never resolved around. With an explicit `apiKey` it is the
 * whole configuration; WITHOUT one the SDK refuses — it never attaches a
 * credential that resolved for a different authority, and it never consults
 * the ambient chain on behalf of an explicit URL. A client built from the
 * chain pins the credential it resolved with to the authority that resolved
 * alongside it: the transport re-resolves the chain on every request for the
 * KEY, but the AUTHORITY is fixed for the life of the client, so a credential
 * written for one service is never sent to another.
 *
 * Through the chain (not pinned by explicit arguments), every request re-runs
 * the resolution and overwrites `x-api-key` with the key the chain resolves
 * NOW, so a rotation heals a long-lived agent without a restart.
 */
import {
  resolveClientTransport as resolveContractsClientTransport,
  resolveCredential,
  type CredentialChainOptions,
} from "@hasna/contracts/client";
import { CalendarV1Client, type CalendarV1ClientOptions } from "./v1.generated.js";
import {
  calendarResolverInputs,
  type CalendarCredentialChainOptions,
  type CalendarEnv,
  type CalendarKeychainTierOptions,
} from "../store/local-opt-in.js";

/** The app slug the shared client seam resolves credentials and authority for. */
export const CALENDAR_APP_NAME = "calendar" as const;

export type { CalendarV1ClientOptions };
export { CalendarV1Client as CalendarClient } from "./v1.generated.js";
export * from "./v1.generated.js";

/** Options accepted on top of the resolved transport. */
export interface CreateCalendarClientOptions extends Partial<CalendarV1ClientOptions> {
  /** The environment to resolve through, instead of `process.env`. */
  env?: CalendarEnv;
  /** Tier-1 identity selection (`--profile`), passed through to the seam. */
  profile?: string;
  /**
   * Tier-3 controls: a `security` runner for tests, or an opt-out on a CI Mac.
   * Production callers pass nothing — the tier is ambient for `process.env`
   * and off for a caller-built env.
   */
  keychain?: CalendarKeychainTierOptions;
}

/** The SDK's fail-closed refusal for an empty credential. Never a fallback. */
export function calendarSdkCredentialMissingMessage(): string {
  return (
    "CALENDAR_CREDENTIAL_MISSING: no Calendar credential resolved from the macOS Keychain item " +
    `hasna.credentials.${CALENDAR_APP_NAME}.api-key, ~/.hasna/${CALENDAR_APP_NAME}/config/credentials, ` +
    "or HASNA_CALENDAR_API_KEY; the /v1 SDK is hosted-only and never falls back to local data."
  );
}

/** The SDK's refusal for an explicit authority without an explicit key (#1794). */
export function calendarSdkAuthorityPinMessage(): string {
  return (
    "CALENDAR_CREDENTIAL_PINNED: an explicit baseUrl requires an explicit apiKey. " +
    "The SDK never attaches a credential that resolved for a different authority: pass `apiKey` " +
    "explicitly, or omit `baseUrl` and let the @hasna/contracts chain resolve both halves together."
  );
}

/**
 * Build a CalendarV1Client through the fleet resolver.
 *
 * - explicit `baseUrl` + `apiKey` → a deliberate pin, used verbatim; the
 *   ambient chain is never consulted (hasna/apps#1794).
 * - explicit `baseUrl` without `apiKey` → throws (no ambient key attach).
 * - otherwise the @hasna/contracts chain resolves credential + authority fresh
 *   on every request (the key is refreshed per request; the authority is fixed
 *   for the life of the client), and any refusal throws — there is no local
 *   fallback and no unauthenticated client.
 */
export function createCalendarClient(options: CreateCalendarClientOptions = {}): CalendarV1Client {
  const { baseUrl, apiKey, env, profile, keychain, fetch: fetchOverride, headers } = options;

  // Tier 1 pin: an explicit authority is a deliberate selection. Never
  // resolved around — with an apiKey it is the whole configuration; without
  // one the SDK refuses rather than attaching a credential the caller did not
  // name for that authority.
  if (baseUrl !== undefined) {
    if (!apiKey) throw new Error(calendarSdkAuthorityPinMessage());
    return new CalendarV1Client({ baseUrl, apiKey, fetch: fetchOverride, headers });
  }

  const envObject: CalendarEnv = env ?? (typeof process !== "undefined" ? (process.env as CalendarEnv) : {});
  const requestedCredentials: CalendarCredentialChainOptions = {
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(profile !== undefined ? { profile } : {}),
    ...(keychain !== undefined ? { keychain } : {}),
  };
  // #1788: normalising blank variables hands the resolver a COPY, and a copy
  // is not the ambient environment its Keychain tier gates on — so the gate is
  // decided on the ORIGINAL env and carried across as `keychain.enabled`.
  const inputs = calendarResolverInputs(envObject, requestedCredentials);

  const credential = resolveCredential(CALENDAR_APP_NAME, inputs.env, inputs.credentials as CredentialChainOptions);
  if (!credential) throw new Error(calendarSdkCredentialMissingMessage());
  if (credential.tier === "pointer") {
    throw new Error(
      `Calendar resolves credentials synchronously and cannot complete the secrets-vault pointer ` +
        `${credential.source} per request. Use a literal credential tier instead: an explicit apiKey argument, ` +
        `the Keychain item hasna.credentials.${CALENDAR_APP_NAME}.api-key, ` +
        `~/.hasna/${CALENDAR_APP_NAME}/config/credentials, or HASNA_CALENDAR_API_KEY.`,
    );
  }

  // ONE pass down the chain (a repeated Keychain spawn is the failure this
  // avoids): the resolved key is handed back as tier 1, so the authority
  // resolution does no second read. The authority the key resolved with is the
  // only authority this client will ever address.
  let resolution: ReturnType<typeof resolveContractsClientTransport>;
  try {
    resolution = resolveContractsClientTransport(CALENDAR_APP_NAME, inputs.env, {
      credentials: { ...inputs.credentials, apiKey: credential.apiKey } as CredentialChainOptions,
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const baseFetch = fetchOverride ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  // Per-request freshness, mirroring the generated client's constraint that
  // the key is stored at construction: rather than forking the generated file,
  // the credential is refreshed in the fetch wrapper, which overwrites
  // `x-api-key` with the key the chain resolves NOW. A re-resolution that
  // throws or comes back empty leaves the constructed header in place, so a
  // transient unreadable Keychain cannot turn a working client into a failing
  // one mid-flight.
  const chainFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headersInit = new Headers(init?.headers);
    try {
      const fresh = resolveCredential(CALENDAR_APP_NAME, inputs.env, inputs.credentials as CredentialChainOptions);
      if (fresh && fresh.tier !== "pointer") headersInit.set("x-api-key", fresh.apiKey);
    } catch {
      // keep the credential the client was constructed with
    }
    return baseFetch(input, { ...init, headers: headersInit });
  }) as typeof fetch;

  return new CalendarV1Client({
    baseUrl: resolution.baseUrl,
    apiKey: credential.apiKey,
    fetch: chainFetch,
    ...(headers ? { headers } : {}),
  });
}