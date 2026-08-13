import type { Entity } from "../types/index.js";

// Read-adapter for the @hasna/entities system-of-record (§1a integrator v0).
// v0 is backed by fixtures; v1 (HASNA_CONSOLIDATIONS_LIVE_UPSTREAM=1) will call
// the entities MCP (entity_get), authorized by the caller's scopes.

export interface EntitySource {
  resolve(entityId: string): Promise<Entity | null>;
  list(): Promise<Entity[]>;
}

// Stable UUIDv4 ids so entity_id is an unguessable authorized reference (§1c).
export const FIXTURE_ENTITY_US = "3f9a1c2e-1d4b-4a6f-8e21-9b7c5d3e0a11";
export const FIXTURE_ENTITY_RO = "a2b7c9d1-5e3f-4c8a-9d02-1f6e4b8c7a33";
export const FIXTURE_ENTITY_UK = "c4d8e1f2-7a3b-4d5c-8e19-2b6f9c1d4e55";

const FIXTURE_ENTITIES: Entity[] = [
  {
    id: FIXTURE_ENTITY_US,
    slug: "hasna-inc-us",
    name: "Hasna Inc",
    functional_currency: "USD",
    country: "US",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: FIXTURE_ENTITY_RO,
    slug: "hasna-srl-ro",
    name: "Hasna SRL",
    functional_currency: "RON",
    country: "RO",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: FIXTURE_ENTITY_UK,
    slug: "hasna-ltd-uk",
    name: "Hasna Ltd",
    functional_currency: "GBP",
    country: "GB",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

export class FixtureEntitySource implements EntitySource {
  async resolve(entityId: string): Promise<Entity | null> {
    return FIXTURE_ENTITIES.find((entity) => entity.id === entityId) ?? null;
  }
  async list(): Promise<Entity[]> {
    return [...FIXTURE_ENTITIES];
  }
}

/** Whether live upstream integration is enabled (v1). */
export function liveUpstreamEnabled(): boolean {
  return process.env["HASNA_CONSOLIDATIONS_LIVE_UPSTREAM"] === "1";
}

/** The active entity source (fixture in v0). */
export function entitySource(): EntitySource {
  return new FixtureEntitySource();
}
