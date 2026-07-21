import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatContractConformance,
  repoRoot,
  runContractConformance,
} from "./check-contract-conformance.mjs";

describe("Loops repository contract conformance", () => {
  test("passes the official checker with deterministic JSON and package surfaces", () => {
    const report = runContractConformance();

    expect(report).toMatchObject({
      ok: true,
      repoRoot,
      name: "loops",
      class: "service",
    });
    expect(report.checks.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "manifest_valid", status: "pass" },
      { id: "bins_allowlisted", status: "pass" },
      { id: "bins_match_package", status: "pass" },
      { id: "mode_enum_compliance", status: "pass" },
      { id: "health_shape", status: "skip" },
      { id: "no_cloud_guard", status: "pass" },
    ]);
    expect(JSON.parse(formatContractConformance(report))).toEqual(report);

    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    );
    expect(Object.keys(packageJson.bin)).toEqual([
      "loops",
      "loops-daemon",
      "loops-serve",
      "loops-runner",
      "loops-mcp",
    ]);
    expect(packageJson.bin["loops-api"]).toBeUndefined();
    expect(packageJson.exports["./api"]).toEqual({
      types: "./dist/api/index.d.ts",
      import: "./dist/api/index.js",
    });
  });
});
