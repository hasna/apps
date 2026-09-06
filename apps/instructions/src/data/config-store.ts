// Single Store abstraction for the instructions app.
//
// CREDENTIALS ARE NOT RESOLVED HERE ANY MORE. Since the 2026-09-04 adoption
// ruling (hasna/apps#1720, and #1668 / #1690 / #1613 / #1599) every hosted
// Hasna CLI resolves its credential and its service authority through the ONE
// resolver in `@hasna/contracts/client` (see ../lib/transport-resolver.ts), so
// this module contributes no tier of its own: no direct `HASNA_INSTRUCTIONS_API_URL`
// read, no Keychain or credentials-file handling of our own, no mode switch.
// The chain, resolved fresh on every call:
//
//   1. an explicit argument      — `credentials.apiKey` / `credentials.profile`
//   2. a deliberate env pointer  — `HASNA_INSTRUCTIONS_API_KEY_OVERRIDE`,
//                                  `HASNA_PROFILE`, `HASNA_INSTRUCTIONS_API_KEY_REF`
//   3. the macOS Keychain        — generic-password `hasna.credentials.instructions.api-key`,
//                                  account `HASNA_STATION`, else `hostname -s`, else `USER`
//   4. disk                      — `~/.hasna/instructions/config/credentials`,
//                                  owner-only 0400/0600 (`HASNA_HOME` / `HASNA_CONFIG_HOME`
//                                  move the root; XDG never)
//   5. `HASNA_INSTRUCTIONS_API_KEY` — a legitimate tier below disk, no deprecation notice
//
// and the authority follows `HASNA_INSTRUCTIONS_API_URL`, then the Keychain
// `api-url` item, then the credentials file, and finally defaults to the fleet
// gateway `https://api.hasna.com/instructions` (the client appends `/v1`). The
// legacy unprefixed `INSTRUCTIONS_*` spellings survive only as the resolver's
// silent alias fallback for one release; the canonical `HASNA_INSTRUCTIONS_*`
// names are the documented ones and are what every message here names.
//
// Retired locations — `~/.hasna/fleet-env/`, `~/.hasna/cloud/`,
// `~/.config/hasna/` — are inputs nowhere, and no `*_MODE` / `*_STORAGE_MODE`
// variable is read: the transport is decided by what RESOLVES, never by a mode
// word.
//
// FAIL LOUD. Hosted mode with no credential exits non-zero with one clear line;
// there is no SQLite fallback and no local-fallback event. The on-box SQLite
// store is reachable ONLY through the deliberate unhosted opt-in
// `HASNA_INSTRUCTIONS_LOCAL=1` (../lib/local-opt-in.ts), and every local run
// says "local" on stderr.
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  createConfig as dbCreateConfig,
  deleteConfig as dbDeleteConfig,
  getConfig as dbGetConfig,
  getConfigById as dbGetConfigById,
  getConfigStats as dbGetConfigStats,
  listConfigs as dbListConfigs,
  updateConfig as dbUpdateConfig,
} from "../db/configs.js";
import {
  addConfigToProfile as dbAddConfigToProfile,
  createProfile as dbCreateProfile,
  deleteProfile as dbDeleteProfile,
  getProfile as dbGetProfile,
  getProfileConfigsPage as dbGetProfileConfigsPage,
  getProfileConfigBindings as dbGetProfileConfigBindings,
  listProfilesPage as dbListProfilesPage,
  removeConfigFromProfile as dbRemoveConfigFromProfile,
  resolveProfileForMachineRead as dbResolveProfileForMachineRead,
  setProfileConfigBinding as dbSetProfileConfigBinding,
  updateProfile as dbUpdateProfile,
  addAssetToProfile as dbAddAssetToProfile,
  getProfileAssetBindings as dbGetProfileAssetBindings,
  removeAssetFromProfile as dbRemoveAssetFromProfile,
  setProfileAssetBinding as dbSetProfileAssetBinding,
} from "../db/profiles.js";
import {
  createSnapshot as dbCreateSnapshot,
  getSnapshot as dbGetSnapshot,
  getSnapshotByVersion as dbGetSnapshotByVersion,
  listSnapshots as dbListSnapshots,
  pruneSnapshots as dbPruneSnapshots,
} from "../db/snapshots.js";
import {
  listMachines as dbListMachines,
  registerMachine as dbRegisterMachine,
  updateMachineApplied as dbUpdateMachineApplied,
} from "../db/machines.js";
import { insertFeedback as dbInsertFeedback, resetLocalDatabase as dbResetLocalDatabase, type FeedbackInput } from "../db/database.js";
import { ConfigNotFoundError, ProfileNotFoundError } from "../types/index.js";
import type {
  Config,
  ConfigFilter,
  ConfigSnapshot,
  CreateConfigInput,
  CreateProfileInput,
  Machine,
  MachineContext,
  Profile,
  BoundedReadOptions,
  BoundedReadPage,
  ProfileResolutionRead,
  UpdateConfigInput,
  UpdateProfileInput,
  ProfileConfigBinding,
  ProfileConfigBindingSpec,
  ProfileAssetBinding,
  ProfileAssetBindingSpec,
} from "../types/index.js";
import { boundedReadPage, normalizeBoundedReadOptions } from "../lib/bounded-read.js";
import { legacyProfileConfigBinding } from "../lib/instruction-graph.js";
import { INSTRUCTIONS_LOCAL_OPT_IN_ENV, INSTRUCTIONS_LOCAL_OPT_IN_ENV_KEYS, announceLocalInstructionsMode, isInstructionsLocalOptIn, resolveInstructionsStorageClient, type InstructionsResolverOptions } from "../lib/transport-resolver.js";
import { selectsInstructionsLocalStore } from "../lib/local-opt-in.js";
import type { InstructionsClientEnv, InstructionsStorageClient, InstructionsCredentialChainOptions } from "../lib/client-types.js";

