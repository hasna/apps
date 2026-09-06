/** @hasna/contacts SDK — explicit authenticated HTTPS `/v1` client. */
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
  const path = url.pathname.replace(/\/+$/, "");
  if (path && path !== "/v1") {
    throw new Error("ContactsV1Client baseUrl must be an authority root or end in /v1.");
  }
  // Generated methods already prefix /v1.
  url.pathname = "";
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
