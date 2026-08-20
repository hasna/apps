// Coverage for the contracts alignment itself: the manifest shape, the release
// gate wiring, and the publish path.
//
// Without these, the whole alignment is untested — the rest of the suite is
// green whether hasna.contract.json validates or not and whether `npm pack`
// works or not, which is exactly how an invalid manifest and a prepack that
// always exits 1 reached a branch reporting "test: pass".
//
// Everything here runs the pinned `@hasna/contracts` devDependency out of
// node_modules/.bin — never `bunx`, so the assertions do not depend on what the
// registry serves today.

import { describe, expect, test } from "bun:test";
import { lstatSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(import.meta.dir, "..");
const manifestPath = join(repoRoot, "hasna.contract.json");

/**
 * Resolve the pinned `@hasna/contracts` CLI through the installed package's
 * own declared bin, never through node_modules/.bin. Bun creates no .bin shim
 * for workspace-linked members (wave #602 aligned members to workspace
 * versions), so the shim path dies with ENOENT in a fresh checkout. Reading
 * the package's bin declaration keeps the resolution deterministic under both
 * install shapes and still pins to what the lockfile installed.
 */
function resolveContractsCli(): string {
  const packageJsonPath = fileURLToPath(import.meta.resolve("@hasna/contracts/package.json"));
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    bin: { contracts?: string } | string;
  };
  const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin.contracts;
  if (typeof bin !== "string" || bin.length === 0) {
    throw new Error("@hasna/contracts does not declare the contracts CLI");
  }
  return resolve(dirname(packageJsonPath), bin);
}

const contractsBin = resolveContractsCli();

// `bins_match_package` fails while package.json still exposes the `hasna-events`
// alias: the contract allowlist admits only `events` and the documented suffixes.
// Retiring a published, README-documented bin is a breaking change and an owner
// decision, so it is named here rather than hidden. Any OTHER failing check is a
// regression and fails the test.
const KNOWN_UNRESOLVED_CHECKS = new Set(["bins_match_package"]);

type ConformanceCheck = { id: string; status: string; detail: string };

function runContracts(args: string[]) {
  const result = Bun.spawnSync([contractsBin, ...args], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function runScript(script: string) {
  const result = Bun.spawnSync(["bun", "run", script], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function conformanceChecks(): ConformanceCheck[] {
  const result = runContracts(["repo-conformance", ".", "--json"]);
  const report = JSON.parse(result.stdout) as { checks: ConformanceCheck[] };
  return report.checks;
}

describe("hasna.contract.json", () => {
  test("validates against the embedded service-contract schema", () => {
    const result = runContracts(["validate", manifestPath]);
    expect(`${result.stdout}${result.stderr}`).toContain("hasna.service_contract.v1");
    expect(result.exitCode).toBe(0);
  });

  test("declares the v1 keys the schema requires, not invented ones", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest.schema).toBe("hasna.service_contract.v1");
    expect(manifest.name).toBe("events");
    expect(manifest.contractVersion).toBe("v1");
    expect(typeof manifest.kitVersion).toBe("string");
    expect(manifest.class).toBe("library");
    // The pre-alignment draft invented these; a consumer reading the published
    // manifest would find nothing the schema knows about.
    for (const invented of ["schema_version", "project", "package"]) {
      expect(manifest).not.toHaveProperty(invented);
    }
  });

  test("pins the kit version it was written against to the installed devDependency", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { kitVersion: string };
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies["@hasna/contracts"]).toBe(manifest.kitVersion);
  });
});

describe("repo conformance", () => {
  test("accepts the manifest", () => {
    const manifestValid = conformanceChecks().find((check) => check.id === "manifest_valid");
    expect(manifestValid?.status).toBe("pass");
  });

  test("passes the published-artifact release gate", () => {
    const gate = conformanceChecks().find((check) => check.id === "published_artifact_gate");
    expect(gate?.status).toBe("pass");
  });

  test("has no failing check beyond the named unresolved one", () => {
    const unexpected = conformanceChecks()
      .filter((check) => check.status === "fail" && !KNOWN_UNRESOLVED_CHECKS.has(check.id))
      .map((check) => `${check.id}: ${check.detail}`);
    expect(unexpected).toEqual([]);
  });
});

describe("workspace-linked contracts kit", () => {
  // Wave #602 aligned member deps to workspace versions; bun creates no .bin
  // shim for workspace-linked members, so a resolver that assumes
  // node_modules/.bin/contracts dies with ENOENT in a fresh checkout. The
  // resolver must read the pinned package's own declared bin instead — the
  // same shape the contracts/machines precedent (d1936c56d3) used.
  test("resolves and runs the pinned contracts CLI without a package-local bin shim", () => {
    const contractsPackage = JSON.parse(
      readFileSync(fileURLToPath(import.meta.resolve("@hasna/contracts/package.json")), "utf8"),
    ) as { version: string };
    expect(contractsBin).toEndWith(join("dist", "cli", "index.js"));
    expect(contractsBin).not.toContain(join("node_modules", ".bin"));

    const shim = join(repoRoot, "node_modules", ".bin", "contracts");
    const hiddenShim = `${shim}.clean-install-test-hidden`;
    let shimMoved = false;
    try {
      lstatSync(shim);
      renameSync(shim, hiddenShim);
      shimMoved = true;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }

    try {
      const result = Bun.spawnSync([contractsBin, "--version"], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      expect(new TextDecoder().decode(result.stdout).trim()).toBe(contractsPackage.version);
    } finally {
      if (shimMoved) renameSync(hiddenShim, shim);
    }
  });
});

describe("release scripts", () => {
  test("the declared artifact scan names a real script that reaches the packed tarball", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      metadata: { release: { artifactScan: { script: string } } };
    };
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const declared = manifest.metadata.release.artifactScan.script;
    expect(pkg.scripts[declared]).toBeString();
    expect(pkg.scripts.prepack).toContain(declared);
    // A package runner with no version pin makes the gate non-reproducible, and
    // `contracts artifact-scan` with no target argument just exits 1.
    expect(pkg.scripts[declared]).not.toContain("bunx");
    expect(pkg.scripts[declared]).not.toContain("npx");
  });

  test("contract:check invokes a subcommand the CLI actually has", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const subcommand = pkg.scripts["contract:check"].split(/\s+/).find((token) => token.includes("conformance"));
    expect(subcommand).toBeString();
    const help = runContracts(["--help"]);
    expect(help.stdout).toContain(`${subcommand} `);
  });

  test("artifact-scan packs and scans the real artifact", () => {
    const result = runScript("artifact-scan");
    expect(`${result.stdout}${result.stderr}`).toContain("packed_artifact");
    expect(result.exitCode).toBe(0);
  }, 120_000);

  test("prepack succeeds so the package can still be published", () => {
    const result = runScript("prepack");
    expect(result.exitCode).toBe(0);
  }, 180_000);
});
