import { getExaApiKey, requireExaApiKey, type ExaAuthOptions } from "./exa.js";

export const EXA_WEBSETS_BASE_URL = "https://api.exa.ai/websets/v0";

type FetchFn = typeof fetch;

export interface ExaWebsetsClientOptions extends ExaAuthOptions {
  baseUrl?: string;
  fetch?: FetchFn;
}

export interface WebsetSourceRef {
  id: string;
}

export interface WebsetScopeRef extends WebsetSourceRef {
  relationship?: Record<string, unknown>;
}

export interface WebsetImportRef extends WebsetSourceRef {
  evaluate?: boolean;
}

export interface WebsetCriterionInput {
  description: string;
}

export type WebsetEntityInput =
  | { type: "company" }
  | { type: "person" }
  | { type: "article" }
  | { type: "research_paper" }
  | { type: "custom"; description: string };

export type WebsetMetadata = Record<string, string>;

export interface WebsetSearchInput {
  query: string;
  count?: number;
  entity?: WebsetEntityInput;
  criteria?: WebsetCriterionInput[];
  maxPeoplePerCompany?: number;
  exclude?: WebsetSourceRef[];
  scope?: WebsetScopeRef[];
  recall?: boolean;
  behavior?: "override" | "append";
  metadata?: WebsetMetadata;
}

export interface WebsetEnrichmentInput {
  description: string;
  format?: string;
  options?: Array<{ label: string }>;
  instructions?: string;
  metadata?: WebsetMetadata;
}

export interface CreateWebsetInput {
  title?: string | null;
  search?: WebsetSearchInput;
  "import"?: WebsetImportRef[];
  enrichments?: WebsetEnrichmentInput[];
  exclude?: WebsetSourceRef[];
  externalId?: string;
  metadata?: WebsetMetadata;
}

export interface WebsetSearch extends Record<string, unknown> {
  id: string;
  object: "webset_search" | string;
  websetId: string;
  query: string;
  status?: string;
}

export interface WebsetItem extends Record<string, unknown> {
  id: string;
  object: "webset_item" | string;
  sourceId?: string;
  websetId: string;
  properties: Record<string, unknown>;
}

export interface Webset extends Record<string, unknown> {
  id: string;
  object: "webset" | string;
  status: string;
  externalId: string | null;
  title: string | null;
  searches: WebsetSearch[];
  enrichments: Array<Record<string, unknown>>;
  dashboardUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebsetsPage<T> {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ListWebsetsOptions {
  cursor?: string;
  limit?: number;
  search?: string;
}

export interface ListWebsetItemsOptions {
  cursor?: string;
  limit?: number;
  sourceId?: string;
}

export interface GetWebsetOptions {
  expand?: "items"[];
}

export interface WaitForWebsetOptions extends ExaWebsetsClientOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

function buildWebsetsUrl(
  path: string,
  query: Record<string, string | number | boolean | readonly string[] | undefined> = {},
  baseUrl = EXA_WEBSETS_BASE_URL,
): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(normalizedPath, normalizedBase);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function redactSensitiveValue(value: string, sensitive: string): string {
  return sensitive ? value.split(sensitive).join("[redacted]") : value;
}

async function readExaError(response: Response, apiKey: string): Promise<string | undefined> {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;

  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    const detail = parsed.error ?? parsed.message;
    return typeof detail === "string" ? redactSensitiveValue(detail, apiKey) : undefined;
  } catch {
    return redactSensitiveValue(text, apiKey).slice(0, 300);
  }
}

async function exaWebsetsRequest<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | readonly string[] | undefined> },
  options: ExaWebsetsClientOptions = {},
): Promise<T> {
  const apiKey = requireExaApiKey(options);
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(buildWebsetsUrl(path, init.query, options.baseUrl), {
    method: init.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      "x-api-key": apiKey,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (!response.ok) {
    const detail = await readExaError(response, apiKey);
    throw new Error(
      `Exa Websets API error: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
    );
  }

  return (await response.json()) as T;
}

export function isExaWebsetsConfigured(options: ExaAuthOptions = {}): boolean {
  return Boolean(getExaApiKey(options));
}

export function createWebset(input: CreateWebsetInput, options?: ExaWebsetsClientOptions): Promise<Webset> {
  return exaWebsetsRequest<Webset>("/websets", { method: "POST", body: input }, options);
}

export function getWebset(
  id: string,
  getOptions: GetWebsetOptions = {},
  clientOptions?: ExaWebsetsClientOptions,
): Promise<Webset> {
  return exaWebsetsRequest<Webset>(`/websets/${encodeURIComponent(id)}`, {
    query: { expand: getOptions.expand },
  }, clientOptions);
}

export function listWebsets(
  listOptions: ListWebsetsOptions = {},
  clientOptions?: ExaWebsetsClientOptions,
): Promise<WebsetsPage<Webset>> {
  return exaWebsetsRequest<WebsetsPage<Webset>>("/websets", {
    query: {
      cursor: listOptions.cursor,
      limit: listOptions.limit,
      search: listOptions.search,
    },
  }, clientOptions);
}

export function listWebsetItems(
  webset: string,
  listOptions: ListWebsetItemsOptions = {},
  clientOptions?: ExaWebsetsClientOptions,
): Promise<WebsetsPage<WebsetItem>> {
  return exaWebsetsRequest<WebsetsPage<WebsetItem>>(`/websets/${encodeURIComponent(webset)}/items`, {
    query: {
      cursor: listOptions.cursor,
      limit: listOptions.limit,
      sourceId: listOptions.sourceId,
    },
  }, clientOptions);
}

export function createWebsetSearch(
  webset: string,
  input: WebsetSearchInput,
  clientOptions?: ExaWebsetsClientOptions,
): Promise<WebsetSearch> {
  return exaWebsetsRequest<WebsetSearch>(`/websets/${encodeURIComponent(webset)}/searches`, {
    method: "POST",
    body: input,
  }, clientOptions);
}

export async function waitForWebsetIdle(webset: string, options: WaitForWebsetOptions = {}): Promise<Webset> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const current = await getWebset(webset, {}, options);
    if (current.status === "idle") return current;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Exa Webset ${webset} to become idle; last status: ${current.status}`);
    }
    await Bun.sleep(pollIntervalMs);
  }
}
