// HTTP API registry backend for the accounts CLI.
//
// LOCKED ARCHITECTURE: when `HASNA_ACCOUNTS_API_URL` + `HASNA_ACCOUNTS_API_KEY`
// are set, the account *registry* (profiles + current selections) is read from
// and written to the app's HTTP API at `<API_URL>/v1` with the bearer key —
// never the local JSON store, never a raw DSN. Built on the `@hasna/contracts`
// HTTP storage client, so it inherits retries, timeout, idempotency and JSON
// error mapping.
//
// There are no deployment modes (owner directive 2026-07-29; knowledge
// k_ms5wv466_u0jidq). Transport is selected by the API env pair alone: both
// vars set selects the HTTP transport; an incomplete pair stays local; any
// retired storage-mode variable is scrubbed with an advisory warning via
// `scrubLegacyStorageMode` — never a crash (the legacy fleet drop-in still
// exports one) and never a transport hint.
//
// Registry vs local: the HTTP API is the source of truth for account metadata
// (name, tool, email, displayName, identity, cardLast4, metadata, description,
// createdAt, lastUsedAt) and current selections. A profile's local config `dir`,
// the per-machine `applied` map and `toolLocks` are inherently machine-local and
// stay local; launch/apply/env commands therefore remain local operations.
//
// SAFETY: the API key never appears in logs or return values; it lives only
// inside the contracts transport.

import type { Profile, ProfileAuthStatus, ToolDef } from "../types.js";
import { AccountsError, toolDefSchema } from "../types.js";
import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts";
import { scrubLegacyStorageMode } from "./retired-storage-mode.js";

const APP_SLUG = "accounts";

/** The `/v1/accounts` entity as returned by the serve API. */
export interface CloudAccount {
  tool: string;
  name: string;
  email?: string;
  displayName?: string;
  identity?: string;
  cardLast4?: string;
  metadata?: Record<string, string | number | boolean | null>;
  dir?: string;
  description?: string;
  createdAt: string;
  lastUsedAt?: string;
  /** R-P1-4: the tool-native/on-disk name, when it differs from `name`. */
  nativeName?: string;
  /** R-P1-4: former registry name(s) this profile has answered to. */
  aliases?: string[];
  /** b27cc4a0: per-machine authentication status, keyed by machine id. */
  authStatus?: ProfileAuthStatus;
}

export interface CloudCurrentSelection {
  tool: string;
  name: string;
  updatedAt: string;
}

export interface CloudCreateInput {
  name: string;
  tool: string;
  email?: string;
  displayName?: string;
  identity?: string;
  cardLast4?: string;
  metadata?: Record<string, string | number | boolean | null>;
  dir?: string;
  description?: string;
  authStatus?: ProfileAuthStatus;
}

/** Fields updatable through `PATCH /v1/accounts/:tool/:name`. */
export interface CloudUpdateInput {
  email?: string;
  displayName?: string;
  identity?: string;
  cardLast4?: string;
  metadata?: Record<string, string | number | boolean | null>;
  dir?: string;
  description?: string;
  lastUsedAt?: string;
  /** R-P1-4: last-write-wins (a single fixed on-disk identifier). */
  nativeName?: string;
  /** R-P1-4: APPENDED (deduped) to the record's existing aliases server-side — never a replace. */
  aliases?: string[];
  /**
   * b27cc4a0: per-machine auth-status entries. MERGED per machine server-side —
   * never a replace of the whole map (same append/dedup discipline as aliases).
   */
  authStatus?: ProfileAuthStatus;
}

/**
 * Tool payload accepted from GET /v1/tools. Older servers only guaranteed
 * id/label, so all enriched ToolDef fields and builtin remain optional on read.
 */
export type CloudTool = Pick<ToolDef, "id" | "label"> & Partial<ToolDef> & { builtin?: boolean };

