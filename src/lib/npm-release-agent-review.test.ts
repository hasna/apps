import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  NPM_RELEASE_AGENT_REVIEW_SCHEMA,
  deriveNpmReleaseAgentReviewKeyId,
  issueSignedNpmReleaseAgentReviewReceipt,
  parsePublisherAgentTrailer,
  validateNpmReleaseAgentReviewReceipt,
  type ExpectedNpmReleaseAgentReview,
  type NpmReleaseAgentReviewPayload,
  type SignedNpmReleaseAgentReviewReceipt,
} from "./npm-release-agent-review";

const keyPair = generateKeyPairSync("ed25519");
const otherKeyPair = generateKeyPairSync("ed25519");
const reviewerPublicKey = keyPair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const reviewerPrivateKey = keyPair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const reviewerKeyId = deriveNpmReleaseAgentReviewKeyId(reviewerPublicKey);

const expected: ExpectedNpmReleaseAgentReview = {
  repository: "hasna/projects",
  releaseCommit: "1".repeat(40),
  packageName: "@hasna/projects",
  packageVersion: "0.1.131",
  tag: "npm/projects/v0.1.131",
  workflowPath: ".github/workflows/release.yml",
  workflowRevision: "2".repeat(40),
  registry: "https://registry.npmjs.org",
  reviewerAgentId: "/root/fleet_register_v5_fixed_reviewer",
  reviewerKeyId,
  reviewerPublicKey,
  publisherAgentId: "fleet",
};

const acceptedPayload: NpmReleaseAgentReviewPayload = {
  schema: NPM_RELEASE_AGENT_REVIEW_SCHEMA,
  repository: expected.repository,
  commit: expected.releaseCommit,
  package: {
    name: expected.packageName,
    version: expected.packageVersion,
  },
  tag: expected.tag,
  workflow: {
    path: expected.workflowPath,
    revision: expected.workflowRevision,
  },
  registry: expected.registry,
  reviewer: {
    type: "coding-agent",
    agent: expected.reviewerAgentId,
  },
  publisher: {
    type: "coding-agent",
    agent: expected.publisherAgentId,
  },
  verdict: "GO",
  openReachableInScopeBlockers: {
    p0: 0,
    p1: 0,
  },
};

function signedReceipt(
  payload: unknown = acceptedPayload,
  privateKey: typeof keyPair.privateKey = keyPair.privateKey,
): SignedNpmReleaseAgentReviewReceipt {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return {
    schema: NPM_RELEASE_AGENT_REVIEW_SCHEMA,
    payload: payloadBytes.toString("base64"),
    signature: {
      algorithm: "ed25519",
      key_id: reviewerKeyId,
      value: sign(null, payloadBytes, privateKey).toString("base64"),
    },
  };
}

function validate(receipt: unknown, overrides: Partial<ExpectedNpmReleaseAgentReview> = {}) {
  return validateNpmReleaseAgentReviewReceipt(
    receipt === undefined ? undefined : JSON.stringify(receipt),
    { ...expected, ...overrides },
  );
}

