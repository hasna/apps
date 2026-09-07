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
  dataDir,
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

/**
 * The resolver (XDG / macOS) data home for THIS platform. The operator-facing
 * helpers below take no platform argument — they follow `process.platform`,
 * as the shipped CLI does — so the expected shape has to follow it too. The
 * platform-explicit cases further down pin both layouts regardless of the
 * machine running the suite.
 */
function expectedResolverDataHome(home: string): string {
  return process.platform === "darwin"
    ? join(home, "Library", "Application Support", "Hasna", "secrets")
    : join(home, ".local", "share", "hasna", "secrets");
}

describe("the data-home resolver (the one surviving @hasna/paths kind)", () => {
  it("resolves the XDG data home on linux", () => {
    expect(dataDir({ app: "secrets", home: "/home/op", env: {}, platform: "linux" })).toBe(
      "/home/op/.local/share/hasna/secrets",
    );
  });

  it("resolves the Application Support data home on darwin", () => {
    expect(dataDir({ app: "secrets", home: "/Users/op", env: {}, platform: "darwin" })).toBe(
      "/Users/op/Library/Application Support/Hasna/secrets",
    );
  });

  it("HASNA_DATA_HOME overrides the platform layout on every platform", () => {
    for (const platform of ["linux", "darwin"]) {
      expect(dataDir({ app: "secrets", home: "/x", env: { HASNA_DATA_HOME: "/data/hasna" }, platform })).toBe(
        "/data/hasna/secrets",
      );
    }
  });

  it("nests internal apps under internal/", () => {
    expect(dataDir({ app: "secrets", internal: true, home: "/home/op", env: {}, platform: "linux" })).toBe(
      "/home/op/.local/share/hasna/internal/secrets",
    );
  });

  it("rejects an invalid app slug", () => {
    expect(() => dataDir({ app: "Not A Slug", home: "/x", env: {}, platform: "linux" })).toThrow(/invalid app slug/);
  });
});

describe("operator data-dir resolution", () => {
  it("defaults to the legacy ~/.hasna/secrets home until adoption", () => {
    const home = tempHome();
    const env = envOf(home);

    expect(legacyOperatorDataDir(env)).toBe(join(home, ".hasna", "secrets"));
    // No HASNA_DATA_HOME and no vault at the resolver home -> legacy stays effective.
    expect(effectiveOperatorDataDir(env)).toBe(join(home, ".hasna", "secrets"));
    expect(adoptResolverOperatorDataDir(resolverOperatorDataDir(env), env)).toBe(false);
  });

  it("the opt-in local vault ignores HASNA_HOME — that variable moves only the credential file", () => {
    // HASNA_HOME replaces `~/.hasna` for the @hasna/contracts credential tier.
    // The local vault stays where the HC-00304 guard protects it; HASNA_DATA_HOME
    // and the file-level overrides are the documented ways to move it.
    const home = tempHome();
    const env = envOf(home, { HASNA_HOME: join(home, "elsewhere") });
    expect(legacyOperatorDataDir(env)).toBe(join(home, ".hasna", "secrets"));
    expect(effectiveOperatorDataDir(env)).toBe(join(home, ".hasna", "secrets"));
  });

  it("resolves the platform data home under a fake HOME", () => {
    const home = tempHome();
    expect(resolverOperatorDataDir(envOf(home))).toBe(expectedResolverDataHome(home));
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
    const env = envOf(home);
    const resolved = resolverOperatorDataDir(env);
    expect(resolved).toBe(expectedResolverDataHome(home));
    mkdirSync(resolved, { recursive: true });
    const db = new Database(join(resolved, "vault.db"), { create: true });
    db.close();

    expect(adoptResolverOperatorDataDir(resolved, env)).toBe(true);
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
