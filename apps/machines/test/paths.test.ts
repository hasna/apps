import { describe, expect, test } from "bun:test";
import { getDataDir, getDbPath, getManifestPath } from "../src/paths.js";

describe("paths", () => {
  test("uses local ~/.hasna/machines defaults", () => {
    delete process.env["HASNA_MACHINES_DIR"];
    expect(getDataDir()).toContain(".hasna/machines");
    expect(getDbPath()).toContain("machines.db");
    expect(getManifestPath()).toContain("machines.json");
  });
});
