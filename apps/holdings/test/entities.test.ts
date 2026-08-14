import { describe, expect, it } from "bun:test";
import { makeDb, sysCtx } from "./helpers/harness.js";
import { getEntityRef, listEntityRefs, seedEntity } from "../src/services/entities.js";

describe("entities service (entity anchoring)", () => {
  it("seeds an entity with a generated UUIDv4 id", () => {
    const db = makeDb();
    const ctx = sysCtx(db);
    const entity = seedEntity(ctx, { entity_slug: "acme-ro", name: "Acme SRL (RO)" });
    expect(entity.entity_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(getEntityRef(ctx, entity.entity_id).name).toBe("Acme SRL (RO)");
  });

  it("honors a caller-supplied UUIDv4 and rejects duplicates", () => {
    const db = makeDb();
    const ctx = sysCtx(db);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    seedEntity(ctx, { entity_id: id, name: "Fixed" });
    expect(() => seedEntity(ctx, { entity_id: id, name: "Dup" })).toThrow(/already cached/);
  });

  it("lists cached entities", () => {
    const db = makeDb();
    const ctx = sysCtx(db);
    seedEntity(ctx, { name: "One" });
    seedEntity(ctx, { name: "Two" });
    expect(listEntityRefs(ctx).length).toBe(2);
  });
});