function parseBoundedPagePayload<T>(value: unknown, label: string): BoundedReadPage<T> {
  const page = value as Partial<BoundedReadPage<T>> | null;
  const consumed = Number(page?.cursor) + (page?.items?.length ?? 0);
  const complete = Boolean(page && Number.isSafeInteger(page.total) && consumed >= Number(page.total));
  if (
    !page ||
    !Array.isArray(page.items) ||
    !Number.isSafeInteger(page.total) ||
    Number(page.total) < 0 ||
    !Number.isSafeInteger(page.limit) ||
    Number(page.limit) < 1 ||
    !Number.isSafeInteger(page.cursor) ||
    Number(page.cursor) < 0 ||
    page.items.length > Number(page.limit) ||
    typeof page.has_more !== "boolean" ||
    typeof page.complete !== "boolean" ||
    page.truncated !== false ||
    (page.next_cursor !== null && !Number.isSafeInteger(page.next_cursor)) ||
    page.complete !== complete ||
    page.has_more !== !complete ||
    page.next_cursor !== (complete ? null : consumed)
  ) {
    throw new Error(`${label} returned an invalid or truncated bounded-read envelope`);
  }
  return {
    ...(page as BoundedReadPage<T>),
    source_bounded: page.source_bounded ?? true,
  };
}

function parseBoundedOrLegacyPage<T>(
  value: unknown,
  legacyItems: unknown,
  options: BoundedReadOptions,
  label: string,
): BoundedReadPage<T> {
  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    if (
      "items" in candidate ||
      "total" in candidate ||
      "complete" in candidate ||
      "truncated" in candidate ||
      "next_cursor" in candidate
    ) {
      return parseBoundedPagePayload<T>(value, label);
    }
  }
  if (!Array.isArray(legacyItems)) {
    throw new Error(`${label} returned neither a bounded envelope nor a complete legacy array`);
  }
  const normalized = normalizeBoundedReadOptions(options);
  const page = boundedReadPage(
    legacyItems.slice(normalized.cursor, normalized.cursor + normalized.limit) as T[],
    legacyItems.length,
    normalized,
  );
  return { ...page, source_bounded: false };
}

/**
 * The explicit opt-in for the on-box SQLite store.
 *
 * Owner directive 2026-09-04: a CLI run without a hosted credential must FAIL
 * CLOSED (non-zero exit naming the required env) and must never open the local
 * SQLite store as a default. `HASNA_INSTRUCTIONS_LOCAL=1` is the documented
 * opt-in that re-enables the local transport for operators who want it — and
 * it is honoured only when the environment configures no authority and no
 * credential (see ../lib/local-opt-in.ts), so a hosted pair can never be
 * silently overridden by a stale opt-in.
 */
export const LOCAL_OPT_IN_ENV = INSTRUCTIONS_LOCAL_OPT_IN_ENV;

/** True when the operator explicitly opted in to the local SQLite store. */
export function isLocalOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return isInstructionsLocalOptIn(env as InstructionsClientEnv);
}

/** True when the HTTP API transport is active (a hosted credential resolves). */
export function isApiTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  // Throws on a refused configuration (URL without key, unusable file), exactly
  // as the previous "exactly one env var set" refusal did — the caller has
  // already failed closed through resolveConfigStore by the time this is asked.
  const { transport } = resolveInstructionsStorageClient(env as InstructionsClientEnv);
  return transport === "http";
}

/**
 * True when `err` is a cloud authentication failure — an HTTP 401/403 from the
 * `/v1` API, which is what a missing, expired, or revoked key produces.
 * Matches the @hasna/contracts `HasnaHttpError` shape by name + status (never
 * `instanceof`, which is unreliable across bundle boundaries).
 */
export function isCloudAuthError(err: unknown): err is Error & { status: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "HasnaHttpError" &&
    ((err as { status?: unknown }).status === 401 || (err as { status?: unknown }).status === 403)
  );
}

/**
 * True when `err` is the transport's not-found error (404). Matched by shape,
 * never `instanceof`, for the same bundle-boundary reason as above.
 */
function isNotFoundHttpError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "HasnaHttpError" &&
    (err as { status?: unknown }).status === 404
  );
}

