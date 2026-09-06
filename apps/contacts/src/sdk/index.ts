/**
 * @hasna/contacts SDK — the hosted `/v1` client surface.
 *
 * Two constructors, one rule (hasna/apps#1720, #1794):
 *
 * - `new ContactsV1Client({ baseUrl, apiKey })` is the EXPLICIT pin: a
 *   caller-supplied authority is a deliberate selection, it always requires a
 *   caller-supplied key, and the ambient fleet credential is never attached to
 *   it.
 * - `createContactsClient()` goes through the ONE fleet resolver in
 *   `@hasna/contracts/client`, exactly like the CLI and the MCP server: the
 *   credential comes from an explicit argument, the deliberate env pointers
 *   (`HASNA_CONTACTS_API_KEY_OVERRIDE`, `HASNA_PROFILE`,
 *   `HASNA_CONTACTS_API_KEY_REF`), the macOS Keychain item
 *   `hasna.credentials.contacts.api-key`, `~/.hasna/contacts/config/credentials`
 *   (owner-only 0400/0600), then `HASNA_CONTACTS_API_KEY`; the authority follows
 *   `HASNA_CONTACTS_API_URL`, the Keychain `api-url` item, the credentials
 *   file, and defaults to the fleet gateway `https://api.hasna.com/contacts`
 *   once a credential resolves. The KEY is re-resolved on every request (a
 *   rotation heals a long-lived agent); the AUTHORITY is pinned for the life
 *   of the client, so a credential written for one service is never sent to
 *   another. Nothing resolving THROWS — there is no local fallback and no
 *   unauthenticated client.
 */
import { resolveCredential, type CredentialChainOptions, type KeychainTierOptions } from "@hasna/contracts/client";
import { ContactsClientConfigurationError, resolveContactsClientTransport } from "../cloud/http-storage.js";
import { contactsResolverCredentials, type Env } from "../cloud/resolver-inputs.js";
import {
  ContactsV1Client as GeneratedContactsV1Client,
  ApiError,
  type ContactsV1ClientOptions as GeneratedContactsV1ClientOptions,
} from "./v1.generated.js";

export interface ContactsV1ClientOptions
  extends Omit<GeneratedContactsV1ClientOptions, "baseUrl" | "apiKey"> {
  /** Explicit HTTPS service authority. No default is composed. */
  baseUrl: string;
  /** API key sent to the configured authority. Required and never logged.
   * An explicit baseUrl never falls back to an ambient fleet key (#1794). */
  apiKey?: string;
}

function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ContactsV1Client baseUrl must be an absolute HTTPS URL.");
  }
  if (url.protocol !== "https:") throw new Error("ContactsV1Client baseUrl must use HTTPS.");
  if (url.username || url.password) throw new Error("ContactsV1Client baseUrl must not contain credentials.");
  if (url.search || url.hash) throw new Error("ContactsV1Client baseUrl must not contain a query or fragment.");
  // Generated methods already prefix /v1: strip one trailing /v1 and keep any
  // gateway path prefix, so `https://api.hasna.com/contacts/v1` and
  // `https://api.hasna.com/contacts` both address `.../contacts/v1/<route>`.
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return url.toString().replace(/\/+$/, "");
}

function validateApiKey(apiKey: string | undefined): string {
  const key = (apiKey ?? "").trim();
  if (!key) throw new Error("ContactsV1Client requires an API key.");
  if (/[^\t\x20-\x7e]/.test(key)) {
    throw new Error("ContactsV1Client API key contains bytes that are invalid in an HTTP header.");
  }
  return key;
}

/**
 * Validated wrapper around the generated API surface. Redirects are never
 * followed, so credentials cannot cross to another authority.
 */
export class ContactsV1Client extends GeneratedContactsV1Client {
  constructor(options: ContactsV1ClientOptions) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    super({
      ...options,
      baseUrl: validateBaseUrl(options.baseUrl),
      apiKey: validateApiKey(options.apiKey),
      fetch: ((input, init) => fetchImpl(input, { ...init, redirect: "manual" })) as typeof fetch,
    });
  }
}

/** The app slug the shared client seam resolves credentials and authority for. */
export const CONTACTS_APP_NAME = "contacts" as const;

/** Options for {@link createContactsClient}. */
export interface CreateContactsClientOptions
  extends Omit<GeneratedContactsV1ClientOptions, "baseUrl" | "apiKey"> {
  /**
   * Explicit HTTPS authority — a deliberate pin. Requires `apiKey`; the ambient
   * chain is never consulted on its behalf (#1794).
   */
  baseUrl?: string;
  /**
   * Explicit API key (tier 1). With `baseUrl` it is the whole configuration;
   * alone, the authority still resolves through the chain.
   */
  apiKey?: string;
  /** The environment to resolve through instead of `process.env` — the hermetic seam. */
  env?: Env;
  /** Tier-1 identity selection (`--profile`), passed through to the chain. */
  profile?: string;
  /**
   * Tier-3 controls: a fake `security` runner in tests, an opt-out on a CI
   * Mac. Production callers pass nothing — the tier is ambient for
   * `process.env` and off for a caller-built env.
   */
  keychain?: KeychainTierOptions;
}

/** The SDK's refusal for an explicit authority without an explicit key (#1794). */
export function contactsSdkAuthorityPinMessage(): string {
  return (
    "an explicit baseUrl requires an explicit apiKey. The SDK never attaches a credential that " +
    "resolved for a different authority: pass `apiKey` explicitly, or omit `baseUrl` and let the " +
    "@hasna/contracts chain resolve both halves together."
  );
}

