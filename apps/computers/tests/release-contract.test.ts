import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  REQUIRED_AUTHENTICATED_GET_RESPONSES,
  REQUIRED_MUTABLE_RUNTIME_RESPONSES,
  REQUIRED_PUBLIC_RUNTIME_RESPONSES,
  REQUIRED_SANDBOX_RUNTIME_RESPONSES,
} from "../scripts/check-surfaces";
import { REST_NON_OPERATION_RESPONSE_MANIFEST, REST_ROUTE_MANIFEST } from "../src/server";

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(["bun", "src/bin/computers.ts", ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("release verification contract", () => {
  test("owns an offline clean-install packed artifact gate without prepack recursion", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["verify:pack"]).toBe("bun run scripts/verify-pack.ts");
    expect(packageJson.scripts["verify:release"]).toContain("bun run verify:pack");
    expect(packageJson.scripts["verify:release"]).not.toContain("bun pm pack");
    const script = readFileSync("scripts/verify-pack.ts", "utf8");
    for (const required of ["--ignore-scripts", "--offline", "consumer.ts", "openapi-smoke.ts", "package/migrations/sqlite", "package/migrations/postgres", "package/schemas/openapi.json", "@hasna/computers/sdk", "@hasna/computers/contracts", "@hasna/computers/providers", "@hasna/computers/storage", "computers-serve", "computers-mcp", "computers-worker", "computers-resident", "computers-migrate"]) {
      expect(script).toContain(required);
    }
    for (const forbidden of ["npm install", "bunx", "prepack"]) expect(script).not.toContain(forbidden);
  });

  test("mandatory release verification runs the PostgreSQL 16.13 proof exactly once without recursion", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const release = packageJson.scripts["verify:release"] ?? "";
    const postgres = packageJson.scripts["test:postgres-migrations"] ?? "";
    expect(release.match(/bun run test:postgres-migrations/g)).toHaveLength(1);
    expect(release).toBe("bun run check && bun run test:postgres-migrations && bun run verify:pack && bun audit && bun pm untrusted");
    expect(postgres.match(/scripts\/test-postgres-migrations\.sh/g)).toHaveLength(1);
    expect(postgres).toContain("PostgreSQL 16.13");
    expect(postgres).toContain("superuser");
    expect(postgres).toContain("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    expect(postgres).not.toContain("verify:release");
    expect(postgres).not.toContain("bun run test:postgres-migrations");
  });

  test("migration reporting and packed verification derive schema version from the migrated database", () => {
    const cli = readFileSync("src/cli.ts", "utf8");
    const migrate = readFileSync("src/bin/computers-migrate.ts", "utf8");
    const pack = readFileSync("scripts/verify-pack.ts", "utf8");
    for (const source of [cli, migrate, pack]) expect(source).toContain("SELECT MAX(version) AS version FROM schema_migrations");
    expect(cli).not.toContain("version: 2");
    expect(migrate).not.toContain("schemaVersion: 2");
    expect(pack).not.toContain("migrated.schemaVersion === 2");
    expect(pack).toContain("migrated.schemaVersion === schemaVersion");
  });

  test("documents the executable live local canary with the canonical local-config flag", async () => {
    const readme = readFileSync("README.md", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const documentedCommand = readme.match(/^bun run canary:local-mac -- .*$/m)?.[0];
    expect(documentedCommand).toBe("bun run canary:local-mac -- --local-config /absolute/private/local-controller.json --db /absolute/canary.db --confirm LIVE_LOCAL_VM_CANARY");
    expect(packageJson.scripts["canary:local-mac"]).toBe("bun run src/bin/computers.ts local config canary");

    const help = await runCli(["--help"]);
    expect(help).toMatchObject({ code: 0, stderr: "" });
    expect(help.stdout).toContain("local config validate|probe|canary");

    const common = ["/not-read/computers-local-config.json", "--db", "/not-read/computers-canary.db"];
    const legacy = await runCli(["local", "config", "canary", "--config", ...common]);
    expect(legacy.code).toBe(2);
    expect(legacy.stdout).toBe("");
    expect(JSON.parse(legacy.stderr)).toEqual({ error: { code: "invalid_request", message: "--local-config is required" } });

    const canonical = await runCli(["local", "config", "canary", "--local-config", ...common]);
    expect(canonical.code).toBe(2);
    expect(canonical.stdout).toBe("");
    expect(JSON.parse(canonical.stderr)).toEqual({ error: { code: "invalid_request", message: "--confirm is required" } });
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

  test("release surface gate partitions every route and pins exact operation and fallthrough matrices", () => {
    const mutableRoutes = REST_ROUTE_MANIFEST
      .filter((route) => route.method === "POST" && route.path.startsWith("/v1/") && route.path !== "/v1/sandboxes")
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(Object.keys(REQUIRED_MUTABLE_RUNTIME_RESPONSES).sort()).toEqual(mutableRoutes);
    const categorizedRoutes = [
      ...Object.keys(REQUIRED_PUBLIC_RUNTIME_RESPONSES),
      ...Object.keys(REQUIRED_AUTHENTICATED_GET_RESPONSES),
      ...Object.keys(REQUIRED_MUTABLE_RUNTIME_RESPONSES),
      ...Object.keys(REQUIRED_SANDBOX_RUNTIME_RESPONSES),
    ].sort();
    expect(categorizedRoutes).toEqual(REST_ROUTE_MANIFEST.map((route) => `${route.method} ${route.path}`).sort());
    for (const action of ["start", "stop", "quarantine", "delete"]) {
      expect(REQUIRED_MUTABLE_RUNTIME_RESPONSES[`POST /v1/computers/{computerId}/${action}` as keyof typeof REQUIRED_MUTABLE_RUNTIME_RESPONSES])
        .toEqual(["202", "400", "401", "403", "404", "409", "413", "500"]);
    }
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as {
      "x-runtime-response-matrix": unknown;
      paths: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    expect(api["x-runtime-response-matrix"]).toEqual(REST_NON_OPERATION_RESPONSE_MANIFEST);
    for (const [route, statuses] of Object.entries(REQUIRED_MUTABLE_RUNTIME_RESPONSES)) {
      const path = route.slice(route.indexOf(" ") + 1);
      const responses = api.paths[path]?.post?.responses ?? {};
      expect(Object.keys(responses)).toEqual([...statuses]);
      for (const status of statuses) {
        expect(responses[status], `${route} ${status}`).toBeDefined();
        if (Number(status) >= 400) expect(responses[status]).toEqual({ $ref: "#/components/responses/Error" });
      }
    }
  });
});
