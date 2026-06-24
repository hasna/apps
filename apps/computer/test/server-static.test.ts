import { describe, expect, test } from "bun:test";
import { resolveDashboardFile } from "../src/server/static.js";

describe("dashboard static path resolution", () => {
  const root = "/tmp/computer-dashboard/dist";

  test("allows normal dashboard assets", () => {
    expect(resolveDashboardFile(root, "/dashboard/assets/app.js")).toBe("/tmp/computer-dashboard/dist/assets/app.js");
  });

  test("rejects traversal and encoded traversal", () => {
    expect(resolveDashboardFile(root, "/dashboard/../../package.json")).toBeNull();
    expect(resolveDashboardFile(root, "/dashboard/%2e%2e/%2e%2e/package.json")).toBeNull();
    expect(resolveDashboardFile(root, "/dashboard/%00/package.json")).toBeNull();
  });
});
