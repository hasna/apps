import { describe, expect, test } from "bun:test";
import { getDataDir, getDbPath, getManifestPath } from "../src/paths.js";

describe("paths", () => {
  test("uses local ~/.hasna/stations defaults", () => {
    delete process.env["HASNA_STATIONS_DIR"];
    expect(getDataDir()).toContain(".hasna/stations");
    expect(getDbPath()).toContain("stations.db");
    expect(getManifestPath()).toContain("stations.json");
  });
});
