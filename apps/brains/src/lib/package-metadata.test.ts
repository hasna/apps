import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getPackageVersion } from "./package-metadata.js";
import { MCP_SERVER_INFO } from "../mcp/index.js";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../package.json"), "utf-8")
) as {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
};

describe("package metadata", () => {
  test("returns the current package version", () => {
    expect(getPackageVersion()).toBe(packageJson.version);
  });

  test("does not depend on itself", () => {
    expect(packageJson.dependencies?.[packageJson.name]).toBeUndefined();
  });

  test("keeps the MCP server version aligned with the package version", () => {
    expect(MCP_SERVER_INFO.version).toBe(packageJson.version);
  });
});
