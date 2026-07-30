import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadServiceContractManifest, SERVICE_CONTRACT_MANIFEST_FILENAME } from "@hasna/contracts";
import { runRepoConformance } from "@hasna/contracts/conformance";
import { scanPackedArtifact } from "../scripts/scan-artifact.js";

const root = join(import.meta.dir, "..");

interface PackageJson {
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
}

function packageJson(): PackageJson {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;
}

function manifest() {
  const loaded = loadServiceContractManifest(root);
  if (!loaded.ok) {
    const issues = loaded.issues?.map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`).join("; ");
    throw new Error(`${SERVICE_CONTRACT_MANIFEST_FILENAME} is not a valid service contract: ${loaded.error}${issues ? `: ${issues}` : ""}`);
  }
  return loaded.manifest;
}

describe("hasna.contract.json", () => {
  it("validates against the Hasna Service Contract v1 schema shipped by @hasna/contracts", () => {
    const loaded = loadServiceContractManifest(root);
    const issues = loaded.ok
      ? ""
      : `${loaded.error}: ${loaded.issues?.map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`).join("; ") ?? ""}`;
    expect(issues).toBe("");
    expect(loaded.ok).toBe(true);
  });

  it("declares the app short-name and class the repo actually ships", () => {
    const parsed = manifest();
    expect(parsed.name).toBe("clip");
    expect(parsed.class).toBe("cli-with-store");
    expect(parsed.storage?.mode).toBe("sqlite");
  });

  it("declares exactly the bins package.json publishes", () => {
    const parsed = manifest();
    expect([...parsed.bins].sort()).toEqual(Object.keys(packageJson().bin ?? {}).sort());
  });

  it("tracks the @hasna/contracts version the package depends on", () => {
    const range = packageJson().dependencies?.["@hasna/contracts"];
    expect(range).toBeString();
    // kitVersion must be the floor of the dependency range, so the manifest can
    // never claim a kit whose features the installed dependency lacks.
    expect(manifest().kitVersion).toBe((range as string).replace(/^[\^~]/, ""));
  });

  it("names a release gate that prepack actually reaches", () => {
    const scripts = packageJson().scripts ?? {};
    const declared = manifest().metadata?.release?.artifactScan?.script;
    expect(declared).toBeString();
    expect(scripts[declared as string]).toBeString();
    expect(scripts["prepack"]).toContain(declared as string);
  });
});

describe("repo conformance", () => {
  // The full Service Contract v1 surface still needs an OpenAPI-generated SDK,
  // GET /ready and GET /version, a self-host deployment artifact, and a
  // PostgreSQL backend, none of which clip ships yet. Those checks stay red on
  // purpose; the two this manifest and release gate are responsible for do not.
  const OWNED_CHECKS = ["manifest_valid", "published_artifact_gate"] as const;

  it("passes the checks the manifest and the release gate are responsible for", () => {
    const report = runRepoConformance(root);
    const owned = report.checks.filter((check) => OWNED_CHECKS.includes(check.id as (typeof OWNED_CHECKS)[number]));
    expect(owned.map((check) => check.id).sort()).toEqual([...OWNED_CHECKS].sort());
    expect(owned.filter((check) => check.status !== "pass").map((check) => `${check.id}: ${check.detail}`)).toEqual([]);
  }, 60_000);
});

describe("artifact-scan release gate", () => {
  it("packs the publishable tarball and scans it with the locked contracts CLI", () => {
    // The gate runs from prepack, so a subcommand missing from the locked
    // @hasna/contracts version fails every npm pack and npm publish. Running it
    // here is the only place CI exercises that path.
    const { command, output } = scanPackedArtifact(root);
    expect(command[1]).toBe("artifact-scan");
    expect(command[2]).toEndWith(".tgz");
    expect(output).not.toBe("");
  }, 120_000);
});