/** Registry surface backed by `<API_URL>/v1`. */
export interface AccountsCloudApi {
  readonly baseUrl: string;
  list(tool?: string): Promise<Profile[]>;
  get(name: string, tool?: string): Promise<Profile | undefined>;
  create(input: CloudCreateInput): Promise<Profile>;
  update(name: string, tool: string, input: CloudUpdateInput): Promise<Profile>;
  rename(oldName: string, newName: string, tool: string): Promise<Profile>;
  remove(name: string, tool?: string): Promise<Profile>;
  listCurrent(): Promise<CloudCurrentSelection[]>;
  getCurrent(tool: string): Promise<CloudCurrentSelection | null>;
  setCurrent(tool: string, name: string): Promise<CloudCurrentSelection>;
  listTools(): Promise<CloudTool[]>;
  createTool(def: ToolDef): Promise<ToolDef>;
  removeTool(id: string): Promise<void>;
}

export type ResolveAccountsCloudResult =
  | { transport: "cloud-http"; api: AccountsCloudApi }
  | { transport: "local"; api: null };

function toProfile(account: CloudAccount): Profile {
  return {
    name: account.name,
    tool: account.tool,
    ...(account.email ? { email: account.email } : {}),
    ...(account.displayName ? { displayName: account.displayName } : {}),
    ...(account.identity ? { identity: account.identity } : {}),
    ...(account.cardLast4 ? { cardLast4: account.cardLast4 } : {}),
    ...(account.metadata && Object.keys(account.metadata).length > 0 ? { metadata: account.metadata } : {}),
    dir: account.dir ?? "",
    ...(account.description ? { description: account.description } : {}),
    createdAt: account.createdAt,
    ...(account.lastUsedAt ? { lastUsedAt: account.lastUsedAt } : {}),
    ...(account.nativeName ? { nativeName: account.nativeName } : {}),
    ...(account.aliases && account.aliases.length > 0 ? { aliases: account.aliases } : {}),
    ...(account.authStatus && Object.keys(account.authStatus).length > 0 ? { authStatus: account.authStatus } : {}),
  };
}

/**
 * Resolve the accounts registry backend for this process. Returns a `cloud-http`
 * API wired to `<API_URL>/v1` when both `HASNA_ACCOUNTS_API_URL` and
 * `HASNA_ACCOUNTS_API_KEY` are set, `{ transport: 'local' }` when neither is
 * set, and throws when exactly one of the pair is set (no silent local drift,
 * mirroring the instructions app's `resolveCloudConfig`). Any retired
 * storage-mode variable is scrubbed with an advisory warning via
 * `scrubLegacyStorageMode`, so a client never silently drifts between stores
 * on stale mode vocabulary — and never crashes on a machine that still
 * exports it (the legacy fleet drop-in does).
 */
export function resolveAccountsCloud(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: Parameters<typeof resolveStorageClient>[2],
): ResolveAccountsCloudResult {
  scrubLegacyStorageMode(env);
  const url = env.HASNA_ACCOUNTS_API_URL || env.ACCOUNTS_API_URL;
  // hasna-credential-seam-waiver: the pinned @hasna/contracts 0.5.2 transport re-reads HASNA_ACCOUNTS_API_KEY from the environment itself when selecting the client; the seam migration (contracts client resolveCredential) requires a contracts runtime upgrade and is tracked as a follow-up.
  const key = env.HASNA_ACCOUNTS_API_KEY || env.ACCOUNTS_API_KEY;
  if (!url && !key) return { transport: "local", api: null };
  if (!url || !key) {
    // Partial API pair -> throw, never silent local: a client with only one
    // side of the pair set is misconfigured, and falling back would read the
    // wrong registry without saying so.
    throw new Error(
      `API mode requires BOTH HASNA_ACCOUNTS_API_URL and HASNA_ACCOUNTS_API_KEY; only ` +
        `${url ? "HASNA_ACCOUNTS_API_URL" : "HASNA_ACCOUNTS_API_KEY"} is set. Set both to use the HTTP API, ` +
        `or unset both to use the local registry.`,
    );
  }
  // Hand the contracts resolver only the pair that selects the transport; the
  // mode vocabulary is dead and must not reach it.
  const resolved = resolveStorageClient(
    APP_SLUG,
    { HASNA_ACCOUNTS_API_URL: url, HASNA_ACCOUNTS_API_KEY: key },
    overrides,
  );
  if (resolved.transport !== "cloud-http") return { transport: "local", api: null };
  return { transport: "cloud-http", api: makeApi(resolved.client) };
}

