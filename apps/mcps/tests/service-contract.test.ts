import { describe, expect, it } from "bun:test";
import "./setup";
import { runRepoConformance } from "@hasna/contracts/conformance";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

type PackageManifest = {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  repository: { type: string; url: string };
  homepage: string;
  bugs: { url: string };
};

type ServiceContract = {
  schema: string;
  name: string;
  class: string;
  contractVersion: string;
  kitVersion: string;
  metadata?: { release?: { artifactScan?: { script?: string } } };
};

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as PackageManifest;
const contract = JSON.parse(readFileSync(join(REPO_ROOT, "hasna.contract.json"), "utf-8")) as ServiceContract;

const GITHUB_REPO_URL = "https://github.com/hasna/mcps";

describe("hasna service contract manifest", () => {
  it("satisfies every repo-conformance check for the declared kit version", () => {
    // env is pinned to an empty environment so mode_enum_compliance reads the
    // manifest default rather than whatever the shell happens to export.
    const report = runRepoConformance(REPO_ROOT, { env: {} });
    const failed = report.checks.filter((check) => check.status === "fail");

    expect(failed.map((check) => `${check.id}: ${check.detail}`)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.name).toBe("mcps");
    expect(report.class).toBe("cli-with-store");
  });

  it("passes the individual checks the manifest exists to satisfy", () => {
    const report = runRepoConformance(REPO_ROOT, { env: {} });
    const statusOf = (id: string) => report.checks.find((check) => check.id === id)?.status;

    expect(statusOf("manifest_valid")).toBe("pass");
    expect(statusOf("bins_allowlisted")).toBe("pass");
    expect(statusOf("bins_match_package")).toBe("pass");
    expect(statusOf("storage_capabilities")).toBe("pass");
    expect(statusOf("published_artifact_gate")).toBe("pass");
  });

  it("declares the v1 schema identity under the app short-name", () => {
    expect(contract.schema).toBe("hasna.service_contract.v1");
    expect(contract.contractVersion).toBe("v1");
    // The app short-name, not the local folder name: bins and ~/.hasna/mcps/ derive from it.
    expect(contract.name).toBe("mcps");
  });

  it("declares the packed-artifact scan script that prepack actually runs", () => {
    const script = contract.metadata?.release?.artifactScan?.script;
    expect(script).toBeString();
    expect(pkg.scripts[script!]).toBeString();
    expect(pkg.scripts.prepack).toContain(`bun run ${script}`);
  });
});

describe("contract:check script", () => {
  const script = pkg.scripts["contract:check"];

  it("pins the same kit version the manifest tracks", () => {
    expect(pkg.devDependencies["@hasna/contracts"]).toBe(contract.kitVersion);
    expect(script).toContain(`@hasna/contracts@${contract.kitVersion}`);
  });

  it("invokes a subcommand the pinned kit exposes", () => {
    const subcommand = script.split(/\s+/).find((token, index, tokens) => {
      const previous = tokens[index - 1] ?? "";
      return previous.startsWith("@hasna/contracts");
    });
    expect(subcommand).toBeString();

    // Resolve the pinned CLI from node_modules so the assertion is offline and
    // reflects the version the script pins rather than whatever npx would fetch.
    // Note: `<cli> <subcommand> --help` exits 0 even for an unknown subcommand,
    // so the command listing is the only reliable source of truth here.
    const cli = join(REPO_ROOT, "node_modules", "@hasna", "contracts", "dist", "cli", "index.js");
    const help = spawnSync("bun", [cli, "--help"], { encoding: "utf-8" });
    expect(help.status).toBe(0);

    const commands = help.stdout
      .split("Commands:")[1]!
      .split("\n")
      .map((line) => line.match(/^ {2}(\S+)/)?.[1])
      .filter((name): name is string => Boolean(name));

    expect(commands).toContain("repo-conformance");
    expect(commands).toContain(subcommand!);
  });
});

describe("package repository metadata", () => {
  it("points at the real github.com/hasna/mcps repository", () => {
    expect(pkg.repository.url).toBe(`git+${GITHUB_REPO_URL}.git`);
    expect(pkg.homepage).toBe(`${GITHUB_REPO_URL}#readme`);
    expect(pkg.bugs.url).toBe(`${GITHUB_REPO_URL}/issues`);
  });

  it("never uses the local open-* folder name as a GitHub slug", () => {
    // Convention: folder open-mcps / npm @hasna/mcps / GitHub hasna/mcps.
    // github.com/hasna/open-mcps does not exist, so any such link is a dead link.
    expect(JSON.stringify(pkg)).not.toContain("github.com/hasna/open-");
  });
});