describe("npm release independent-agent review receipt", () => {
  test("accepts only the exact reviewer-signed independent GO receipt", () => {
    const receipt = signedReceipt();
    const result = validate(receipt);
    expect(result.failures).toEqual([]);
    expect(result.receipt).toEqual(receipt);
    expect(result.payload).toEqual(acceptedPayload);
  });

  test("package issuer signs with the configured reviewer key and rejects a different key", () => {
    const receipt = issueSignedNpmReleaseAgentReviewReceipt(
      acceptedPayload,
      reviewerPrivateKey,
      reviewerPublicKey,
      reviewerKeyId,
    );
    expect(validate(receipt).failures).toEqual([]);
    expect(() => issueSignedNpmReleaseAgentReviewReceipt(
      acceptedPayload,
      otherKeyPair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      reviewerPublicKey,
      reviewerKeyId,
    )).toThrow("private key does not match reviewer public key");
  });

  test("blocks missing, malformed, unsigned, NO_GO, and nonzero-blocker receipts", () => {
    expect(validate(undefined).failures.map((failure) => failure.check)).toEqual(["release-agent-review-missing"]);
    expect(validate("not-an-object").failures.map((failure) => failure.check)).toContain("release-agent-review-shape");
    expect(validate(acceptedPayload).failures.map((failure) => failure.check)).toContain("release-agent-review-shape");
    expect(validate(signedReceipt({ ...acceptedPayload, verdict: "NO_GO" })).failures.map((failure) => failure.check)).toContain("release-agent-review-verdict");
    expect(validate(signedReceipt({
      ...acceptedPayload,
      openReachableInScopeBlockers: { p0: 0, p1: 1 },
    })).failures.map((failure) => failure.check)).toContain("release-agent-review-blockers");
  });

  test("rejects the wrong signing key, key id drift, and payload tampering", () => {
    expect(validate(signedReceipt(acceptedPayload, otherKeyPair.privateKey)).failures.map((failure) => failure.check)).toContain("release-agent-review-signature");

    const receipt = signedReceipt();
    expect(validate({
      ...receipt,
      signature: { ...receipt.signature, key_id: "ed25519:sha256:wrong" },
    }).failures.map((failure) => failure.check)).toContain("release-agent-review-key-id");
    expect(validate(receipt, { reviewerKeyId: "ed25519:sha256:wrong" }).failures.map((failure) => failure.check)).toContain("release-agent-review-key-id-config");
    expect(validate({
      ...receipt,
      payload: Buffer.from(JSON.stringify({
        ...acceptedPayload,
        package: { ...acceptedPayload.package, version: "0.1.132" },
      })).toString("base64"),
    }).failures.map((failure) => failure.check)).toContain("release-agent-review-signature");
  });

  test("rejects self-review and reviewer or publisher identity drift", () => {
    expect(validate(signedReceipt({
      ...acceptedPayload,
      reviewer: { type: "coding-agent", agent: "/root/fleet" },
      publisher: { type: "coding-agent", agent: "/root/fleet" },
    })).failures.map((failure) => failure.check)).toContain("release-agent-review-independence");
    expect(validate(signedReceipt({
      ...acceptedPayload,
      reviewer: { type: "coding-agent", agent: "/root/different_reviewer" },
    })).failures.map((failure) => failure.check)).toContain("release-agent-review-reviewer");
    expect(validate(signedReceipt({
      ...acceptedPayload,
      publisher: { type: "coding-agent", agent: "different-publisher" },
    })).failures.map((failure) => failure.check)).toContain("release-agent-review-publisher");
  });

  test("rejects persona names and malformed reviewer lineages", () => {
    for (const reviewerAgentId of [
      "Anscombe",
      "independent-reviewer",
      "/root",
      "/root/Review_projects_release",
      "/root/review.projects.release",
      "/other/review_projects_release",
    ]) {
      const result = validate(
        signedReceipt({
          ...acceptedPayload,
          reviewer: { type: "coding-agent", agent: reviewerAgentId },
        }),
        { reviewerAgentId },
      );
      expect(result.failures.map((failure) => failure.check)).toContain("release-agent-review-reviewer-runtime");
    }
  });

  test("rejects every exact release binding mismatch and a prior-candidate replay", () => {
    const mismatches: Array<[NpmReleaseAgentReviewPayload, string]> = [
      [{ ...acceptedPayload, repository: "hasna/accounts" }, "release-agent-review-repository"],
      [{ ...acceptedPayload, commit: "3".repeat(40) }, "release-agent-review-commit"],
      [{ ...acceptedPayload, package: { ...acceptedPayload.package, name: "@hasna/accounts" } }, "release-agent-review-package"],
      [{ ...acceptedPayload, package: { ...acceptedPayload.package, version: "0.1.130" } }, "release-agent-review-version"],
      [{ ...acceptedPayload, tag: "npm/projects/v0.1.130" }, "release-agent-review-tag"],
      [{ ...acceptedPayload, workflow: { ...acceptedPayload.workflow, path: ".github/workflows/other.yml" } }, "release-agent-review-workflow-path"],
      [{ ...acceptedPayload, workflow: { ...acceptedPayload.workflow, revision: "4".repeat(40) } }, "release-agent-review-workflow-revision"],
      [{ ...acceptedPayload, registry: "https://registry.example.invalid" }, "release-agent-review-registry"],
    ];

    for (const [payload, check] of mismatches) {
      expect(validate(signedReceipt(payload)).failures.map((failure) => failure.check)).toContain(check);
    }
  });

  test("rejects unknown fields and non-canonical base64", () => {
    expect(validate({ ...signedReceipt(), unreviewed_extension: true }).failures.map((failure) => failure.check)).toContain("release-agent-review-shape");
    expect(validate(signedReceipt({ ...acceptedPayload, unreviewed_extension: true })).failures.map((failure) => failure.check)).toContain("release-agent-review-payload-shape");
    const receipt = signedReceipt();
    expect(validate({ ...receipt, payload: `${receipt.payload}\n` }).failures.map((failure) => failure.check)).toContain("release-agent-review-payload-encoding");
  });

  test("extracts exactly one final publisher Agent trailer", () => {
    expect(parsePublisherAgentTrailer("Release @hasna/projects@0.1.131\n\nAgent: fleet\n")).toEqual({
      agentId: "fleet",
      failures: [],
    });
    expect(parsePublisherAgentTrailer("Release\n").failures.map((failure) => failure.check)).toEqual(["release-agent-review-tag-publisher"]);
    expect(parsePublisherAgentTrailer("Agent: first\nAgent: second\n").failures.map((failure) => failure.check)).toEqual(["release-agent-review-tag-publisher"]);
  });
});
