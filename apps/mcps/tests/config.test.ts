import { describe, it, expect } from "bun:test";
import "./setup";
import { MCPS_DIR, DB_PATH, REGISTRY_API_URL, TOOL_PREFIX_SEPARATOR } from "../src/lib/config";

describe("config", () => {
  it("exports MCPS_DIR as a string", () => {
    expect(typeof MCPS_DIR).toBe("string");
    expect(MCPS_DIR.length).toBeGreaterThan(0);
  });

  it("exports DB_PATH ending with .db", () => {
    expect(DB_PATH).toEndWith(".db");
  });

  it("exports REGISTRY_API_URL as https URL", () => {
    expect(REGISTRY_API_URL).toStartWith("https://");
  });

  it("exports TOOL_PREFIX_SEPARATOR as __", () => {
    expect(TOOL_PREFIX_SEPARATOR).toBe("__");
  });
});
