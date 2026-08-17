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
  repository: "hasna/apps",
  releaseCommit: "1".repeat(40),
  packagePath: "apps/todos",
  packageName: "@hasna/todos",
  packageVersion: "0.15.20",
  tag: "npm/todos/v0.15.20",
    procedurePath: "apps/todos/scripts/verify-public-release.ts",
  procedureRevision: "2".repeat(40),
  registry: "https://registry.npmjs.org",
  reviewerAgentId: "/root/review_todos_release_01522",
  reviewerKeyId,
  reviewerPublicKey,
  publisherAgentId: "nausicaa",
};

const companionExpected: ExpectedNpmReleaseAgentReview = {
  ...expected,
  packagePath: "apps/todos/ai",
  packageName: "@hasna/todos-ai",
  packageVersion: "0.1.1",
  tag: "npm/todos-ai/v0.1.1",
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
  procedure: {
    path: expected.procedurePath,
    revision: expected.procedureRevision,
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

const companionPayload: NpmReleaseAgentReviewPayload = {
  ...acceptedPayload,
  package: {
    name: companionExpected.packageName,
    version: companionExpected.packageVersion,
  },
  tag: companionExpected.tag,
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

function validate(receipt: unknown) {
  return validateNpmReleaseAgentReviewReceipt(
    receipt === undefined ? undefined : JSON.stringify(receipt),
    expected,
  );
}

function validateCompanion(receipt: unknown) {
  return validateNpmReleaseAgentReviewReceipt(
    receipt === undefined ? undefined : JSON.stringify(receipt),
    companionExpected,
  );
}

describe("npm release independent-agent review receipt", () => {
  test("accepts an exact reviewer-signed independent GO receipt", () => {
    const receipt = signedReceipt();
    const result = validate(receipt);
    expect(result.failures).toEqual([]);
    expect(result.receipt).toEqual(receipt);
    expect(result.payload).toEqual(acceptedPayload);
  });

  test("accepts exact root and companion receipts under the shared package procedure contract", () => {
    expect(validate(signedReceipt(acceptedPayload)).failures).toEqual([]);
    const companionReceipt = signedReceipt(companionPayload);
    expect(validateCompanion(companionReceipt).failures).toEqual([]);
    expect(validateCompanion(companionReceipt).payload).toEqual(companionPayload);
  });

  test("package issuer signs with the configured reviewer key and rejects a wrong private key", () => {
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

  test("keeps missing, malformed, unsigned, and NO_GO receipts blocked", () => {
    expect(validate(undefined).failures.map((failure) => failure.check)).toEqual([
      "release-agent-review-missing",
    ]);
    expect(validate("not-an-object").failures.map((failure) => failure.check)).toContain(
      "release-agent-review-shape",
    );
    expect(validate(acceptedPayload).failures.map((failure) => failure.check)).toContain(
      "release-agent-review-shape",
    );
    expect(validate(signedReceipt({ ...acceptedPayload, verdict: "NO_GO" })).failures.map((failure) => failure.check)).toContain(
      "release-agent-review-verdict",
    );
  });

  test("rejects a signature not made by the fixed reviewer key", () => {
    expect(validate(signedReceipt(acceptedPayload, otherKeyPair.privateKey)).failures.map((failure) => failure.check)).toContain(
      "release-agent-review-signature",
    );
  });

  test("rejects a mismatched key id and a configured key id that does not derive from the public key", () => {
    const receipt = signedReceipt();
    expect(validate({
      ...receipt,
      signature: { ...receipt.signature, key_id: "ed25519:sha256:wrong" },
    }).failures.map((failure) => failure.check)).toContain("release-agent-review-key-id");
    expect(validateNpmReleaseAgentReviewReceipt(JSON.stringify(receipt), {
      ...expected,
      reviewerKeyId: "ed25519:sha256:wrong",
    }).failures.map((failure) => failure.check)).toContain("release-agent-review-key-id-config");
  });

  test("rejects payload tampering after signature issuance", () => {
    const receipt = signedReceipt();
    const tamperedPayload = {
      ...acceptedPayload,
      package: { ...acceptedPayload.package, version: "0.15.21" },
    };
    expect(validate({
      ...receipt,
      payload: Buffer.from(JSON.stringify(tamperedPayload)).toString("base64"),
    }).failures.map((failure) => failure.check)).toContain("release-agent-review-signature");
  });

  test("requires zero open concrete reachable P0/P1 blockers", () => {
    for (const blockers of [{ p0: 1, p1: 0 }, { p0: 0, p1: 1 }]) {
      const failures = validate(signedReceipt({
        ...acceptedPayload,
        openReachableInScopeBlockers: blockers,
      })).failures;
      expect(failures.map((failure) => failure.check)).toContain("release-agent-review-blockers");
    }
  });

  test("rejects self-review, reviewer drift, and publisher identity drift", () => {
    expect(validate(signedReceipt({
      ...acceptedPayload,
      reviewer: { type: "coding-agent", agent: "NAUSICAA" },
    })).failures.map((failure) => failure.check)).toContain("release-agent-review-independence");
    expect(validate(signedReceipt({
      ...acceptedPayload,
      reviewer: { type: "coding-agent", agent: "different-reviewer" },
    })).failures.map((failure) => failure.check)).toContain("release-agent-review-reviewer");
    expect(validate(signedReceipt({
      ...acceptedPayload,
      publisher: { type: "coding-agent", agent: "different-publisher" },
    })).failures.map((failure) => failure.check)).toContain("release-agent-review-publisher");
  });

  test("rejects Fable-attributed and malformed reviewer identities even when configuration matches", () => {
    for (const reviewerAgentId of [
      "Anscombe",
      "independent-reviewer",
      "/root",
      "/root/Review_todos_release_01522",
      "/root/review.todos.release",
      "/other/review_todos_release_01522",
    ]) {
      const payload = {
        ...acceptedPayload,
        reviewer: { type: "coding-agent" as const, agent: reviewerAgentId },
      };
      const result = validateNpmReleaseAgentReviewReceipt(
        JSON.stringify(signedReceipt(payload)),
        { ...expected, reviewerAgentId },
      );
      expect(result.failures.map((failure) => failure.check)).toContain(
        "release-agent-review-reviewer-runtime",
      );
    }
  });

  test("rejects every exact release binding mismatch", () => {
    const mismatches: Array<[unknown, string, ExpectedNpmReleaseAgentReview?]> = [
      [{ ...acceptedPayload, repository: "hasna/accounts" }, "release-agent-review-repository"],
      [{ ...acceptedPayload, commit: "3".repeat(40) }, "release-agent-review-commit"],
      [{ ...acceptedPayload }, "release-agent-review-package-path", { ...expected, packagePath: "apps/todos/ai" }],
      [{ ...acceptedPayload, package: { ...acceptedPayload.package, name: "@hasna/accounts" } }, "release-agent-review-package"],
      [{ ...acceptedPayload, package: { ...acceptedPayload.package, version: "0.15.21" } }, "release-agent-review-version"],
      [{ ...acceptedPayload, tag: "npm/todos/v0.15.21" }, "release-agent-review-tag"],
      [{ ...acceptedPayload, procedure: { ...acceptedPayload.procedure, path: "apps/todos/other.json" } }, "release-agent-review-procedure-path"],
      [{ ...acceptedPayload, procedure: { ...acceptedPayload.procedure, revision: "4".repeat(40) } }, "release-agent-review-procedure-revision"],
      [{ ...acceptedPayload, registry: "https://registry.example.invalid" }, "release-agent-review-registry"],
    ];

    for (const mismatch of mismatches) {
      const [payload, check, mismatchExpected] = mismatch as [unknown, string, ExpectedNpmReleaseAgentReview?];
      const result = mismatchExpected
        ? validateNpmReleaseAgentReviewReceipt(JSON.stringify(signedReceipt(payload)), mismatchExpected)
        : validate(signedReceipt(payload));
      expect(result.failures.map((failure) => failure.check)).toContain(check);
    }
  });

  test("rejects cross-package and replayed receipts", () => {
    const rootChecks = validate(signedReceipt(companionPayload)).failures.map((failure) => failure.check);
    expect(rootChecks).toContain("release-agent-review-package-path");
    expect(rootChecks).toContain("release-agent-review-package");
    expect(rootChecks).toContain("release-agent-review-tag");

    const companionChecks = validateCompanion(signedReceipt(acceptedPayload)).failures.map((failure) => failure.check);
    expect(companionChecks).toContain("release-agent-review-package-path");
    expect(companionChecks).toContain("release-agent-review-package");
    expect(companionChecks).toContain("release-agent-review-tag");
  });

  test("rejects replay of a valid prior-candidate receipt", () => {
    const priorCandidate = signedReceipt({
      ...acceptedPayload,
      commit: "9".repeat(40),
      package: { ...acceptedPayload.package, version: "0.15.19" },
      tag: "npm/todos/v0.15.19",
    });
    const checks = validate(priorCandidate).failures.map((failure) => failure.check);
    expect(checks).toContain("release-agent-review-commit");
    expect(checks).toContain("release-agent-review-version");
    expect(checks).toContain("release-agent-review-tag");
  });

  test("rejects unknown wrapper or payload fields and non-canonical base64", () => {
    expect(validate({ ...signedReceipt(), unreviewed_extension: true }).failures.map((failure) => failure.check)).toContain(
      "release-agent-review-shape",
    );
    expect(validate(signedReceipt({ ...acceptedPayload, unreviewed_extension: true })).failures.map((failure) => failure.check)).toContain(
      "release-agent-review-payload-shape",
    );
    const receipt = signedReceipt();
    expect(validate({ ...receipt, payload: `${receipt.payload}\n` }).failures.map((failure) => failure.check)).toContain(
      "release-agent-review-payload-encoding",
    );
  });

  test("extracts exactly one publisher Agent trailer from an annotated tag message", () => {
    expect(parsePublisherAgentTrailer("Release @hasna/todos@0.15.20\n\nAgent: nausicaa\n")).toEqual({
      agentId: "nausicaa",
      failures: [],
    });
    expect(parsePublisherAgentTrailer("Release\n").failures.map((failure) => failure.check)).toEqual([
      "release-agent-review-tag-publisher",
    ]);
    expect(parsePublisherAgentTrailer("Agent: first\nAgent: second\n").failures.map((failure) => failure.check)).toEqual([
      "release-agent-review-tag-publisher",
    ]);
  });
});
