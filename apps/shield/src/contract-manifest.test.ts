import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ServiceContractManifestSchema } from "@hasna/contracts/schemas";
import { resolveDbPath } from "./db/database.js";

/**
 * hasna.contract.json is shipped inside the published tarball (package.json
 * `files`), so an invalid manifest is not a local lint problem — it reaches
 * every consumer and every tool that reads the contract. These assertions run
 * against the real `@hasna/contracts` schema rather than a local copy so the
 * repo cannot drift away from the kit it claims to track.
 */

const repoRoot = join(import.meta.dir, "..");

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf-8")) as Record<string, unknown>;
}

const rawManifest = readJson("hasna.contract.json");
const pkg = readJson("package.json") as {
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
  exports?: Record<string, unknown>;
};

const STORE_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "SECURITY_DB",
  "HASNA_SHIELD_STORAGE_MODE",
  "HASNA_SECURITY_STORAGE_MODE",
] as const;

/**
 * Resolves the store the way the shield CLI does — throwaway HOME, no
 * `SECURITY_DB` override, no storage-mode override, and a working directory with
 * neither a `.security` nor a `.shield` folder so the project-local branches of
 * `getDbPath()` do not win — then reports it in the manifest's own `~`-relative
 * form. Comparing the declared `storage.sqlitePath` against this is the only
 * assertion that fails when the manifest names a directory shield does not
 * actually write to; the schema itself only checks the `.db` suffix.
 */
function resolveStorePathUnderTempHome(): string {
  const saved = Object.fromEntries(STORE_ENV_KEYS.map((key) => [key, process.env[key]]));
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "shield-contract-store-"));
  const home = join(root, "home");
  const workDir = join(root, "work");
  try {
    mkdirSync(home, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    for (const key of STORE_ENV_KEYS) delete process.env[key];
    process.env.HOME = home;
    process.chdir(workDir);

    const resolved = resolveDbPath();
    expect(resolved.startsWith(home + "/")).toBe(true);
    return "~" + resolved.slice(home.length);
  } finally {
    process.chdir(originalCwd);
    for (const key of STORE_ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

describe("hasna.contract.json", () => {
  test("validates against the hasna.service_contract.v1 schema", () => {
    const result = ServiceContractManifestSchema.safeParse(rawManifest);
    const issues = result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`);
    expect(issues).toEqual([]);
    expect(result.success).toBe(true);
  });

  test("declares the app identity the published package uses", () => {
    const manifest = ServiceContractManifestSchema.parse(rawManifest);
    expect(manifest.schema).toBe("hasna.service_contract.v1");
    expect(manifest.name).toBe("shield");
    expect(manifest.contractVersion).toBe("v1");
    expect(manifest.kitVersion).toBe("0.8.5");
  });

  test("declared bins match package.json bin", () => {
    const manifest = ServiceContractManifestSchema.parse(rawManifest);
    expect([...manifest.bins].sort()).toEqual(Object.keys(pkg.bin ?? {}).sort());
  });

  test("declares the local SQLite storage boundary shield actually owns", () => {
    const manifest = ServiceContractManifestSchema.parse(rawManifest);
    expect(manifest.class).toBe("cli-with-store");
    expect(manifest.storage?.mode).toBe("sqlite");
    expect(manifest.storage?.envPrefix).toBe("HASNA_SHIELD_");
    // The schema only checks the `.db` suffix, so a suffix assertion would let
    // any wrong directory ship. Resolve the store the way the CLI does and
    // compare: fleet tooling reads this value to find shield's SQLite file, and
    // `~/.hasna/shield/shield.db` is a legacy migration source, not the store.
    expect(manifest.storage?.sqlitePath).toBe(resolveStorePathUnderTempHome());
  });

  test("every supported surface binds to a real package entrypoint", () => {
    const manifest = ServiceContractManifestSchema.parse(rawManifest);
    const bins = Object.keys(pkg.bin ?? {});
    const exportSubpaths = Object.keys(pkg.exports ?? {});
    const supported = manifest.serviceSurfaces.filter((surface) => surface.status === "supported");
    // cli, mcp, and sdk are the three surfaces shield ships today; the API
    // surface is declared `deferred` until shield-serve answers the contract
    // topology, so it is deliberately absent here.
    expect(supported.map((surface) => surface.kind).sort()).toEqual(["cli", "mcp", "sdk"]);
    for (const surface of supported) {
      if (surface.bin) expect(bins).toContain(surface.bin);
      if (surface.mcpBin) expect(bins).toContain(surface.mcpBin);
      if (surface.exportSubpath) expect(exportSubpaths).toContain(surface.exportSubpath);
    }
  });

  test("the declared release gate names a real script that prepack reaches", () => {
    const manifest = ServiceContractManifestSchema.parse(rawManifest);
    const scriptName = manifest.metadata?.release?.artifactScan?.script;
    expect(scriptName).toBeTruthy();
    const scripts = pkg.scripts ?? {};
    expect(Object.keys(scripts)).toContain(scriptName!);
    expect(scripts.prepack ?? "").toContain(scriptName!);
  });

  test("is shipped in the published tarball", () => {
    expect(pkg.files ?? []).toContain("hasna.contract.json");
  });

  test("claims no conformance waiver it is not eligible for", () => {
    const manifest = ServiceContractManifestSchema.parse(rawManifest);
    // A `cli-with-store` repo shipping `shield-serve` may not waive a storage
    // engine or a service surface (WAIVABLE_STORAGE_ENGINES excludes sqlite,
    // and surface waivers are library-only), so a declared waiver here would
    // be silently ignored by conformance while reading as an approved
    // exception.
    expect(manifest.metadata?.conformance?.waivedStorageEngines ?? []).toEqual([]);
    expect(manifest.metadata?.conformance?.waivedSurfaces ?? []).toEqual([]);
  });
});
