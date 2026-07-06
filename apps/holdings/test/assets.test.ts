import { describe, expect, it } from "bun:test";
import { seedFixture, sysCtx } from "./helpers/harness.js";
import {
  createAsset,
  deleteAssetService,
  getAssetById,
  listAssetsService,
  updateAssetService,
} from "../src/services/assets.js";
import { AppError } from "../src/types/index.js";

describe("assets service", () => {
  it("creates an entity-anchored asset with defaults", () => {
    const { ctx, entityId } = seedFixture();
    const asset = createAsset(ctx, { entity_id: entityId, kind: "patent", name: "Widget process" });
    expect(asset.entity_id).toBe(entityId);
    expect(asset.kind).toBe("patent");
    expect(asset.status).toBe("draft");
    expect(asset.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an asset for an unknown entity", () => {
    const { ctx } = seedFixture();
    let error: unknown;
    try {
      createAsset(ctx, { entity_id: "11111111-1111-4111-8111-111111111111", kind: "trademark", name: "Ghost" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("ENTITY_NOT_FOUND");
  });

  it("validates the kind enum", () => {
    const { ctx, entityId } = seedFixture();
    expect(() => createAsset(ctx, { entity_id: entityId, kind: "bogus" as never, name: "x" })).toThrow();
  });

  it("lists, filters, updates, and deletes", () => {
    const { db, ctx, entityId } = seedFixture();
    createAsset(ctx, { entity_id: entityId, kind: "copyright", name: "Manual v1" });
    const all = listAssetsService(sysCtx(db), { entity_id: entityId });
    expect(all.length).toBe(2);
    const copyrights = listAssetsService(sysCtx(db), { kind: "copyright" });
    expect(copyrights.length).toBe(1);

    const target = copyrights[0]!;
    const updated = updateAssetService(ctx, { id: target.id, status: "registered" });
    expect(updated.status).toBe("registered");
    expect(getAssetById(ctx, target.id).status).toBe("registered");

    const del = deleteAssetService(ctx, target.id);
    expect(del.deleted).toBe(true);
    expect(() => getAssetById(ctx, target.id)).toThrow();
  });
});
