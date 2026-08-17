#!/usr/bin/env bun
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  NPM_RELEASE_AGENT_REVIEW_SCHEMA,
  deriveNpmReleaseAgentReviewKeyId,
  isNativeCodewithSubagentLineage,
  issueSignedNpmReleaseAgentReviewReceipt,
  parsePublisherAgentTrailer,
  type NpmReleaseAgentReviewPayload,
} from "../src/lib/npm-release-agent-review";
import { resolveNpmReleasePackageByPath } from "../src/lib/npm-release-package";

type ReleasePackage = {
  name?: string;
  version?: string;
  publishConfig?: { registry?: string };
  scripts?: { prepublishOnly?: string };
};

type Options = {
  releaseCommit?: string;
  packagePath?: string;
  publisherAgent?: string;
  verdict?: "GO" | "NO_GO";
  openP0: number;
  openP1: number;
};

const REPOSITORY = "hasna/apps";
const root = repositoryRoot();

main();

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const reviewerAgent = requiredEnvironment("RELEASE_REVIEWER_AGENT");
  const reviewerKeyId = requiredEnvironment("RELEASE_REVIEW_KEY_ID");
  const reviewerPublicKey = requiredEnvironment("RELEASE_REVIEW_PUBLIC_KEY");
  const reviewerPrivateKey = requiredEnvironment("RELEASE_REVIEW_PRIVATE_KEY");

  if (!options.releaseCommit || !/^[0-9a-f]{40}$/.test(options.releaseCommit)) fail("--release-commit must be an exact 40-hex Git commit");
  if (!options.publisherAgent) fail("--publisher-agent is required");
  if (!options.verdict) fail("--verdict GO|NO_GO is required");
  if (![options.openP0, options.openP1].every((value) => Number.isInteger(value) && value >= 0)) {
    fail("--open-p0 and --open-p1 must be non-negative integers");
  }
  if (options.verdict === "GO" && (options.openP0 !== 0 || options.openP1 !== 0)) {
    fail("a GO receipt must have --open-p0 0 and --open-p1 0");
  }
  if (options.verdict === "NO_GO" && options.openP0 === 0 && options.openP1 === 0) {
    fail("a NO_GO receipt must name at least one open P0 or P1 blocker");
  }
  if (!isNativeCodewithSubagentLineage(reviewerAgent)) {
    fail("RELEASE_REVIEWER_AGENT must name the exact native Codewith sub-agent lineage fixed for this release candidate");
  }
  if (parsePublisherAgentTrailer(`Agent: ${options.publisherAgent}`).failures.length > 0) {
    fail("--publisher-agent must be a registered agent identifier");
  }
  if (reviewerAgent.toLowerCase() === options.publisherAgent.toLowerCase()) {
    fail("reviewer and publisher agents must differ");
  }

  if (deriveNpmReleaseAgentReviewKeyId(reviewerPublicKey) !== reviewerKeyId) {
    fail("RELEASE_REVIEW_KEY_ID does not derive from RELEASE_REVIEW_PUBLIC_KEY");
  }

  let releasePackage;
  try {
    releasePackage = resolveNpmReleasePackageByPath(options.packagePath);
  } catch (error) {
    fail(error instanceof Error ? error.message : "package path must be apps/todos or apps/todos/ai");
  }
  const packageJson = JSON.parse(runGit(["show", `${options.releaseCommit}:${releasePackage.manifestPath}`])) as ReleasePackage;
  if (packageJson.name !== releasePackage.packageName) {
    fail(`the release commit ${releasePackage.manifestPath} must declare ${releasePackage.packageName}`);
  }
  if (!packageJson.version) fail(`the release commit ${releasePackage.manifestPath} must declare a version`);
  if (packageJson.publishConfig?.registry !== "https://registry.npmjs.org") fail("the release commit must target the public npm registry");
  if (packageJson.scripts?.prepublishOnly !== releasePackage.releaseProcedure) {
    fail(`the release commit ${releasePackage.manifestPath} must retain its package-owned prepublishOnly review gate`);
  }
  requireProtectedMainAncestry(options.releaseCommit);
  const procedureRevision = runGit(["rev-parse", `${options.releaseCommit}:${releasePackage.releaseProcedurePath}`]).trim();

  const payload: NpmReleaseAgentReviewPayload = {
    schema: NPM_RELEASE_AGENT_REVIEW_SCHEMA,
    repository: REPOSITORY,
    commit: options.releaseCommit,
    package: { name: packageJson.name, version: packageJson.version },
    tag: `${releasePackage.tagPrefix}${packageJson.version}`,
    procedure: { path: releasePackage.releaseProcedurePath, revision: procedureRevision },
    registry: packageJson.publishConfig.registry,
    reviewer: { type: "coding-agent", agent: reviewerAgent },
    publisher: { type: "coding-agent", agent: options.publisherAgent },
    verdict: options.verdict,
    openReachableInScopeBlockers: { p0: options.openP0, p1: options.openP1 },
  };
  let receipt;
  try {
    receipt = issueSignedNpmReleaseAgentReviewReceipt(
      payload,
      reviewerPrivateKey,
      reviewerPublicKey,
      reviewerKeyId,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : "could not sign receipt");
  }

  console.log(JSON.stringify(receipt));
}

function parseOptions(args: string[]): Options {
  const options: Options = { openP0: 0, openP1: 0 };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined) fail(`missing value for ${flag ?? "argument"}`);
    switch (flag) {
      case "--release-commit": options.releaseCommit = value; break;
      case "--package-path": options.packagePath = value; break;
      case "--publisher-agent": options.publisherAgent = value; break;
      case "--verdict":
        if (value !== "GO" && value !== "NO_GO") fail("--verdict must be GO or NO_GO");
        options.verdict = value;
        break;
      case "--open-p0": options.openP0 = Number(value); break;
      case "--open-p1": options.openP1 = Number(value); break;
      default: fail(`unknown option ${flag}`);
    }
  }
  return options;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) fail(`${name} is required`);
  return value.trim();
}

function runGit(args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) fail(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

function repositoryRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: resolve(import.meta.dir, ".."),
    encoding: "utf8",
  });
  if (result.status !== 0) fail(result.stderr.trim() || "could not resolve the hasna/apps repository root");
  return result.stdout.trim();
}

function requireProtectedMainAncestry(releaseCommit: string): void {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", releaseCommit, "refs/remotes/origin/main"],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) fail("the release commit must be contained in protected main");
}

function fail(message: string): never {
  console.error(`Could not issue signed npm release agent review receipt: ${message}`);
  process.exit(1);
}
