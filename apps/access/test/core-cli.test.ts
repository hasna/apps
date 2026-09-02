import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("published CLI operation uses the authenticated HTTPS boundary", () => {
  const result = spawnSync(process.execPath, ["--preload", "./test/helpers/client-fetch.ts", "src/cli/index.tsx", "identity", "create", "--entity-id", "unit-entity", "--kind", "agent", "--name", "unit", "--json"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { PATH: process.env.PATH, HASNA_ACCESS_API_URL: "https://access.example.test", HASNA_ACCESS_API_KEY: "isolated-cli-test" },
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ path: "/v1/identities", method: "POST", body: { entity_id: "unit-entity", kind: "agent", name: "unit" } });
});

test("CLI refuses a local database selector before executing", () => {
  const result = spawnSync(process.execPath, ["src/cli/index.tsx", "identity", "list", "--json"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { PATH: process.env.PATH, HASNA_ACCESS_DB_PATH: ":memory:" }, encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("cannot consume HASNA_ACCESS_DB_PATH");
});
