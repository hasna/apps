import { describe, expect, it } from "bun:test";
import { seedFixture } from "./helpers/harness.js";
import { createClass, deleteClassService, listClassesService } from "../src/services/classes.js";

describe("classes service (Nice classification)", () => {
  it("adds Nice classes to a trademark", () => {
    const { ctx, assetId } = seedFixture();
    createClass(ctx, { asset_id: assetId, nice_class: 9, description: "Software" });
    createClass(ctx, { asset_id: assetId, nice_class: 42, description: "SaaS / tech services" });
    const classes = listClassesService(ctx, { asset_id: assetId });
    expect(classes.map((c) => c.nice_class)).toEqual([9, 42]);
  });

  it("rejects an out-of-range Nice class", () => {
    const { ctx, assetId } = seedFixture();
    expect(() => createClass(ctx, { asset_id: assetId, nice_class: 46 })).toThrow();
    expect(() => createClass(ctx, { asset_id: assetId, nice_class: 0 })).toThrow();
  });

  it("deletes a class", () => {
    const { ctx, assetId } = seedFixture();
    const c = createClass(ctx, { asset_id: assetId, nice_class: 25 });
    expect(deleteClassService(ctx, c.id).deleted).toBe(true);
    expect(listClassesService(ctx, { asset_id: assetId }).length).toBe(0);
  });
});
