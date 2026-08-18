import type { Entity } from "../types/index.js";

// Read-adapter for the @hasna/entities system-of-record (§1a integrator v0).
// Backed by fixtures only in this build: the live @hasna/entities upstream is
// NOT implemented yet. Nothing in this package claims otherwise.

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

/** The active entity source (fixtures only in this build). */
export function entitySource(): EntitySource {
  return new FixtureEntitySource();
}