function makeApi(client: HasnaStorageClient): AccountsCloudApi {
  const t = client.transport;

  const listAll = async (tool?: string): Promise<CloudAccount[]> => {
    const raw = await t.get<{ accounts?: CloudAccount[] }>("/accounts", tool ? { query: { tool } } : undefined);
    return Array.isArray(raw?.accounts) ? raw.accounts : [];
  };

  const api: AccountsCloudApi = {
    baseUrl: client.baseUrl,

    async list(tool?: string): Promise<Profile[]> {
      const accounts = await listAll(tool);
      return accounts
        .map(toProfile)
        .sort((a, b) => a.tool.localeCompare(b.tool) || a.name.localeCompare(b.name));
    },

    async get(name: string, tool?: string): Promise<Profile | undefined> {
      if (tool) {
        try {
          const account = await t.get<CloudAccount>(`/accounts/${encodeURIComponent(tool)}/${encodeURIComponent(name)}`);
          return account ? toProfile(account) : undefined;
        } catch (err) {
          if (isNotFound(err)) return undefined;
          throw err;
        }
      }
      const matches = (await listAll()).filter((a) => a.name === name);
      if (matches.length === 1) return toProfile(matches[0]!);
      return undefined;
    },

    async create(input: CloudCreateInput): Promise<Profile> {
      const body: Record<string, unknown> = { name: input.name, tool: input.tool };
      if (input.email) body.email = input.email;
      if (input.displayName) body.displayName = input.displayName;
      if (input.identity) body.identity = input.identity;
      if (input.cardLast4) body.cardLast4 = input.cardLast4;
      if (input.metadata && Object.keys(input.metadata).length > 0) body.metadata = input.metadata;
      // NOTE: profile-dir policy is deliberately NOT enforced client-side. This
      // client also talks to test doubles and non-production instances, and it
      // cannot tell which, so a local check would reject dirs that are perfectly
      // valid for the store actually being written to. The server owns the
      // boundary; its 400 carries the same message this client would have shown.
      if (input.dir) body.dir = input.dir;
      if (input.description) body.description = input.description;
      if (input.authStatus && Object.keys(input.authStatus).length > 0) body.authStatus = input.authStatus;
      const created = await client.create<CloudAccount>("accounts", body);
      return toProfile(created);
    },

    async update(name: string, tool: string, input: CloudUpdateInput): Promise<Profile> {
      const body: Record<string, unknown> = {};
      if (input.email !== undefined) body.email = input.email;
      if (input.displayName !== undefined) body.displayName = input.displayName;
      if (input.identity !== undefined) body.identity = input.identity;
      if (input.cardLast4 !== undefined) body.cardLast4 = input.cardLast4;
      if (input.metadata !== undefined) body.metadata = input.metadata;
      if (input.dir !== undefined) body.dir = input.dir;
      if (input.description !== undefined) body.description = input.description;
      if (input.lastUsedAt !== undefined) body.lastUsedAt = input.lastUsedAt;
      if (input.nativeName !== undefined) body.nativeName = input.nativeName;
      if (input.aliases !== undefined) body.aliases = input.aliases;
      if (input.authStatus !== undefined) body.authStatus = input.authStatus;
      const updated = await t.patch<CloudAccount>(
        `/accounts/${encodeURIComponent(tool)}/${encodeURIComponent(name)}`,
        body,
      );
      return toProfile(updated);
    },

    async rename(oldName: string, newName: string, tool: string): Promise<Profile> {
      try {
        const renamed = await t.post<CloudAccount>(
          `/accounts/${encodeURIComponent(tool)}/${encodeURIComponent(oldName)}/rename`,
          { name: newName },
        );
        return toProfile(renamed);
      } catch (err) {
        if (isEndpointMissing(err)) throw endpointMissingError("accounts rename");
        throw err;
      }
    },

    async remove(name: string, tool?: string): Promise<Profile> {
      const resolvedTool = tool ?? (await resolveSingleTool(name, listAll));
      const existing = await t.get<CloudAccount>(
        `/accounts/${encodeURIComponent(resolvedTool)}/${encodeURIComponent(name)}`,
      ).catch((err) => {
        if (isNotFound(err)) return null;
        throw err;
      });
      if (!existing) {
        const suffix = tool ? ` for tool "${tool}"` : "";
        throw new AccountsError(`no profile named "${name}"${suffix}`);
      }
      await t.del(`/accounts/${encodeURIComponent(resolvedTool)}/${encodeURIComponent(name)}`);
      return toProfile(existing);
    },

    async listCurrent(): Promise<CloudCurrentSelection[]> {
      const raw = await t.get<{ current?: CloudCurrentSelection[] }>("/current");
      return Array.isArray(raw?.current) ? raw.current : [];
    },

    async getCurrent(tool: string): Promise<CloudCurrentSelection | null> {
      try {
        return await t.get<CloudCurrentSelection>(`/current/${encodeURIComponent(tool)}`);
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async setCurrent(tool: string, name: string): Promise<CloudCurrentSelection> {
      return t.put<CloudCurrentSelection>(`/current/${encodeURIComponent(tool)}`, { name });
    },

    async listTools(): Promise<CloudTool[]> {
      const raw = await t.get<{ tools?: CloudTool[] }>("/tools");
      return Array.isArray(raw?.tools) ? raw.tools : [];
    },

    async createTool(def: ToolDef): Promise<ToolDef> {
      try {
        const created = await t.post<CloudTool>("/tools", def);
        const { builtin: _builtin, ...toolDef } = created;
        const parsed = toolDefSchema.safeParse(toolDef);
        if (!parsed.success) {
          throw new AccountsError("accounts-serve returned an invalid custom tool after creation");
        }
        return parsed.data;
      } catch (err) {
        if (isEndpointMissing(err)) throw endpointMissingError("accounts tools add");
        throw err;
      }
    },

    async removeTool(id: string): Promise<void> {
      try {
        await t.del(`/tools/${encodeURIComponent(id)}`);
      } catch (err) {
        if (isEndpointMissing(err)) throw endpointMissingError("accounts tools remove");
        throw err;
      }
    },
  };
  return api;
}

async function resolveSingleTool(name: string, listAll: (tool?: string) => Promise<CloudAccount[]>): Promise<string> {
  const matches = (await listAll()).filter((a) => a.name === name);
  if (matches.length === 0) throw new AccountsError(`no profile named "${name}"`);
  if (matches.length > 1) {
    throw new AccountsError(`profile "${name}" exists for multiple tools (${matches.map((a) => a.tool).join(", ")}); pass --tool`);
  }
  return matches[0]!.tool;
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { status?: number }).status === 404);
}