const SDK_HOSTED_ONLY = "The contacts SDK is hosted-only and never falls back to local data.";

/** One pass down the credential chain; a miss or an unusable tier is terminal. */
function resolveSdkCredential(env: Env, chainOptions: CredentialChainOptions): string {
  const credential = resolveCredential(CONTACTS_APP_NAME, env, chainOptions);
  if (!credential) {
    const diagnosis = resolveContactsClientTransport(CONTACTS_APP_NAME, env, chainOptions);
    throw new ContactsClientConfigurationError(
      "CONTACTS_API_NOT_CONFIGURED",
      `${diagnosis.issue ?? "No contacts credential resolved."} ${SDK_HOSTED_ONLY}`,
    );
  }
  if (credential.tier === "pointer") {
    throw new ContactsClientConfigurationError(
      "CONTACTS_CREDENTIAL_POINTER_UNSUPPORTED",
      `The contacts SDK resolves credentials synchronously and cannot complete the secrets-vault pointer ` +
        `${credential.source} per request. Use a literal tier instead: an explicit apiKey, the Keychain item ` +
        `hasna.credentials.${CONTACTS_APP_NAME}.api-key, ~/.hasna/${CONTACTS_APP_NAME}/config/credentials, ` +
        `or HASNA_CONTACTS_API_KEY.`,
    );
  }
  return credential.apiKey;
}

/**
 * Build a ContactsV1Client through the fleet resolver.
 *
 * - explicit `baseUrl` + `apiKey` → a deliberate pin, used verbatim; the
 *   ambient chain is never consulted (hasna/apps#1794).
 * - explicit `baseUrl` without `apiKey` → throws (no ambient key attach).
 * - otherwise the @hasna/contracts chain resolves credential + authority, and
 *   every request re-resolves the KEY on a fresh snapshot while the AUTHORITY
 *   stays pinned (a changed authority is a new client, never a key sent to the
 *   wrong server). Any refusal throws — there is no local fallback.
 */
export function createContactsClient(options: CreateContactsClientOptions = {}): ContactsV1Client {
  const { baseUrl, apiKey, env, profile, keychain, ...clientOptions } = options;

  if (baseUrl !== undefined) {
    if (!apiKey) throw new ContactsClientConfigurationError("CONTACTS_CREDENTIAL_PINNED", contactsSdkAuthorityPinMessage());
    return new ContactsV1Client({ ...clientOptions, baseUrl, apiKey });
  }

  const envObject: Env = env ?? (typeof process !== "undefined" ? (process.env as Env) : {});
  const requested: CredentialChainOptions = {
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(profile !== undefined ? { profile } : {}),
    ...(keychain !== undefined ? { keychain } : {}),
  };
  // #1788: the Keychain gate is decided on the ORIGINAL env, before the
  // per-request snapshot copy below exists, and travels as `keychain.enabled`.
  const chainOptions = contactsResolverCredentials(envObject, requested);

  // ONE pass down the credential chain; the resolved key is handed back as
  // tier 1 so the authority resolution does no second Keychain read.
  const initialKey = resolveSdkCredential(envObject, chainOptions);
  const resolution = resolveContactsClientTransport(CONTACTS_APP_NAME, envObject, { ...chainOptions, apiKey: initialKey });
  if (!resolution.configured || !resolution.baseUrl) {
    throw new ContactsClientConfigurationError(
      "CONTACTS_API_NOT_CONFIGURED",
      `${resolution.issue ?? "The contacts API client is not configured."} ${SDK_HOSTED_ONLY}`,
    );
  }
  const pinnedBaseUrl = resolution.baseUrl;

  const baseFetch = clientOptions.fetch ?? globalThis.fetch;
  const chainFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // A snapshot so a concurrent env mutation cannot tear one resolution; the
    // chain options carry the ambient decision made on the original env.
    const snapshot: Env = { ...envObject };
    const freshKey = resolveSdkCredential(snapshot, chainOptions);
    const current = resolveContactsClientTransport(CONTACTS_APP_NAME, snapshot, { ...chainOptions, apiKey: freshKey });
    if (!current.configured || current.baseUrl !== pinnedBaseUrl) {
      throw new ContactsClientConfigurationError(
        "CONTACTS_AUTHORITY_CHANGED",
        "Client authority changed or disappeared; construct a new client before sending data.",
      );
    }
    const headers = new Headers(init?.headers);
    headers.set("x-api-key", freshKey);
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;

  return new ContactsV1Client({ ...clientOptions, baseUrl: pinnedBaseUrl, apiKey: initialKey, fetch: chainFetch });
}

export { ContactsClientConfigurationError };
export { ApiError as ContactsV1ApiError };
export type {
  Contact as ContactsV1Contact,
  Company as ContactsV1Company,
  Tag as ContactsV1Tag,
  CreateContactInput as ContactsV1CreateContactInput,
  UpdateContactInput as ContactsV1UpdateContactInput,
  CreateCompanyInput as ContactsV1CreateCompanyInput,
  UpdateCompanyInput as ContactsV1UpdateCompanyInput,
  CreateTagInput as ContactsV1CreateTagInput,
  UpdateTagInput as ContactsV1UpdateTagInput,
  ProjectIdsInput as ContactsV1ProjectIdsInput,
  ContactProjectMembershipSnapshot as ContactsV1ProjectMembershipSnapshot,
  ContactProjectMembershipMutationInput as ContactsV1ProjectMembershipMutationInput,
  ContactProjectMembershipMutationResult as ContactsV1ProjectMembershipMutationResult,
  ContactProjectMembershipListResult as ContactsV1ProjectMembershipListResult,
} from "./v1.generated.js";
