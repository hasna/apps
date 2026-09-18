import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = resolve(import.meta.dir, "../..");
const root = resolve(app, "../..");
const dockerfile = readFileSync(resolve(app, "Dockerfile"), "utf8");

test("the Calendar image accepts the requested architecture and monorepo context", () => {
  expect(dockerfile).not.toMatch(/^FROM\s+--platform=/m);
  const copies = dockerfile.split("\n").filter(line => /^COPY (?!.*--from=)/.test(line));
  expect(copies.length).toBeGreaterThan(0);
  for (const copy of copies) {
    for (const source of copy.split(/\s+/).slice(1, -1)) {
      expect(source.startsWith("apps/calendar/")).toBe(true);
      expect(existsSync(resolve(root, source)), source).toBe(true);
    }
  }
  expect(dockerfile).toContain("bun install --frozen-lockfile --ignore-scripts");
});

test("runtime preserves the server command, tenant migration, and offline dependency boundary", () => {
  expect(dockerfile).toContain('CMD ["bun", "dist/server/index.js"]');
  expect(dockerfile).toContain("COPY apps/calendar/migrations ./migrations");
  expect(existsSync(resolve(app, "migrations/0003_tenant_boundary.sql"))).toBe(true);
  expect(readFileSync(resolve(app, "docker/runner-bunfig.toml"), "utf8")).toContain("auto = \"disable\"");
  expect(dockerfile).toContain("COPY apps/calendar/docker/runner-bunfig.toml ./bunfig.toml");
});
