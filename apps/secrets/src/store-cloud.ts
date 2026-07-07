// Cloud (self_hosted) storage routing for the secrets vault.
//
// When the client-flip contract resolves to `cloud-http` — i.e. the storage
// mode is `self_hosted`/`cloud` AND `HASNA_SECRETS_API_URL` +
// `HASNA_SECRETS_API_KEY` are set — every read and write for the vault dataset
// (secrets, vault items, users, audit) is routed to the app's cloud API at
// `<API_URL>/v1` with the bearer key, instead of the local encrypted SQLite
// vault. Unsetting the two env vars falls back to the local store, so the flip
// is fully reversible.
//
// The secrets API does NOT follow the generic `/v1/<resource>/<id>` REST shape
// (single-secret read is `GET /v1/secrets/get?key=`, delete is
// `DELETE /v1/secrets?key=`), so this module talks to the app's exact routes via
// the shared transport rather than the generic CRUD helper.
//
// SAFETY: values are sent as plaintext over TLS to the cloud API, which encrypts
// them server-side with the cloud master key — the local master key is never
// used in cloud mode. The API key itself lives only inside the transport and is
// never logged or embedded here.

import {
  resolveStorageClient,
  type HasnaStorageClient,
} from "@hasna/contracts/client/storage";
import type {
  SecretEntry,
  SecretMetadata,
  SecretType,
  AuditEntry,
  VaultItem,
  VaultItemInput,
  VaultItemKind,
  VaultItemMetadata,
} from "./types.js";

const APP_NAME = "secrets";

type HasnaHttpTransport = HasnaStorageClient["transport"];

export interface SecretsCloud {
  client: HasnaStorageClient;
  transport: HasnaHttpTransport;
}

/**
 * Resolve the cloud storage client for the secrets vault from the environment,
 * or null when the app should use its local store. Throws only if cloud was
 * explicitly requested but misconfigured (so we never silently read the wrong
 * dataset).
 */
export function resolveSecretsCloud(env: NodeJS.ProcessEnv = process.env): SecretsCloud | null {
  const resolved = resolveStorageClient(APP_NAME, env as Record<string, string | undefined>);
  if (resolved.transport !== "cloud-http") return null;
  return { client: resolved.client, transport: resolved.client.transport };
}

/** True when reads/writes for the vault dataset should hit the cloud API. */
export function isCloudSecrets(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveSecretsCloud(env) !== null;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: number }).status === 404;
}

// ── secrets ────────────────────────────────────────────────────────────

export async function cloudSetSecret(
  c: SecretsCloud,
  key: string,
  value: string,
  type: SecretType,
  label?: string,
  ttl?: string,
): Promise<SecretEntry> {
  await c.transport.post("/secrets", { key, value, type, label, ...(ttl ? { ttl } : {}) });
  // POST returns metadata only; fetch the full (decrypted) entry to match the
  // local `setSecret` contract, which returns the stored entry with its value.
  const entry = await cloudGetSecret(c, key);
  if (entry) return entry;
  return {
    key,
    value,
    type,
    ...(label ? { label } : {}),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function cloudGetSecret(c: SecretsCloud, key: string): Promise<SecretEntry | undefined> {
  try {
    return await c.transport.get<SecretEntry>("/secrets/get", { query: { key } });
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function cloudDeleteSecret(c: SecretsCloud, key: string): Promise<boolean> {
  try {
    const res = await c.transport.del<{ deleted?: boolean }>("/secrets", undefined, { query: { key } });
    return Boolean(res?.deleted ?? true);
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function cloudListSecretMetadata(c: SecretsCloud, namespace?: string): Promise<SecretMetadata[]> {
  const res = await c.transport.get<{ secrets?: SecretMetadata[] }>("/secrets", {
    query: namespace ? { namespace } : {},
  });
  return res.secrets ?? [];
}

export async function cloudListSecrets(c: SecretsCloud, namespace?: string): Promise<SecretEntry[]> {
  const meta = await cloudListSecretMetadata(c, namespace);
  const entries = await Promise.all(meta.map((m) => cloudGetSecret(c, m.key)));
  return entries.filter((e): e is SecretEntry => Boolean(e));
}

export async function cloudSearchSecretMetadata(c: SecretsCloud, q: string): Promise<SecretMetadata[]> {
  const res = await c.transport.get<{ results?: SecretMetadata[] }>("/secrets/search", { query: { q } });
  return res.results ?? [];
}

export async function cloudSearchSecrets(c: SecretsCloud, q: string): Promise<SecretEntry[]> {
  const meta = await cloudSearchSecretMetadata(c, q);
  const entries = await Promise.all(meta.map((m) => cloudGetSecret(c, m.key)));
  return entries.filter((e): e is SecretEntry => Boolean(e));
}

// ── vault items ──────────────────────────────────────────────────────────

export async function cloudSetVaultItem(c: SecretsCloud, input: VaultItemInput): Promise<VaultItem> {
  return c.transport.post<VaultItem>("/items", {
    kind: input.kind,
    title: input.title,
    data: input.data ?? {},
    ...(input.id ? { id: input.id } : {}),
    ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    ...(input.domains ? { domains: input.domains } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
  });
}

export async function cloudGetVaultItem(c: SecretsCloud, id: string): Promise<VaultItem | undefined> {
  const item = await c.client.get<VaultItem>("items", id);
  return item ?? undefined;
}

export async function cloudDeleteVaultItem(c: SecretsCloud, id: string): Promise<boolean> {
  try {
    const res = await c.transport.del<{ deleted?: boolean }>(`/items/${encodeURIComponent(id)}`);
    return Boolean(res?.deleted ?? true);
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function cloudListVaultItemMetadata(c: SecretsCloud, kind?: VaultItemKind): Promise<VaultItemMetadata[]> {
  const res = await c.transport.get<{ items?: VaultItemMetadata[] }>("/items", {
    query: kind ? { kind } : {},
  });
  return res.items ?? [];
}

export async function cloudSearchVaultItemMetadata(c: SecretsCloud, q: string): Promise<VaultItemMetadata[]> {
  const res = await c.transport.get<{ results?: VaultItemMetadata[] }>("/items/search", { query: { q } });
  return res.results ?? [];
}

// ── audit + users ──────────────────────────────────────────────────────────

export async function cloudGetAuditLog(c: SecretsCloud, key?: string, limit = 100): Promise<AuditEntry[]> {
  const res = await c.transport.get<{ entries?: AuditEntry[] }>("/audit", {
    query: { ...(key ? { key } : {}), limit },
  });
  return res.entries ?? [];
}

export interface CloudUser {
  id: string;
  name: string;
  type: "human" | "agent";
  registered_at: string;
  last_seen?: string;
}

export async function cloudRegisterUser(
  c: SecretsCloud,
  id: string,
  name: string,
  type: "human" | "agent",
): Promise<CloudUser> {
  return c.transport.post<CloudUser>("/users", { id, name, type });
}

export async function cloudListUsers(c: SecretsCloud, type?: "human" | "agent"): Promise<CloudUser[]> {
  const res = await c.transport.get<{ users?: CloudUser[] }>("/users", {
    query: type ? { type } : {},
  });
  return res.users ?? [];
}

export async function cloudGetUser(c: SecretsCloud, id: string): Promise<CloudUser | undefined> {
  const users = await cloudListUsers(c);
  return users.find((u) => u.id === id);
}
