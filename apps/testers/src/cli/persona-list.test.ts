import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "bun";

import { closeDatabase, resetDatabase } from "../db/database.js";
import { createPersona, updatePersona } from "../db/personas.js";

const cleanupPaths: string[] = [];

function setupPersonaDb() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-persona-list-"));
  const dbPath = join(baseDir, "testers.db");
  cleanupPaths.push(baseDir);

  process.env.TESTERS_DB_PATH = dbPath;
  resetDatabase();

  const persona = createPersona({
    name: "Authenticated QA",
    role: "tester",
    authEmail: "qa@example.test",
    authPassword: "super-secret-password",
    authLoginPath: "/auth/login",
  });
  updatePersona(persona.id, {
    authCookies: [
      { name: "accessToken", value: "raw-access-token", domain: "localhost", path: "/" },
      { name: "refreshToken", value: "raw-refresh-token", domain: "localhost", path: "/" },
    ],
    authHeaders: { Authorization: "Bearer raw-bearer-token" },
  }, persona.version);

  closeDatabase();
  return { dbPath };
}

afterEach(() => {
  closeDatabase();
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.TESTERS_DB_PATH;
});

describe("testers persona list CLI", () => {
  test("redacts auth secrets from JSON output", () => {
    const { dbPath } = setupPersonaDb();
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "persona", "list", "--json"],
      env: { ...process.env, TESTERS_DB_PATH: dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const stdout = proc.stdout.toString();
    expect(stdout).not.toContain("super-secret-password");
    expect(stdout).not.toContain("raw-access-token");
    expect(stdout).not.toContain("raw-refresh-token");
    expect(stdout).not.toContain("raw-bearer-token");

    const personas = JSON.parse(stdout);
    expect(personas).toHaveLength(1);
    expect(personas[0].auth).toEqual({
      emailConfigured: true,
      passwordConfigured: true,
      loginPath: "/auth/login",
      strategy: "form-login",
      cookiesConfigured: true,
      cookieCount: 2,
      cookieNames: ["accessToken", "refreshToken"],
      headersConfigured: true,
      headerNames: ["Authorization"],
      customScriptConfigured: false,
    });
  });
});
