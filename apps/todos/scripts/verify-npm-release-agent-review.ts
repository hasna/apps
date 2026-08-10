#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  isNativeCodewithSubagentLineage,
  parsePublisherAgentTrailer,
  validateNpmReleaseAgentReviewReceipt,
  type ExpectedNpmReleaseAgentReview,
  type NpmReleaseAgentReviewFailure,
} from "../src/lib/npm-release-agent-review";

type ReleasePackage = {
  name?: string;
  version?: string;
  publishConfig?: { registry?: string };
};

const REPOSITORY = "hasna/todos";
const WORKFLOW_PATH = ".github/workflows/release.yml";
const root = resolve(import.meta.dir, "..");

main();

function main(): void {
  const failures: NpmReleaseAgentReviewFailure[] = [];
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as ReleasePackage;
  const releaseCommit = process.env["GITHUB_SHA"] ?? "";
  const tag = `npm/todos/v${packageJson.version ?? ""}`;
  const reviewerAgentId = process.env["RELEASE_REVIEWER_AGENT"] ?? "";
  const reviewerKeyId = process.env["RELEASE_REVIEW_KEY_ID"] ?? "";
  const reviewerPublicKey = process.env["RELEASE_REVIEW_PUBLIC_KEY"] ?? "";

  addContextFailure(failures, process.env["GITHUB_EVENT_NAME"] !== "push", "release-agent-review-event", "agent review authority requires a tag push event");
  addContextFailure(failures, process.env["GITHUB_REPOSITORY"] !== REPOSITORY, "release-agent-review-context-repository", `GITHUB_REPOSITORY must be ${REPOSITORY}`);
  addContextFailure(failures, !/^[0-9a-f]{40}$/.test(releaseCommit), "release-agent-review-context-commit", "GITHUB_SHA must identify the exact 40-hex release commit");
  addContextFailure(failures, process.env["GITHUB_REF_TYPE"] !== "tag", "release-agent-review-ref-type", "the release ref must be a tag");
  addContextFailure(failures, process.env["GITHUB_REF_NAME"] !== tag, "release-agent-review-ref-name", `GITHUB_REF_NAME must be ${tag}`);
  addContextFailure(failures, packageJson.name !== "@hasna/todos", "release-agent-review-package", "package.json must declare @hasna/todos");
  addContextFailure(failures, !packageJson.version, "release-agent-review-version", "package.json must declare a release version");
  addContextFailure(failures, packageJson.publishConfig?.registry !== "https://registry.npmjs.org", "release-agent-review-registry", "package.json must target the public npm registry");
  addContextFailure(
    failures,
    !isNativeCodewithSubagentLineage(reviewerAgentId),
    "release-agent-review-reviewer-config",
    "RELEASE_REVIEWER_AGENT must name the exact native Codewith sub-agent lineage fixed for this release candidate",
  );
  addContextFailure(failures, !reviewerKeyId, "release-agent-review-key-id-config", "RELEASE_REVIEW_KEY_ID must identify the fixed reviewer public key");
  addContextFailure(failures, !reviewerPublicKey, "release-agent-review-public-key", "RELEASE_REVIEW_PUBLIC_KEY must contain the fixed reviewer public key");

  const expectedCommit = process.env["HASNA_TODOS_EXPECTED_COMMIT"];
  if (expectedCommit !== undefined) {
    addContextFailure(failures, expectedCommit !== releaseCommit, "release-agent-review-expected-commit", "HASNA_TODOS_EXPECTED_COMMIT must equal GITHUB_SHA");
  }

  if (failures.length > 0) fail(failures);

  const workflowRevision = runGit(["rev-parse", `${releaseCommit}:${WORKFLOW_PATH}`], "release-agent-review-workflow-revision");
  const tagRef = `refs/tags/${tag}`;
  const tagType = runGit(["cat-file", "-t", tagRef], "release-agent-review-tag-type");
  if (tagType !== "tag") {
    fail([{ check: "release-agent-review-tag-type", message: "the release tag must be an annotated tag object" }]);
  }
  const tagCommit = runGit(["rev-parse", `${tagRef}^{commit}`], "release-agent-review-tag-commit");
  if (tagCommit !== releaseCommit) {
    fail([{ check: "release-agent-review-tag-commit", message: "the annotated release tag must target GITHUB_SHA exactly" }]);
  }
  const tagMessage = runGit(["for-each-ref", "--format=%(contents)", tagRef], "release-agent-review-tag-message", false);
  const publisher = parsePublisherAgentTrailer(tagMessage);
  if (publisher.failures.length > 0 || !publisher.agentId) fail(publisher.failures);

  const expected: ExpectedNpmReleaseAgentReview = {
    repository: REPOSITORY,
    releaseCommit,
    packageName: packageJson.name!,
    packageVersion: packageJson.version!,
    tag,
    workflowPath: WORKFLOW_PATH,
    workflowRevision,
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
    schema: result.receipt.schema,
    signature_algorithm: result.receipt.signature.algorithm,
    signature_key_id: result.receipt.signature.key_id,
    verdict: result.payload.verdict,
    repository: result.payload.repository,
    release_commit: result.payload.commit,
    package: `${result.payload.package.name}@${result.payload.package.version}`,
    tag: result.payload.tag,
    workflow_path: result.payload.workflow.path,
    workflow_revision: result.payload.workflow.revision,
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
