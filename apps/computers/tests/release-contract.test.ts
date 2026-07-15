import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("release verification contract", () => {
  test("owns an offline clean-install packed artifact gate without prepack recursion", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["verify:pack"]).toBe("bun run scripts/verify-pack.ts");
    expect(packageJson.scripts["verify:release"]).toContain("bun run verify:pack");
    expect(packageJson.scripts["verify:release"]).not.toContain("bun pm pack");
    const script = readFileSync("scripts/verify-pack.ts", "utf8");
    for (const required of ["--ignore-scripts", "--offline", "consumer.ts", "@hasna/computers/sdk", "@hasna/computers/contracts", "@hasna/computers/providers", "@hasna/computers/storage", "computers-serve", "computers-mcp", "computers-worker", "computers-resident", "computers-migrate"]) {
      expect(script).toContain(required);
    }
    for (const forbidden of ["npm install", "bunx", "prepack"]) expect(script).not.toContain(forbidden);
  });

  test("release schema gate pins every bounded Computer grant field to runtime limits", () => {
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as { components: { schemas: { CreateComputerGrant: { properties: Record<string, unknown> } } } };
    const fields = api.components.schemas.CreateComputerGrant.properties;
    expect(fields.allowedRegions).toEqual({ type: "array", minItems: 1, maxItems: 32, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9_-]*$" } });
    expect(fields.maxStorageGiB).toEqual({ type: "integer", minimum: 1, maximum: 1_048_576 });
    expect(fields.maxUptimeSeconds).toEqual({ type: "integer", minimum: 1, maximum: 31_536_000 });
    expect(fields.maxBudgetMicros).toEqual({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    expect(fields.limit).toEqual({ type: "integer", minimum: 1, maximum: 1000 });
    const checker = readFileSync("scripts/check-schemas.ts", "utf8");
    for (const field of ["allowedProviders", "allowedChildOwnerPrincipalIds", "allowedRegions", "allowedProfileIds", "maxStorageGiB", "maxUptimeSeconds", "maxBudgetMicros", "limit"]) {
      expect(checker).toContain(field);
    }
  });
});