/**
 * Render an error for CLI/user display. A cloud auth failure (401/403 — e.g. a
 * revoked or invalid key) is rewritten into a clear, actionable re-auth message
 * so the operator is not blocked by a raw transport error: they can rotate the
 * key or explicitly opt in to the local store (`HASNA_INSTRUCTIONS_LOCAL=1`).
 * The transport never echoes the server's 401/403 response body (that body is
 * the one place a rejected request can reflect credential material back into
 * logs), so no server note is rendered. All other errors fall back to their
 * plain message (unchanged behaviour).
 */
export function formatCliError(err: unknown, env: NodeJS.ProcessEnv = process.env): string {
  if (isCloudAuthError(err)) {
    return [
      `Instructions cloud API rejected the request (HTTP ${err.status}: authentication failed).`,
      `  The API key in use is missing, expired, or revoked (the transport never echoes the server's 401/403 body).`,
      `  To continue, either:`,
      `    - set a valid key:   export HASNA_INSTRUCTIONS_API_KEY=<new-key>`,
      `      (or add the Keychain item hasna.credentials.instructions.api-key, or write`,
      `       ~/.hasna/instructions/config/credentials)`,
      `    - or opt in to the local store explicitly:   export ${LOCAL_OPT_IN_ENV}=1`,
    ].join("\n");
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * The single Store contract. Two transports implement it: LocalConfigStore
 * (on-box SQLite) and CloudConfigStore (HTTP /v1 through the shared resolver).
 */
export interface ConfigStore {
  readonly mode: "local" | "api";
  /** The resolved `<origin>/v1` base for a hosted store; null for the local store. */
  readonly v1BaseUrl: string | null;
  // Configs
  listConfigs(filter?: ConfigFilter): Promise<Config[]>;
  getConfig(idOrSlug: string): Promise<Config>;
  getConfigById(id: string): Promise<Config>;
  createConfig(input: CreateConfigInput): Promise<Config>;
  updateConfig(idOrSlug: string, input: UpdateConfigInput): Promise<Config>;
  deleteConfig(idOrSlug: string): Promise<void>;
  getConfigStats(): Promise<Record<string, number>>;
  // Snapshots
  listSnapshots(configId: string): Promise<ConfigSnapshot[]>;
  getSnapshot(id: string): Promise<ConfigSnapshot | null>;
  getSnapshotByVersion(configId: string, version: number): Promise<ConfigSnapshot | null>;
  createSnapshot(configId: string, content: string, version: number): Promise<ConfigSnapshot>;
  pruneSnapshots(configId: string, keep?: number): Promise<number>;
  // Profiles
  listProfiles(): Promise<Profile[]>;
  listProfilesPage(options?: BoundedReadOptions): Promise<BoundedReadPage<Profile>>;
  getProfile(idOrSlug: string): Promise<Profile>;
  getProfileConfigs(idOrSlug: string): Promise<Config[]>;
  getProfileConfigsPage(idOrSlug: string, options?: BoundedReadOptions): Promise<BoundedReadPage<Config>>;
  getProfileConfigBindings(idOrSlug: string): Promise<ProfileConfigBinding[]>;
  createProfile(input: CreateProfileInput): Promise<Profile>;
  updateProfile(idOrSlug: string, input: UpdateProfileInput): Promise<Profile>;
  deleteProfile(idOrSlug: string): Promise<void>;
  addConfigToProfile(profileIdOrSlug: string, configId: string): Promise<void>;
  setProfileConfigBinding(profileIdOrSlug: string, configId: string, binding: ProfileConfigBindingSpec): Promise<ProfileConfigBinding>;
  removeConfigFromProfile(profileIdOrSlug: string, configId: string): Promise<void>;
  getProfileAssetBindings(profileIdOrSlug: string): Promise<ProfileAssetBinding[]>;
  addAssetToProfile(profileIdOrSlug: string, sourceConfigId: string, binding: ProfileAssetBindingSpec): Promise<ProfileAssetBinding>;
  setProfileAssetBinding(profileIdOrSlug: string, assetKey: string, binding: ProfileAssetBindingSpec): Promise<ProfileAssetBinding>;
  removeAssetFromProfile(profileIdOrSlug: string, assetKey: string): Promise<void>;
  resolveProfileForMachine(machine?: MachineContext): Promise<Profile | null>;
  resolveProfileForMachineRead(machine?: MachineContext, options?: BoundedReadOptions): Promise<ProfileResolutionRead>;
  // Machines
  registerMachine(hostname?: string, os?: string, arch?: string): Promise<Machine>;
  updateMachineApplied(hostname?: string): Promise<void>;
  listMachines(): Promise<Machine[]>;
  // Feedback
  sendFeedback(input: FeedbackInput): Promise<void>;
  // Lifecycle
  /**
   * Destroy all data in this store (used by `init --force`). Local: wipes the
   * on-disk SQLite database. Api: forbidden — you cannot wipe the shared cloud
   * store from a client, so the CloudConfigStore throws.
   */
  reset(): Promise<void>;
}

/**
 * Local SQLite-backed store (wraps the synchronous db layer). Accepts an
 * explicit `Database` handle for isolated use (tests); otherwise uses the
 * process-wide singleton via the db layer's default.
 */
export class LocalConfigStore implements ConfigStore {
  readonly mode = "local" as const;
  readonly v1BaseUrl: string | null = null;
  constructor(private readonly db?: Database) {}

  // Configs
  async listConfigs(filter?: ConfigFilter): Promise<Config[]> {
    return dbListConfigs(filter, this.db);
  }
  async getConfig(idOrSlug: string): Promise<Config> {
    return dbGetConfig(idOrSlug, this.db);
  }
  async getConfigById(id: string): Promise<Config> {
    return dbGetConfigById(id, this.db);
  }
  async createConfig(input: CreateConfigInput): Promise<Config> {
    return dbCreateConfig(input, this.db);
  }
  async updateConfig(idOrSlug: string, input: UpdateConfigInput): Promise<Config> {
    return dbUpdateConfig(idOrSlug, input, this.db);
  }
  async deleteConfig(idOrSlug: string): Promise<void> {
    dbDeleteConfig(idOrSlug, this.db);
  }
  async getConfigStats(): Promise<Record<string, number>> {
    return dbGetConfigStats(this.db);
  }
  // Snapshots
  async listSnapshots(configId: string): Promise<ConfigSnapshot[]> {
    return dbListSnapshots(configId, this.db);
  }
  async getSnapshot(id: string): Promise<ConfigSnapshot | null> {
    return dbGetSnapshot(id, this.db);
  }
  async getSnapshotByVersion(configId: string, version: number): Promise<ConfigSnapshot | null> {
    return dbGetSnapshotByVersion(configId, version, this.db);
  }
  async createSnapshot(configId: string, content: string, version: number): Promise<ConfigSnapshot> {
    return dbCreateSnapshot(configId, content, version, this.db);
  }
  async pruneSnapshots(configId: string, keep = 10): Promise<number> {
    return dbPruneSnapshots(configId, keep, this.db);
  }
  // Profiles
  async listProfiles(): Promise<Profile[]> {
    const profiles: Profile[] = [];
    let cursor = 0;
    while (true) {
      const page = await this.listProfilesPage({ limit: 100, cursor });
      profiles.push(...page.items);
      if (page.complete) return profiles;
      cursor = page.next_cursor!;
    }
  }
  async listProfilesPage(options: BoundedReadOptions = {}): Promise<BoundedReadPage<Profile>> {
    return dbListProfilesPage(options, this.db);
  }
  async getProfile(idOrSlug: string): Promise<Profile> {
    return dbGetProfile(idOrSlug, this.db);
  }
  async getProfileConfigs(idOrSlug: string): Promise<Config[]> {
    const configs: Config[] = [];
    let cursor = 0;
    while (true) {
      const page = await this.getProfileConfigsPage(idOrSlug, { limit: 100, cursor });
      configs.push(...page.items);
      if (page.complete) return configs;
      cursor = page.next_cursor!;
    }
  }
  async getProfileConfigsPage(idOrSlug: string, options: BoundedReadOptions = {}): Promise<BoundedReadPage<Config>> {
    return dbGetProfileConfigsPage(idOrSlug, options, this.db);
  }
  async getProfileConfigBindings(idOrSlug: string): Promise<ProfileConfigBinding[]> {
    return dbGetProfileConfigBindings(idOrSlug, this.db);
  }
  async createProfile(input: CreateProfileInput): Promise<Profile> {
    return dbCreateProfile(input, this.db);
  }
  async updateProfile(idOrSlug: string, input: UpdateProfileInput): Promise<Profile> {
    return dbUpdateProfile(idOrSlug, input, this.db);
  }
  async deleteProfile(idOrSlug: string): Promise<void> {
    dbDeleteProfile(idOrSlug, this.db);
  }
  async addConfigToProfile(profileIdOrSlug: string, configId: string): Promise<void> {
    dbAddConfigToProfile(profileIdOrSlug, configId, this.db);
  }
  async setProfileConfigBinding(profileIdOrSlug: string, configId: string, binding: ProfileConfigBindingSpec): Promise<ProfileConfigBinding> {
    return dbSetProfileConfigBinding(profileIdOrSlug, configId, binding, this.db);
  }
  async removeConfigFromProfile(profileIdOrSlug: string, configId: string): Promise<void> {
    dbRemoveConfigFromProfile(profileIdOrSlug, configId, this.db);
  }
  async getProfileAssetBindings(profileIdOrSlug: string): Promise<ProfileAssetBinding[]> {
    return dbGetProfileAssetBindings(profileIdOrSlug, this.db);
  }
  async addAssetToProfile(profileIdOrSlug: string, sourceConfigId: string, binding: ProfileAssetBindingSpec): Promise<ProfileAssetBinding> {
    return dbAddAssetToProfile(profileIdOrSlug, sourceConfigId, binding, this.db);
  }
  async setProfileAssetBinding(profileIdOrSlug: string, assetKey: string, binding: ProfileAssetBindingSpec): Promise<ProfileAssetBinding> {
    return dbSetProfileAssetBinding(profileIdOrSlug, assetKey, binding, this.db);
  }
  async removeAssetFromProfile(profileIdOrSlug: string, assetKey: string): Promise<void> {
    dbRemoveAssetFromProfile(profileIdOrSlug, assetKey, this.db);
  }
  async resolveProfileForMachine(machine?: MachineContext): Promise<Profile | null> {
    return (await this.resolveProfileForMachineRead(machine)).profile;
  }
  async resolveProfileForMachineRead(
    machine?: MachineContext,
    options: BoundedReadOptions = {},
  ): Promise<ProfileResolutionRead> {
    return machine
      ? dbResolveProfileForMachineRead(machine, options, this.db)
      : dbResolveProfileForMachineRead(undefined, options, this.db);
  }
  // Machines
  async registerMachine(hostname?: string, os?: string, arch?: string): Promise<Machine> {
    return dbRegisterMachine(hostname, os, arch, this.db);
  }
  async updateMachineApplied(hostname?: string): Promise<void> {
    dbUpdateMachineApplied(hostname, this.db);
  }
  async listMachines(): Promise<Machine[]> {
    return dbListMachines(this.db);
  }
  async sendFeedback(input: FeedbackInput): Promise<void> {
    dbInsertFeedback(input, this.db);
  }
  async reset(): Promise<void> {
    dbResetLocalDatabase();
  }
}

/** Cloud store: routes every operation to the `/v1` HTTP API through the contracts transport. */
export class CloudConfigStore implements ConfigStore {
  readonly mode = "api" as const;
  /** The resolved `<origin>/v1` authority this store dials. */
  readonly v1BaseUrl: string;
  private readonly client: InstructionsStorageClient;

  constructor(client: InstructionsStorageClient) {
    this.client = client;
    this.v1BaseUrl = client.baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { idempotent?: boolean; allow404?: boolean } = {},
  ): Promise<{ status: number; data: T | null }> {
    try {
      const data = await this.client.transport.request<T>(method, path, body, {
        ...(opts.idempotent ? { idempotencyKey: randomUUID() } : {}),
      });
      return { status: 200, data };
    } catch (err) {
      if (opts.allow404 && isNotFoundHttpError(err)) return { status: 404, data: null };
      throw err;
    }
  }

  // Configs
  async listConfigs(filter: ConfigFilter = {}): Promise<Config[]> {
    const params = new URLSearchParams();
    if (filter.category) params.set("category", filter.category);
    if (filter.agent) params.set("agent", filter.agent);
    if (filter.kind) params.set("kind", filter.kind);
    if (filter.search) params.set("search", filter.search);
    const qs = params.toString();
    const { data } = await this.request<{ configs: Config[] }>(
      "GET",
      `/configs${qs ? `?${qs}` : ""}`,
    );
    let configs = data?.configs ?? [];
    if (filter.tags && filter.tags.length > 0) {
      configs = configs.filter((c) => filter.tags!.every((t) => c.tags.includes(t)));
    }
    if (filter.is_template !== undefined) {
      configs = configs.filter((c) => c.is_template === filter.is_template);
    }
    return configs;
  }

  async getConfig(idOrSlug: string): Promise<Config> {
    const { status, data } = await this.request<{ config: Config }>(
      "GET",
      `/configs/${encodeURIComponent(idOrSlug)}`,
      undefined,
      { allow404: true },
    );
    if (status === 404 || !data?.config) throw new ConfigNotFoundError(idOrSlug);
    return data.config;
  }

  async getConfigById(id: string): Promise<Config> {
    return this.getConfig(id);
  }

  async createConfig(input: CreateConfigInput): Promise<Config> {
    const { data } = await this.request<{ config: Config }>("POST", "/configs", input, {
      idempotent: true,
    });
    return (data as { config: Config }).config;
  }

  async updateConfig(idOrSlug: string, input: UpdateConfigInput): Promise<Config> {
    const { data } = await this.request<{ config: Config }>(
      "PATCH",
      `/configs/${encodeURIComponent(idOrSlug)}`,
      input,
    );
    return (data as { config: Config }).config;
  }

  async deleteConfig(idOrSlug: string): Promise<void> {
    const { status } = await this.request<{ deleted: boolean }>(
      "DELETE",
      `/configs/${encodeURIComponent(idOrSlug)}`,
      undefined,
      { allow404: true },
    );
    if (status === 404) throw new ConfigNotFoundError(idOrSlug);
  }

  async getConfigStats(): Promise<Record<string, number>> {
    const { data } = await this.request<Record<string, number>>("GET", "/stats");
    return data ?? { total: 0 };
  }

  // Snapshots
  async listSnapshots(configId: string): Promise<ConfigSnapshot[]> {
    const { data } = await this.request<{ snapshots: ConfigSnapshot[] }>(
      "GET",
      `/configs/${encodeURIComponent(configId)}/snapshots`,
    );
    return data?.snapshots ?? [];
  }

  async getSnapshot(id: string): Promise<ConfigSnapshot | null> {
    const { status, data } = await this.request<{ snapshot: ConfigSnapshot }>(
      "GET",
      `/snapshots/${encodeURIComponent(id)}`,
      undefined,
      { allow404: true },
    );
    if (status === 404 || !data?.snapshot) return null;
    return data.snapshot;
  }

  async getSnapshotByVersion(configId: string, version: number): Promise<ConfigSnapshot | null> {
    const { status, data } = await this.request<{ snapshot: ConfigSnapshot }>(
      "GET",
      `/configs/${encodeURIComponent(configId)}/snapshots/${version}`,
      undefined,
      { allow404: true },
    );
    if (status === 404 || !data?.snapshot) return null;
    return data.snapshot;
  }

  async createSnapshot(configId: string, content: string, version: number): Promise<ConfigSnapshot> {
    const { data } = await this.request<{ snapshot: ConfigSnapshot }>(
      "POST",
      `/configs/${encodeURIComponent(configId)}/snapshots`,
      { content, version },
      { idempotent: true },
    );
    return (data as { snapshot: ConfigSnapshot }).snapshot;
  }

  async pruneSnapshots(configId: string, keep = 10): Promise<number> {
    const { data } = await this.request<{ pruned: number }>(
      "POST",
      `/configs/${encodeURIComponent(configId)}/snapshots/prune`,
      { keep },
    );
    return data?.pruned ?? 0;
  }

  // Profiles
  async listProfiles(): Promise<Profile[]> {
    const profiles: Profile[] = [];
    let cursor = 0;
    while (true) {
      const page = await this.listProfilesPage({ limit: 100, cursor });
      profiles.push(...page.items);
      if (page.complete) return profiles;
      cursor = page.next_cursor!;
    }
  }

  async listProfilesPage(options: BoundedReadOptions = {}): Promise<BoundedReadPage<Profile>> {
    const normalized = normalizeBoundedReadOptions(options);
    const params = new URLSearchParams();
    params.set("limit", String(normalized.limit));
    params.set("cursor", String(normalized.cursor));
    const qs = params.toString();
    const { data } = await this.request<BoundedReadPage<Profile> & { profiles?: Profile[] }>(
      "GET",
      `/profiles${qs ? `?${qs}` : ""}`,
    );
    return parseBoundedOrLegacyPage<Profile>(data, data?.profiles, normalized, "profile list");
  }

  async getProfile(idOrSlug: string): Promise<Profile> {
    const { status, data } = await this.request<{ profile: Profile & { configs?: Config[] } }>(
      "GET",
      `/profiles/${encodeURIComponent(idOrSlug)}`,
      undefined,
      { allow404: true },
    );
    if (status === 404 || !data?.profile) {
      // Some deployed API revisions can return a complete profile collection
      // while their single-profile route has stale identity resolution. Use
      // the authoritative bounded collection to recover the exact row rather
      // than silently falling back to the local store.
      const profiles = await this.listProfiles();
      const profile = profiles.find((candidate) => candidate.id === idOrSlug || candidate.slug === idOrSlug);
      if (!profile) throw new ProfileNotFoundError(idOrSlug);
      return profile;
    }
    const { configs: _configs, ...profile } = data.profile;
    return profile;
  }

  async getProfileConfigs(idOrSlug: string): Promise<Config[]> {
    const configs: Config[] = [];
    let cursor = 0;
    while (true) {
      const page = await this.getProfileConfigsPage(idOrSlug, { limit: 100, cursor });
      configs.push(...page.items);
      if (page.complete) return configs;
      cursor = page.next_cursor!;
    }
  }

  async getProfileConfigsPage(
    idOrSlug: string,
    options: BoundedReadOptions = {},
  ): Promise<BoundedReadPage<Config>> {
    const normalized = normalizeBoundedReadOptions(options);
    const params = new URLSearchParams();
    params.set("limit", String(normalized.limit));
    params.set("cursor", String(normalized.cursor));
    const qs = params.toString();
    const { data } = await this.requestProfileRoute<{
      profile: Profile & { configs?: Config[] };
      configs?: BoundedReadPage<Config>;
    }>(idOrSlug, (profileId) => `/profiles/${encodeURIComponent(profileId)}${qs ? `?${qs}` : ""}`, (value) => Boolean(value?.profile));
    if (!data?.profile) throw new ProfileNotFoundError(idOrSlug);
    return parseBoundedOrLegacyPage<Config>(
      data.configs,
      data.profile.configs,
      normalized,
      "profile membership",
    );
  }

  async getProfileConfigBindings(idOrSlug: string): Promise<ProfileConfigBinding[]> {
    const { status, data } = await this.requestProfileRoute<{ bindings: ProfileConfigBinding[] }>(
      idOrSlug,
      (profileId) => `/profiles/${encodeURIComponent(profileId)}/bindings`,
      (value) => Array.isArray(value?.bindings),
    );
    if (status === 404) {
      const profile = await this.getProfile(idOrSlug);
      const configs = await this.getProfileConfigs(idOrSlug);
      return configs.map((config, sort_order) => ({
        profile_id: profile.id,
        config_id: config.id,
        sort_order,
        binding: legacyProfileConfigBinding(),
      }));
    }
    if (!data || !Array.isArray(data.bindings)) throw new ProfileNotFoundError(idOrSlug);
    return data.bindings;
  }

  private async requestProfileRoute<T>(
    idOrSlug: string,
    pathForId: (profileId: string) => string,
    isUsable: (value: T | null) => boolean,
  ): Promise<{ status: number; data: T | null }> {
    const attempted = new Set<string>();
    const request = async (profileId: string) => {
      attempted.add(profileId);
      return this.request<T>("GET", pathForId(profileId), undefined, { allow404: true });
    };

    const first = await request(idOrSlug);
    if (first.status !== 404) {
      if (isUsable(first.data)) return first;
      throw new Error(`Cloud /v1 returned an invalid profile response for ${pathForId(idOrSlug)}`);
    }

    // The collection endpoint is authoritative on deployments whose direct
    // profile identity resolver is stale. Retry both stable identities from
    // the matched row, but never turn an unknown profile into an empty read.
    const profiles = await this.listProfiles();
    const profile = profiles.find((candidate) => candidate.id === idOrSlug || candidate.slug === idOrSlug);
    if (!profile) throw new ProfileNotFoundError(idOrSlug);
    for (const candidate of [profile.id, profile.slug]) {
      if (attempted.has(candidate)) continue;
      const response = await request(candidate);
      if (response.status !== 404) {
        if (isUsable(response.data)) return response;
        throw new Error(`Cloud /v1 returned an invalid profile response for ${pathForId(candidate)}`);
      }
    }
    return { status: 404, data: null };
  }

  async createProfile(input: CreateProfileInput): Promise<Profile> {
    const { data } = await this.request<{ profile: Profile }>("POST", "/profiles", input, {
      idempotent: true,
    });
    return (data as { profile: Profile }).profile;
  }

  async updateProfile(idOrSlug: string, input: UpdateProfileInput): Promise<Profile> {
    const { data } = await this.request<{ profile: Profile }>(
      "PATCH",
      `/profiles/${encodeURIComponent(idOrSlug)}`,
      input,
    );
    return (data as { profile: Profile }).profile;
  }

  async deleteProfile(idOrSlug: string): Promise<void> {
    const { status } = await this.request<{ deleted: boolean }>(
      "DELETE",
      `/profiles/${encodeURIComponent(idOrSlug)}`,
      undefined,
      { allow404: true },
    );
    if (status === 404) throw new ProfileNotFoundError(idOrSlug);
  }

  async addConfigToProfile(profileIdOrSlug: string, configId: string): Promise<void> {
    await this.request<{ added: boolean }>(
      "POST",
      `/profiles/${encodeURIComponent(profileIdOrSlug)}/configs`,
      { config_id: configId },
      { idempotent: true },
    );
  }

  async setProfileConfigBinding(profileIdOrSlug: string, configId: string, binding: ProfileConfigBindingSpec): Promise<ProfileConfigBinding> {
    const { status, data } = await this.request<{ binding: ProfileConfigBinding }>(
      "PUT",
      `/profiles/${encodeURIComponent(profileIdOrSlug)}/configs/${encodeURIComponent(configId)}`,
      { binding },
      { allow404: true, idempotent: true },
    );
    if (status === 404 || !data?.binding) throw new ProfileNotFoundError(profileIdOrSlug);
    return data.binding;
  }

  async removeConfigFromProfile(profileIdOrSlug: string, configId: string): Promise<void> {
    await this.request<{ removed: boolean }>(
      "DELETE",
      `/profiles/${encodeURIComponent(profileIdOrSlug)}/configs/${encodeURIComponent(configId)}`,
      undefined,
      { allow404: true },
    );
  }

  async getProfileAssetBindings(profileIdOrSlug: string): Promise<ProfileAssetBinding[]> {
    const { status, data } = await this.requestProfileRoute<{ assets: ProfileAssetBinding[] }>(
      profileIdOrSlug,
      (profileId) => `/profiles/${encodeURIComponent(profileId)}/assets`,
      (value) => Array.isArray(value?.assets),
    );
    if (status === 404) {
      await this.getProfile(profileIdOrSlug);
      return [];
    }
    if (!data || !Array.isArray(data.assets)) throw new ProfileNotFoundError(profileIdOrSlug);
    return data.assets;
  }

  async addAssetToProfile(profileIdOrSlug: string, sourceConfigId: string, binding: ProfileAssetBindingSpec): Promise<ProfileAssetBinding> {
    const { data } = await this.request<{ asset: ProfileAssetBinding }>(
      "POST",
      `/profiles/${encodeURIComponent(profileIdOrSlug)}/assets`,
      { source_config_id: sourceConfigId, binding },
      { idempotent: true },
    );
    return (data as { asset: ProfileAssetBinding }).asset;
  }

  async setProfileAssetBinding(profileIdOrSlug: string, assetKey: string, binding: ProfileAssetBindingSpec): Promise<ProfileAssetBinding> {
    const { status, data } = await this.request<{ asset: ProfileAssetBinding }>(
      "PUT",
      `/profiles/${encodeURIComponent(profileIdOrSlug)}/assets/${encodeURIComponent(assetKey)}`,
      { binding },
      { allow404: true, idempotent: true },
    );
    if (status === 404 || !data?.asset) throw new ProfileNotFoundError(profileIdOrSlug);
    return data.asset;
  }

  async removeAssetFromProfile(profileIdOrSlug: string, assetKey: string): Promise<void> {
    await this.request<{ removed: boolean }>(
      "DELETE",
      `/profiles/${encodeURIComponent(profileIdOrSlug)}/assets/${encodeURIComponent(assetKey)}`,
      undefined,
      { allow404: true },
    );
  }

  async resolveProfileForMachine(machine?: MachineContext): Promise<Profile | null> {
    return (await this.resolveProfileForMachineRead(machine)).profile;
  }

  async resolveProfileForMachineRead(
    machine?: MachineContext,
    options: BoundedReadOptions = {},
  ): Promise<ProfileResolutionRead> {
    const normalized = normalizeBoundedReadOptions(options);
    const params = new URLSearchParams();
    if (machine?.hostname) params.set("hostname", machine.hostname);
    if (machine?.os) params.set("os", machine.os);
    if (machine?.arch) params.set("arch", machine.arch);
    params.set("limit", String(normalized.limit));
    const qs = params.toString();
    const { status, data } = await this.request<ProfileResolutionRead | { profile: Profile | null }>(
      "GET",
      `/profiles/resolve${qs ? `?${qs}` : ""}`,
      undefined,
      { allow404: true },
    );
    if (status === 404) {
      return {
        profile: null,
        scanned: null,
        total: null,
        batch_limit: null,
        source_bounded: false,
        complete: true,
        truncated: false,
      };
    }
    if (data && "complete" in data) {
      if (data.complete !== true || data.truncated !== false) {
        throw new Error("Cloud /v1 profile resolve returned an incomplete or truncated read");
      }
      return { ...data, source_bounded: data.source_bounded ?? true };
    }
    if (data && "profile" in data) {
      return {
        profile: data.profile,
        scanned: null,
        total: null,
        batch_limit: null,
        source_bounded: false,
        complete: true,
        truncated: false,
      };
    }
    {
      throw new Error("Cloud /v1 profile resolve returned an incomplete or truncated read");
    }
  }

  // Machines
  async registerMachine(hostname?: string, os?: string, arch?: string): Promise<Machine> {
    const { data } = await this.request<{ machine: Machine }>(
      "POST",
      "/machines",
      { hostname, os, arch },
      { idempotent: true },
    );
    return (data as { machine: Machine }).machine;
  }

  async updateMachineApplied(hostname?: string): Promise<void> {
    await this.request<{ updated: boolean }>("POST", "/machines/applied", { hostname });
  }

  async listMachines(): Promise<Machine[]> {
    const { data } = await this.request<{ machines: Machine[] }>("GET", "/machines");
    return data?.machines ?? [];
  }

  async sendFeedback(input: FeedbackInput): Promise<void> {
    await this.request<{ ok: boolean }>("POST", "/feedback", {
      message: input.message,
      email: input.email ?? undefined,
      category: input.category ?? undefined,
      version: input.version ?? undefined,
    });
  }

  async reset(): Promise<void> {
    throw new Error(
      "`init --force` cannot wipe the shared cloud store from a client. " +
        "Point this run at the local store (HASNA_INSTRUCTIONS_LOCAL=1 with no hosted credential) to reset it instead.",
    );
  }
}

/**
 * Resolve the single Store for the current environment — the choke point every
 * CLI command, MCP tool, and SDK method routes through.
 *
 * THE OPT-IN IS ANSWERED FIRST, AND THAT ORDER IS LOAD-BEARING IN BOTH
 * DIRECTIONS (owner ruling 2026-09-04, hasna/apps#1720). An environment that
 * CONFIGURES an Instructions authority or credential outranks the opt-in: a run
 * with the API key set goes hosted (and a half-configured pair fails loudly)
 * rather than quietly serving a different dataset because a stale
 * `HASNA_INSTRUCTIONS_LOCAL` was lying around. But when the environment
 * configures nothing, the opt-in is answered WITHOUT calling the resolver at
 * all — no Keychain item and no credential file is read — and every local run
 * says "local" once on stderr.
 *
 * Otherwise `@hasna/contracts` resolves the credential and the authority, and
 * any failure to do so is a throw (REMOTE_API_*): hosted mode with no
 * credential exits non-zero, no SQLite file is opened, and no local-fallback
 * event is written.
 */
export function resolveConfigStore(
  env: InstructionsClientEnv = process.env,
  options: InstructionsResolverOptions = {},
): ConfigStore {
  if (selectsInstructionsLocalStore(env)) {
    if (env === process.env) announceLocalInstructionsMode();
    return new LocalConfigStore();
  }
  const { client } = resolveInstructionsStorageClient(env, options);
  return new CloudConfigStore(client);
}

export type { InstructionsCredentialChainOptions, InstructionsClientEnv, InstructionsStorageClient };
export { INSTRUCTIONS_LOCAL_OPT_IN_ENV_KEYS };