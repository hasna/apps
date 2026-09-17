import {
  GeneratedInstructionsV1Client,
  type BoundedConfigIdentityPage,
  type BoundedConfigPage,
  type BoundedMachinePage,
  type BoundedProfileAssetBindingPage,
  type BoundedProfileConfigBindingPage,
  type BoundedProfileIdentityPage,
  type BoundedProfilePage,
  type BoundedSnapshotPage,
  type ConfigIdentity,
  type ConfigSnapshot,
  type GeneratedInstructionsV1ClientOptions,
  type ProfileIdentity,
} from "./v1.generated.js";

export type InstructionsV1ClientOptions = GeneratedInstructionsV1ClientOptions;

type ConfigListQuery = {
  category?: string;
  agent?: string;
  kind?: string;
  search?: string;
  limit?: number;
  cursor?: number;
  view?: "identity";
};
type ProfileListQuery = { limit?: number; cursor?: number; view?: "identity" };
type MachineListQuery = { limit?: number; cursor?: number; view?: "identity" };
type SnapshotListQuery = { limit?: number; cursor?: number };
type BindingListQuery = { limit?: number; cursor?: number };
type SnapshotCreateBody = { content?: string; version?: number };

const REQUEST_INIT_KEYS = new Set([
  "body",
  "cache",
  "credentials",
  "headers",
  "integrity",
  "keepalive",
  "method",
  "mode",
  "priority",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "window",
]);

function isRequestInit(value: unknown): value is RequestInit {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).some((key) => REQUEST_INIT_KEYS.has(key)),
  );
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function configIdentity(value: Record<string, unknown>): ConfigIdentity {
  return {
    id: String(value.id ?? ""),
    name: String(value.name ?? ""),
    slug: String(value.slug ?? ""),
    kind: String(value.kind ?? ""),
    category: String(value.category ?? ""),
    agent: String(value.agent ?? ""),
    format: String(value.format ?? ""),
    is_template: Boolean(value.is_template),
    version: Number(value.version ?? 0),
    created_at: String(value.created_at ?? ""),
    updated_at: String(value.updated_at ?? ""),
    synced_at: value.synced_at == null ? null : String(value.synced_at),
  };
}

function profileIdentity(value: Record<string, unknown>): ProfileIdentity {
  return {
    id: String(value.id ?? ""),
    name: String(value.name ?? ""),
    slug: String(value.slug ?? ""),
    created_at: String(value.created_at ?? ""),
    updated_at: String(value.updated_at ?? ""),
  };
}

function normalizeLegacyPage<T>(
  value: unknown,
  alias: string,
  query: { limit?: number; cursor?: number } | undefined,
  project?: (record: Record<string, unknown>) => T,
): {
  items: T[];
  total: number;
  limit: number;
  cursor: number;
  next_cursor: number | null;
  has_more: boolean;
  complete: boolean;
  truncated: false;
  source_bounded: false;
  count: number;
} & Record<string, unknown> {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (Array.isArray(record.items)) return value as never;
  const legacy = record[alias];
  if (!Array.isArray(legacy)) {
    throw new Error(`Instructions V1 ${alias} response is neither bounded nor a complete legacy array`);
  }
  const cursor = positiveInteger(query?.cursor, 0);
  const defaultLimit = Math.max(legacy.length, 1);
  const limit = Math.max(1, positiveInteger(query?.limit, defaultLimit));
  const source = legacy as Record<string, unknown>[];
  const items = source.slice(cursor, cursor + limit).map((item) => project ? project(item) : item as T);
  const total = source.length;
  const consumed = cursor + items.length;
  const complete = consumed >= total;
  return {
    [alias]: items,
    items,
    count: items.length,
    total,
    limit,
    cursor,
    next_cursor: complete ? null : consumed,
    has_more: !complete,
    complete,
    truncated: false,
    source_bounded: false,
  };
}

/**
 * Generated `/v1` client with wire compatibility for the deployed 0.5 API and
 * positional compatibility for the pre-0.7 snapshot methods.
 */
export class InstructionsV1Client extends GeneratedInstructionsV1Client {
  constructor(options: GeneratedInstructionsV1ClientOptions) {
    super(options);
  }

