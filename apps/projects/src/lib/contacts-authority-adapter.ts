import { resolveClientTransport, resolveCredential } from "@hasna/contracts/client";
import type {
  ContactProjectMembershipAuthority,
  ContactProjectMembershipListResult,
  ContactProjectMembershipMutationInput,
  ContactProjectMembershipMutationResult,
  ContactProjectMembershipSnapshot,
} from "./project-contact-links.js";
import { canonicalProjectResourceLinkUri } from "./project-resource-links.js";

/** Process-environment shape accepted by the shared @hasna/contracts seam. */
type Env = Record<string, string | undefined>;

export interface ContactsHttpProjectMembershipAuthorityOptions {
  baseUrl: string;
  apiKey: string;
  serviceInstance?: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface ContactsAuthorityEnvironment {
  HASNA_CONTACTS_API_URL?: string;
  CONTACTS_API_URL?: string;
  HASNA_CONTACTS_API_KEY?: string;
  CONTACTS_API_KEY?: string;
  HASNA_CONTACTS_SERVICE_INSTANCE?: string;
  CONTACTS_SERVICE_INSTANCE?: string;
}

export class ContactsAuthorityHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;

  constructor(input: { status: number; method: string; path: string; detail: string }) {
    super(`Contacts authority ${input.method} ${input.path} failed: ${input.detail}`);
    this.name = "ContactsAuthorityHttpError";
    this.status = input.status;
    this.method = input.method;
    this.path = input.path;
  }
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`projects contacts adapter: set ${label}`);
  return normalized;
}

function v1BaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("projects contacts adapter: API URL must use http or https");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? path : `${path}/v1`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function defaultServiceInstance(value: string): string {
  const url = new URL(value);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return canonicalProjectResourceLinkUri(
    url.toString(),
    "projects contacts adapter service instance",
  );
}

async function responseJson<T>(response: Response, method: string, path: string): Promise<T> {
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const detail = body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error)
      : `${response.status}`;
    throw new ContactsAuthorityHttpError({
      status: response.status,
      method,
      path,
      detail,
    });
  }
  return body as T;
}

export class ContactsHttpProjectMembershipAuthority implements ContactProjectMembershipAuthority {
  readonly service_instance: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;

  constructor(options: ContactsHttpProjectMembershipAuthorityOptions) {
    this.baseUrl = v1BaseUrl(required(options.baseUrl, "HASNA_CONTACTS_API_URL"));
    this.apiKey = required(options.apiKey, "HASNA_CONTACTS_API_KEY");
    this.service_instance = options.serviceInstance
      ? canonicalProjectResourceLinkUri(
        options.serviceInstance.trim(),
        "projects contacts adapter service instance",
      )
      : defaultServiceInstance(this.baseUrl);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    query?: Record<string, string | number>,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return responseJson<T>(await this.fetchImpl(url.toString(), init), method, path);
  }

  readMembership(input: {
    contact_id: string;
    project_id: string;
  }): Promise<ContactProjectMembershipSnapshot> {
    return this.request(
      "GET",
      `/projects/${encodeURIComponent(input.project_id)}/contact-memberships/${encodeURIComponent(input.contact_id)}`,
    );
  }

  listProjectMemberships(input: {
    project_id: string;
    max_items: number;
  }): Promise<ContactProjectMembershipListResult> {
    return this.request(
      "GET",
      `/projects/${encodeURIComponent(input.project_id)}/contact-memberships`,
      { max_items: input.max_items },
    );
  }

  attach(input: ContactProjectMembershipMutationInput): Promise<ContactProjectMembershipMutationResult> {
    return this.mutate("attach", input);
  }

  detach(input: ContactProjectMembershipMutationInput): Promise<ContactProjectMembershipMutationResult> {
    return this.mutate("detach", input);
  }

  private mutate(
    direction: "attach" | "detach",
    input: ContactProjectMembershipMutationInput,
  ): Promise<ContactProjectMembershipMutationResult> {
    return this.request(
      "POST",
      `/projects/${encodeURIComponent(input.project_id)}/contact-memberships/${encodeURIComponent(input.contact_id)}/${direction}`,
      undefined,
      {
        operation_id: input.operation_id,
        step_id: input.step_id,
        expected_version: input.expected_version,
      },
    );
  }
}

export function createContactsProjectMembershipAuthorityFromEnv(
  env: ContactsAuthorityEnvironment | NodeJS.ProcessEnv = process.env,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
): ContactsHttpProjectMembershipAuthority {
  // The Contacts pairing resolves through the shared client seam, never by
  // hand: the seam owns the five-tier credential ladder (argument, env pointer,
  // Keychain, ~/.hasna/contacts/config/credentials, plain env), the matching
  // authority ladder, and the default fleet gateway. It THROWS on a declared
  // authority with no resolvable key, so this function has no fail-closed
  // branch of its own to keep in sync.
  const resolution = resolveClientTransport("contacts", env as Env);
  const credential = resolveCredential("contacts", env as Env);
  const serviceInstance = env.HASNA_CONTACTS_SERVICE_INSTANCE ?? env.CONTACTS_SERVICE_INSTANCE;
  return new ContactsHttpProjectMembershipAuthority({
    baseUrl: required(resolution.baseUrl ?? undefined, "HASNA_CONTACTS_API_URL (or CONTACTS_API_URL)"),
    apiKey: required(credential?.apiKey, "HASNA_CONTACTS_API_KEY (or CONTACTS_API_KEY)"),
    ...(serviceInstance ? { serviceInstance } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