/** Pull the `error` message out of a JSON error body (object or JSON string). */
function errorMessageOf(body: unknown): string | undefined {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (parsed && typeof parsed === "object" && typeof parsed.error === "string") return parsed.error;
      return undefined;
    } catch {
      return body;
    }
  }
  if (body && typeof body === "object") {
    const msg = (body as { error?: unknown }).error;
    return typeof msg === "string" ? msg : undefined;
  }
  return undefined;
}

/**
 * True for a *route-missing* 404 — the generic `{ "error": "not found" }` the
 * server returns when no route matches — as opposed to an entity-level 404
 * (`no profile named ...`, `no custom tool ...`). A route-missing 404 on a
 * mutating call means the connected server is running an older build that
 * predates this endpoint.
 */
function isEndpointMissing(err: unknown): boolean {
  if (!(err && typeof err === "object")) return false;
  const e = err as { status?: number; body?: unknown };
  if (e.status !== 404) return false;
  return errorMessageOf(e.body) === "not found";
}

/** Actionable error for a mutating op whose endpoint is absent on the server. */
function endpointMissingError(op: string): AccountsError {
  return new AccountsError(
    `the accounts server does not support \`${op}\` — it is running an older build that predates this endpoint. ` +
      `Redeploy accounts-serve so the API exposes it, then retry. (Local mode is unaffected.)`,
  );
}
