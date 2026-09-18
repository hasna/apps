#!/usr/bin/env bun
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  isReleaseReviewAgentId,
  parsePublisherAgentTrailer,
  validateNpmReleaseAgentReviewReceipt,
  type ExpectedNpmReleaseAgentReview,
  type NpmReleaseAgentReviewFailure,
} from "../src/lib/npm-release-agent-review";
import { parseNpmReleaseLane, resolveNpmReleaseContext, resolveNpmReleasePublishMode } from "../src/lib/npm-release-context";
import { resolveNpmReleasePackageByTag } from "../src/lib/npm-release-package";

type ReleasePackage = {
  name?: string;
  version?: string;
  publishConfig?: { registry?: string };
  scripts?: { prepublishOnly?: string };
};

const REPOSITORY = "hasna/apps";
const root = repositoryRoot();

main();

function main(): void {
  const failures: NpmReleaseAgentReviewFailure[] = [];
  const context = resolveNpmReleaseContext(process.env);
  if (context.failures.length > 0) fail(context.failures);
  const { releaseCommit, tag } = context;
  if (runGit(["rev-parse", "HEAD"], "release-agent-review-checkout") !== releaseCommit) {
    fail([{ check: "release-agent-review-checkout", message: "the current checkout must equal the exact release commit" }]);
  }
  let releasePackage;
  try {
    releasePackage = resolveNpmReleasePackageByTag(tag);
  } catch {
    fail([{ check: "release-agent-review-ref-name", message: "the release tag must use an allowed npm release tag prefix" }]);
  }
  const packageJson = JSON.parse(runGit(["show", `${releaseCommit}:${releasePackage.manifestPath}`], "release-agent-review-package-manifest", false)) as ReleasePackage;
  const reviewerAgentId = process.env["RELEASE_REVIEWER_AGENT"] ?? "";
  const reviewerKeyId = process.env["RELEASE_REVIEW_KEY_ID"] ?? "";
  const reviewerPublicKey = process.env["RELEASE_REVIEW_PUBLIC_KEY"] ?? "";

  addContextFailure(failures, packageJson.name !== releasePackage.packageName, "release-agent-review-package", `${releasePackage.manifestPath} must declare ${releasePackage.packageName}`);
  addContextFailure(failures, !packageJson.version, "release-agent-review-version", "package.json must declare a release version");
  addContextFailure(failures, packageJson.version !== releasePackage.version, "release-agent-review-ref-name", `the release tag must carry ${releasePackage.manifestPath} version ${packageJson.version ?? ""}`);
  addContextFailure(failures, packageJson.publishConfig?.registry !== "https://registry.npmjs.org", "release-agent-review-registry", "package.json must target the public npm registry");
  addContextFailure(
    failures,
    packageJson.scripts?.prepublishOnly !== releasePackage.releaseProcedure,
    "release-agent-review-procedure",
    `${releasePackage.manifestPath} must retain its package-owned prepublishOnly review gate`,
  );
  const selectedPackagePath = process.env["HASNA_TODOS_RELEASE_PACKAGE_PATH"];
  if (selectedPackagePath !== undefined) {
    addContextFailure(failures, selectedPackagePath !== releasePackage.packagePath, "release-agent-review-package-path", `HASNA_TODOS_RELEASE_PACKAGE_PATH must equal ${releasePackage.packagePath}`);
  }
  addContextFailure(
    failures,
    !isReleaseReviewAgentId(reviewerAgentId),
    "release-agent-review-reviewer-config",
    "RELEASE_REVIEWER_AGENT must name the canonical registered coding agent fixed for this release candidate",
  );
  addContextFailure(failures, !reviewerKeyId, "release-agent-review-key-id-config", "RELEASE_REVIEW_KEY_ID must identify the fixed reviewer public key");
  addContextFailure(failures, !reviewerPublicKey, "release-agent-review-public-key", "RELEASE_REVIEW_PUBLIC_KEY must contain the fixed reviewer public key");

  if (failures.length > 0) fail(failures);

  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", releaseCommit, "refs/remotes/origin/main"], { cwd: root, encoding: "utf8" });
  if (ancestry.status !== 0) {
    fail([{ check: "release-agent-review-protected-main", message: "the release commit must be contained in protected main" }]);
  }
  const procedureRevision = runGit(["rev-parse", `${releaseCommit}:${releasePackage.releaseProcedurePath}`], "release-agent-review-procedure-revision");
  const tagRef = `refs/tags/${tag}`;
  const tagType = runGit(["cat-file", "-t", tagRef], "release-agent-review-tag-type");
  if (tagType !== "tag") {
    fail([{ check: "release-agent-review-tag-type", message: "the release tag must be an annotated tag object" }]);
  }
  const tagCommit = runGit(["rev-parse", `${tagRef}^{commit}`], "release-agent-review-tag-commit");
  if (tagCommit !== releaseCommit) {
    fail([{ check: "release-agent-review-tag-commit", message: "the annotated release tag must target the release commit exactly" }]);
  }
  const tagMessage = runGit(["for-each-ref", "--format=%(contents)", tagRef], "release-agent-review-tag-message", false);
  if (releasePackage.packagePath === "apps/todos") {
    try {
      const lane = parseNpmReleaseLane(tagMessage);
      const expectedLane = context.mode === "vault-token" ? "vault-token" : resolveNpmReleasePublishMode(process.env.RELEASE_PUBLISH_MODE);
      if (lane !== expectedLane) throw new Error("the annotated release tag lane must match the explicit publisher delivery mode");
      if (context.mode === "github-actions" && process.env.npm_lifecycle_event === "prepublishOnly" && lane !== "oidc") {
        throw new Error("GitHub Actions may publish only a tag assigned to the oidc lane");
      }
    } catch (error) {
      fail([{ check: "release-agent-review-delivery-lane", message: error instanceof Error ? error.message : "invalid release delivery lane" }]);
    }
  } else if (context.mode === "vault-token") {
    fail([{ check: "release-agent-review-delivery-package", message: "the local vault-token context is supported only for apps/todos" }]);
  }
  const publisher = parsePublisherAgentTrailer(tagMessage);
  if (publisher.failures.length > 0 || !publisher.agentId) fail(publisher.failures);

  const expected: ExpectedNpmReleaseAgentReview = {
    repository: REPOSITORY,
    releaseCommit,
    packagePath: releasePackage.packagePath,
    packageName: packageJson.name!,
    packageVersion: packageJson.version!,
    tag,
    procedurePath: releasePackage.releaseProcedurePath,
    procedureRevision,
    registry: packageJson.publishConfig!.registry!,
    reviewerAgentId,
    reviewerKeyId,
    reviewerPublicKey,
    publisherAgentId: publisher.agentId,
  };
  const result = validateNpmReleaseAgentReviewReceipt(
    process.env["NPM_RELEASE_AGENT_REVIEW_RECEIPT"],
    expected,
  );
  if (result.failures.length > 0 || !result.receipt || !result.payload) fail(result.failures);

  console.log(JSON.stringify({
    context: context.mode,
    schema: result.receipt.schema,
    signature_algorithm: result.receipt.signature.algorithm,
    signature_key_id: result.receipt.signature.key_id,
    verdict: result.payload.verdict,
    repository: result.payload.repository,
    release_commit: result.payload.commit,
    package: `${result.payload.package.name}@${result.payload.package.version}`,
    package_path: releasePackage.packagePath,
    tag: result.payload.tag,
    procedure_path: result.payload.procedure.path,
    procedure_revision: result.payload.procedure.revision,
    reviewer_agent_id: result.payload.reviewer.agent,
    publisher_agent_id: result.payload.publisher.agent,
    open_p0_blockers: result.payload.openReachableInScopeBlockers.p0,
    open_p1_blockers: result.payload.openReachableInScopeBlockers.p1,
  }));
  console.log("Independent coding-agent npm release review gate passed.");
}

function runGit(args: string[], check: string, trim = true): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    fail([{ check, message: result.stderr.trim() || `git ${args[0]} failed` }]);
  }
  return trim ? result.stdout.trim() : result.stdout;
}

function repositoryRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: resolve(import.meta.dir, ".."),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail([{ check: "release-agent-review-repository-root", message: result.stderr.trim() || "could not resolve the hasna/apps repository root" }]);
  }
  return result.stdout.trim();
}

function addContextFailure(
  failures: NpmReleaseAgentReviewFailure[],
  condition: boolean,
  check: string,
  message: string,
): void {
  if (condition) failures.push({ check, message });
}

function fail(failures: NpmReleaseAgentReviewFailure[]): never {
  console.error("Independent coding-agent npm release review gate failed:");
  for (const failure of failures) console.error(`- ${failure.check}: ${failure.message}`);
  process.exit(1);
}
