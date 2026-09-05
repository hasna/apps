/**
 * The DATABASE_URL boundary — the database half of the API-first contract.
 *
 * Client surfaces (CLI, MCP, SDK) are thin adapters over the Skills HTTP API:
 * they reach hosted state through `SKILLS_API_URL` plus an API key, and they
 * never open Postgres (or any database) directly. A client that built a
 * database connection from the environment would reach past the API into the
 * operator's storage — duplicating server-side schema and migration ownership
 * and making a credential-bearing client do what the boundary says only the
 * server does.
 *
 * The three names below are the only database-locator variables the package
 * knows: `HASNA_SKILLS_DATABASE_URL` (canonical), `SKILLS_DATABASE_URL`
 * (accepted local-dev fallback), and `DATABASE_URL` (the generic spelling the
 * server config also accepts). The server reads all three. Nothing on a client
 * surface may.
 *
 * The one deliberate exception is the repo-native storage sync
 * (`src/lib/native-storage.ts`, exported as `@hasna/skills/storage`): an
 * operator tool documented under Storage Boundary in the README that
 * intentionally reads the same variables. It is a storage surface, not an API
 * client path, and it is not a thin adapter over the Skills API.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DATABASE_URL_ENV_NAMES = [
  "HASNA_SKILLS_DATABASE_URL",
  "SKILLS_DATABASE_URL",
  "DATABASE_URL",
] as const;

/**
 * Files where a mention of a DATABASE_URL name is legitimate, and why:
 *
 *  - `src/server/**` — the server owns the database by definition.
 *  - `src/lib/native-storage.ts` — the documented repo-native storage sync, an
 *    operator tool that intentionally reads the same variables (see the header
 *    comment). The public package re-exports it as the storage-only surface.
 *  - `src/sdk/governance.ts` and `src/server/redaction.ts` — secret-scan regexes
 *    that match the variable NAME as a secret-shaped token; they never read it.
 *  - `src/mcp/mcp-test-client.ts` — test scaffolding that points the MCP server
 *    under test at a memory database; never shipped.
 */
function isAllowedDatabaseUrlFile(relativePath: string): boolean {
  if (relativePath.startsWith("src/server/")) return true;
  if (relativePath === "src/lib/native-storage.ts") return true;
  if (relativePath === "src/sdk/governance.ts") return true;
  if (relativePath === "src/server/redaction.ts") return true;
  if (relativePath === "src/mcp/mcp-test-client.ts") return true;
  return false;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "bin", ".git"].includes(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    files.push(fullPath);
  }
  return files;
}

describe("database boundary contract", () => {
  test("no client source file reads a DATABASE_URL env var", () => {
    const offenders = sourceFiles(join(repoRoot, "src"))
      .map((file) => relative(repoRoot, file))
      .filter((file) => !isAllowedDatabaseUrlFile(file))
      .flatMap((file) => {
        const content = readFileSync(join(repoRoot, file), "utf8");
        return DATABASE_URL_ENV_NAMES.filter((name) => content.includes(name)).map(
          (name) => `${file}:${name}`,
        );
      });

    // A client that mentions a DATABASE_URL name is a client that reads it —
    // the variable is never a value a thin adapter has a legitimate reason to
    // name. When this fails, the fix is not to widen the allowlist; it is to
    // route the new behavior through the Skills API.
    expect(offenders).toEqual([]);
  });

  test("README states DATABASE_URL is server-only and clients use the API", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("server-only");
    expect(readme).toMatch(/HASNA_SKILLS_DATABASE_URL[^\n]*server-only/);
    expect(readme).toMatch(/SKILLS_API_URL/);
  });

  test("CLAUDE.md states DATABASE_URL is server-only and clients use the API", () => {
    const claude = readFileSync(join(repoRoot, "CLAUDE.md"), "utf8");
    expect(claude).toContain("server-only");
    expect(claude).toMatch(/SKILLS_API_URL/);
  });

  test("the API-first boundaries doc keeps the no-direct-database clause", () => {
    const doc = readFileSync(join(repoRoot, "docs", "architecture", "api-first-boundaries.md"), "utf8");
    expect(doc).toContain("never open a database connection");
    expect(doc).toContain("the authority and\ncredential the shared ladder resolves");
  });
});
