import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  adoptResolverOperatorDataDir,
  effectiveOperatorDataDir,
  ensureOperatorDataDir,
  legacyOperatorDataDir,
  resolverOperatorDataDir,
} from "./data-dir.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempHome(): string {
  const d = mkdtempSync(join(tmpdir(), "secrets-paths-home-"));
  dirs.push(d);
  return d;
}

function envOf(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { HOME: home, ...extra };
}

describe("operator data-dir resolution through @hasna/paths", () => {
  it("defaults to the legacy the secrets data root home until adoption", () => {
    const home = tempHome();
    const env = envOf(home);

    expect(legacyOperatorDataDir(env)).toBe(join(home, ".hasna", "secrets"));
    // No HASNA_DATA_HOME and no vault at the resolver home -> legacy stays effective.
    expect(effectiveOperatorDataDir(env)).toBe(join(home, ".hasna", "secrets"));
    expect(adoptResolverOperatorDataDir(resolverOperatorDataDir(env), env)).toBe(false);
  });

  it("resolves the XDG data home under a fake HOME", () => {
    const home = tempHome();
    expect(resolverOperatorDataDir(envOf(home))).toBe(
      join(home, ".local", "share", "hasna", "secrets"),
    );
  });

  it("adopts the resolver home when HASNA_DATA_HOME is set", () => {
    const home = tempHome();
    const dataHome = tempHome();
    const env = envOf(home, { HASNA_DATA_HOME: dataHome });

    expect(adoptResolverOperatorDataDir(resolverOperatorDataDir(env), env)).toBe(true);
    // HASNA_DATA_HOME names the hasna-level root; the app slug is appended.
    expect(effectiveOperatorDataDir(env)).toBe(join(dataHome, "secrets"));
  });

  it("treats an empty HASNA_DATA_HOME as unset (XDG semantics) -> legacy default", () => {
    const home = tempHome();
    const env = envOf(home, { HASNA_DATA_HOME: "" });
    expect(effectiveOperatorDataDir(env)).toBe(join(home, ".hasna", "secrets"));
  });

  it("adopts the resolver home when the vault has already been migrated there (vault.db exists)", () => {
    const home = tempHome();
    const resolved = join(home, ".local", "share", "hasna", "secrets");
    mkdirSync(resolved, { recursive: true });
    const db = new Database(join(resolved, "vault.db"), { create: true });
    db.close();

    const env = envOf(home);
    expect(adoptResolverOperatorDataDir(resolverOperatorDataDir(env), env)).toBe(true);
    expect(effectiveOperatorDataDir(env)).toBe(resolved);
  });

  it("migrates service-owned files from ~/.secrets into the resolver home once adopted", () => {
    const home = tempHome();
    const dataHome = tempHome();
    const legacyDir = join(home, ".secrets");
    mkdirSync(legacyDir, { recursive: true });
    const db = new Database(join(legacyDir, "vault.db"), { create: true });
    db.exec("CREATE TABLE migration_marker (value TEXT NOT NULL); INSERT INTO migration_marker VALUES ('preserved')");
    db.close();
    writeFileSync(join(legacyDir, "vault.key"), "legacy-key-fixture");

    const env = envOf(home, { HASNA_DATA_HOME: dataHome });
    const target = ensureOperatorDataDir(env);

    expect(target).toBe(join(dataHome, "secrets"));
    const migrated = new Database(join(target, "vault.db"));
    expect(migrated.query("SELECT value FROM migration_marker").get()).toEqual({ value: "preserved" });
    migrated.close();
    expect(readFileSync(join(target, "vault.key"), "utf8")).toBe("legacy-key-fixture");
  });

  it("migrates service-owned files into the legacy home when not adopted", () => {
    const home = tempHome();
    const legacyDir = join(home, ".secrets");
    mkdirSync(legacyDir, { recursive: true });
    const db = new Database(join(legacyDir, "vault.db"), { create: true });
    db.exec("CREATE TABLE migration_marker (value TEXT NOT NULL); INSERT INTO migration_marker VALUES ('legacy-default')");
    db.close();

    const env = envOf(home);
    const target = ensureOperatorDataDir(env);
    expect(target).toBe(join(home, ".hasna", "secrets"));
    expect(existsSync(join(target, "vault.db"))).toBe(true);
  });
});
