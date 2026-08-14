import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, resetDatabaseSingleton, type QueryClient } from "../src/db/database.js";
import { localOwnerContext, contextFromPrincipal, type RunContext } from "../src/services/context.js";
import type { ApiPrincipal } from "../src/server/auth.js";
import { createEntity } from "../src/services/entities.js";
import { ingestFromAdapters } from "../src/services/ingest.js";
import { generateSweeps } from "../src/services/sweeps.js";
import { buildFixtureAdapters } from "../src/adapters/fixtures.js";

export interface Fixture {
  db: QueryClient;
  owner: RunContext;
  usId: string;
  roId: string;
  sweepId: string;
  cleanup: () => void;
}

const CRED_KEYS = ["HASNA_TREASURY_API_CREDENTIALS", "HASNA_TREASURY_API_KEY"];

/** Fresh file-backed DB wired as the process singleton (so serve/MCP/CLI share it). */
export async function freshDb(): Promise<{ db: QueryClient; dir: string; path: string }> {
  const dir = mkdtempSync(join(tmpdir(), "treasury-test-"));
  const path = join(dir, "treasury.db");
  process.env["HASNA_TREASURY_DB_PATH"] = path;
  resetDatabaseSingleton();
  const db = await openDatabase();
  return { db, dir, path };
}

/** Seed two demo entities, ingest fixtures, and generate a sweep recommendation. */
export async function seedFixture(): Promise<Fixture> {
  const { db, dir, path } = await freshDb();
  const owner = localOwnerContext(db);
  const us = await createEntity(owner, { name: "Hasna Inc (US)", base_currency: "USD", entity_slug: "hasna-inc-us" });
  const ro = await createEntity(owner, { name: "Hasna SRL (RO)", base_currency: "EUR", entity_slug: "hasna-srl-ro" });
  await ingestFromAdapters(owner, buildFixtureAdapters(us.entity_id, ro.entity_id));
  const sweeps = await generateSweeps(owner, { base: "USD", min_runway_months: 3, healthy_runway_months: 12 });
  return {
    db,
    owner,
    usId: us.entity_id,
    roId: ro.entity_id,
    sweepId: sweeps[0]?.id ?? "no-sweep",
    cleanup: () => {
      resetDatabaseSingleton();
      delete process.env["HASNA_TREASURY_DB_PATH"];
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A scoped (non-bypass) principal for the two fixture entities with all scopes. */
export function scopedPrincipal(entityIds: string[], token = "parity-token"): ApiPrincipal {
  return {
    credential_id: "parity-cred",
    credential_type: "api_key",
    actor_id: "parity",
    roles: ["owner"],
    scopes: ["treasury:read", "treasury:write", "treasury:recommend", "treasury:export", "treasury:admin", "storage:admin"],
    entity_ids: entityIds,
  };
}

/** Configure the serve/CLI credential env so a Bearer token maps to `principal`. */
export function configureCredential(principal: ApiPrincipal, token = "parity-token"): void {
  process.env["HASNA_TREASURY_API_CREDENTIALS"] = JSON.stringify([
    {
      id: principal.credential_id,
      token,
      actor_id: principal.actor_id,
      roles: principal.roles,
      scopes: principal.scopes,
      entity_ids: principal.entity_ids,
    },
  ]);
}

export function clearCredentials(): void {
  for (const k of CRED_KEYS) delete process.env[k];
}

export function scopedContext(db: QueryClient, principal: ApiPrincipal): RunContext {
  return contextFromPrincipal(db, principal);
}

const VOLATILE = new Set([
  "id",
  "entity_id",
  "from_entity_id",
  "to_entity_id",
  "created_at",
  "updated_at",
  "as_of",
  "captured_at",
  "credential_id",
  "entity_slug",
  "rationale",
  "sweepId",
]);

/** Strip volatile fields and sort arrays so surface results compare deep-equal. */
export function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(normalize);
    return items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE.has(k)) continue;
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}