  override async listConfigs(
    query?: ConfigListQuery,
    init?: RequestInit,
  ): Promise<BoundedConfigPage | BoundedConfigIdentityPage> {
    const response = await super.listConfigs(query, init);
    return normalizeLegacyPage(
      response,
      "configs",
      query,
      query?.view === "identity" ? configIdentity : undefined,
    ) as BoundedConfigPage | BoundedConfigIdentityPage;
  }

  override async listProfiles(
    query?: ProfileListQuery,
    init?: RequestInit,
  ): Promise<BoundedProfilePage | BoundedProfileIdentityPage> {
    const response = await super.listProfiles(query, init);
    return normalizeLegacyPage(
      response,
      "profiles",
      query,
      query?.view === "identity" ? profileIdentity : undefined,
    ) as BoundedProfilePage | BoundedProfileIdentityPage;
  }

  override async listMachines(
    query?: MachineListQuery,
    init?: RequestInit,
  ): Promise<BoundedMachinePage> {
    const response = await super.listMachines(query, init);
    return normalizeLegacyPage(response, "machines", query) as BoundedMachinePage;
  }


  async getProfileConfigBindings(id: string, init?: RequestInit): Promise<BoundedProfileConfigBindingPage>;
  async getProfileConfigBindings(id: string, query?: BindingListQuery, init?: RequestInit): Promise<BoundedProfileConfigBindingPage>;
  override async getProfileConfigBindings(
    id: string,
    queryOrInit?: BindingListQuery | RequestInit,
    init?: RequestInit,
  ): Promise<BoundedProfileConfigBindingPage> {
    const legacyInit = isRequestInit(queryOrInit) && init === undefined;
    const query = legacyInit ? undefined : queryOrInit as BindingListQuery | undefined;
    const requestInit = legacyInit ? queryOrInit as RequestInit : init;
    const response = await super.getProfileConfigBindings(id, query, requestInit);
    return normalizeLegacyPage(response, "bindings", query) as BoundedProfileConfigBindingPage;
  }

  async getProfileAssetBindings(id: string, init?: RequestInit): Promise<BoundedProfileAssetBindingPage>;
  async getProfileAssetBindings(id: string, query?: BindingListQuery, init?: RequestInit): Promise<BoundedProfileAssetBindingPage>;
  override async getProfileAssetBindings(
    id: string,
    queryOrInit?: BindingListQuery | RequestInit,
    init?: RequestInit,
  ): Promise<BoundedProfileAssetBindingPage> {
    const legacyInit = isRequestInit(queryOrInit) && init === undefined;
    const query = legacyInit ? undefined : queryOrInit as BindingListQuery | undefined;
    const requestInit = legacyInit ? queryOrInit as RequestInit : init;
    const response = await super.getProfileAssetBindings(id, query, requestInit);
    return normalizeLegacyPage(response, "assets", query) as BoundedProfileAssetBindingPage;
  }

  async listSnapshots(id: string, init?: RequestInit): Promise<BoundedSnapshotPage>;
  async listSnapshots(id: string, query?: SnapshotListQuery, init?: RequestInit): Promise<BoundedSnapshotPage>;
  override async listSnapshots(
    id: string,
    queryOrInit?: SnapshotListQuery | RequestInit,
    init?: RequestInit,
  ): Promise<BoundedSnapshotPage> {
    const legacyInit = isRequestInit(queryOrInit) && init === undefined;
    const query = legacyInit ? undefined : queryOrInit as SnapshotListQuery | undefined;
    const requestInit = legacyInit ? queryOrInit as RequestInit : init;
    const response = await super.listSnapshots(id, query, requestInit);
    return normalizeLegacyPage<ConfigSnapshot>(response, "snapshots", query) as BoundedSnapshotPage;
  }

  async createSnapshot(id: string, init?: RequestInit): Promise<{ snapshot?: ConfigSnapshot }>;
  async createSnapshot(id: string, body?: SnapshotCreateBody, init?: RequestInit): Promise<{ snapshot?: ConfigSnapshot }>;
  override async createSnapshot(
    id: string,
    bodyOrInit?: SnapshotCreateBody | RequestInit,
    init?: RequestInit,
  ): Promise<{ snapshot?: ConfigSnapshot }> {
    const legacyInit = isRequestInit(bodyOrInit) && init === undefined;
    const body = legacyInit ? undefined : bodyOrInit as SnapshotCreateBody | undefined;
    const requestInit = legacyInit ? bodyOrInit as RequestInit : init;
    return super.createSnapshot(id, body, requestInit);
  }
}
