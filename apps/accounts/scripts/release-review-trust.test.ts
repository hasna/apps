import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RELEASE_REVIEW_BOOTSTRAP_VERSION,
  RELEASE_REVIEW_BOOTSTRAP_PUBLIC_KEY,
  RELEASE_REVIEW_BOOTSTRAP_PUBLIC_KEY_SHA256,
  RELEASE_REVIEW_PAYLOAD_SCHEMA,
  RELEASE_REVIEW_RECEIPT_SCHEMA,
  RELEASE_REVIEW_SIGNING_SECRET_REF,
  RELEASE_REVIEW_TRUST_PATH,
  buildReleaseReviewPayload,
  buildReleaseReviewTrustRotationPayload,
  parseReleaseReviewTrust,
  verifyReleaseReviewReceipt,
  verifyReleaseReviewTrustChain,
  type ReleaseReviewExpectation,
} from "./release-provenance";
import {
  postReleaseReviewReceipt,
  reviewSignerChildEnvironment,
  rotateReleaseReviewTrustDocument,
} from "./release-review-sign";

const reviewerId = "019fe5d3-a6dc-71a0-b6cc-243ea32513b6";
const generationTwoReviewerId = "4e38a26f-cb70-4418-8bd8-84ef440fa334";
const generationTwoReviewerAgent = "Fable Accounts Release Reviewer 2026-08-10";
const generationTwoSigningSecretRef =
  "hasna/accounts/npm-release/reviewer-ed25519-private-key-g2-20260810";
const generationTwoPublicKey =
  "MCowBQYDK2VwAyEAbNaUg0vPVuiwIkRYKndTxIgIVL2BphVGFRKriDpq2G4=";
const generationTwoPublicKeySha256 = createHash("sha256")
  .update(Buffer.from(generationTwoPublicKey, "base64"))
  .digest("hex");
const oldKey = generateKeyPairSync("ed25519");
const nextKey = generateKeyPairSync("ed25519");
const attackerKey = generateKeyPairSync("ed25519");

function publicKeyValue(key = oldKey.publicKey): string {
  return key.export({ format: "der", type: "spki" }).toString("base64");
}

function publicKeySha256(key = oldKey.publicKey): string {
  return createHash("sha256")
    .update(key.export({ format: "der", type: "spki" }))
    .digest("hex");
}

function trustCore(
  generation = 1,
  key = oldKey.publicKey,
  reviewer = { type: "coding-agent", agent: "Rawls", id: reviewerId },
) {
  return {
    schema: "hasna.release-review-trust/v1",
    generation,
    repository: "hasna/accounts",
    reviewer,
    publicKey: {
      algorithm: "ed25519",
      encoding: "base64-spki-der",
      value: publicKeyValue(key),
      sha256: publicKeySha256(key),
    },
    signer: {
      secretRef: RELEASE_REVIEW_SIGNING_SECRET_REF,
    },
  };
}

function trustBytes(value: Record<string, unknown>): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

const bootstrapBytes = trustBytes({ ...trustCore(), rotation: null });
const pinnedBootstrapBytes = trustBytes({
  ...trustCore(),
  publicKey: {
    algorithm: "ed25519",
    encoding: "base64-spki-der",
    value: RELEASE_REVIEW_BOOTSTRAP_PUBLIC_KEY,
    sha256: RELEASE_REVIEW_BOOTSTRAP_PUBLIC_KEY_SHA256,
  },
  rotation: null,
});
const priorRelease = {
  package: "@hasna/accounts",
  version: RELEASE_REVIEW_BOOTSTRAP_VERSION,
  registry: "https://registry.npmjs.org",
  trustSha256: createHash("sha256").update(bootstrapBytes).digest("hex"),
};

function rotatedTrustBytes(signingKey = oldKey.privateKey): Buffer {
  const core = trustCore(2, nextKey.publicKey);
  const payload = buildReleaseReviewTrustRotationPayload(core, priorRelease);
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return trustBytes({
    ...core,
    rotation: {
      payload: payloadBytes.toString("base64"),
      signature: {
        algorithm: "ed25519",
        value: sign(null, payloadBytes, signingKey).toString("base64"),
      },
    },
  });
}

const expectation: ReleaseReviewExpectation = {
  commentId: 42,
  repository: "hasna/accounts",
  commit: "0123456789abcdef0123456789abcdef01234567",
  packageName: "@hasna/accounts",
  version: RELEASE_REVIEW_BOOTSTRAP_VERSION,
  tag: `npm/accounts/v${RELEASE_REVIEW_BOOTSTRAP_VERSION}`,
  workflow: ".github/workflows/release.yml",
  workflowRevision: "89abcdef0123456789abcdef0123456789abcdef",
  trustPath: RELEASE_REVIEW_TRUST_PATH,
  trustRevision: "fedcba9876543210fedcba9876543210fedcba98",
  registry: "https://registry.npmjs.org",
  reviewerAgent: "Rawls",
  reviewerAgentId: reviewerId,
  publisherAgent: "cato-npm-release-rule-0809",
};

function signedComment(
  privateKey = oldKey.privateKey,
  overrides: Record<string, unknown> = {},
) {
  const payload = { ...buildReleaseReviewPayload(expectation), ...overrides };
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return {
    id: expectation.commentId,
    commit_id: expectation.commit,
    created_at: "2026-08-09T12:00:00Z",
    updated_at: "2026-08-09T12:00:00Z",
    body: JSON.stringify({
      schema: RELEASE_REVIEW_RECEIPT_SCHEMA,
      payload: payloadBytes.toString("base64"),
      signature: {
        algorithm: "ed25519",
        value: sign(null, payloadBytes, privateKey).toString("base64"),
      },
    }),
  };
}

test("preserves the finite generation-one Rawls bootstrap and rejects a generic later bootstrap", () => {
  const trust = verifyReleaseReviewTrustChain(
    pinnedBootstrapBytes,
    RELEASE_REVIEW_BOOTSTRAP_VERSION,
  );
  expect(trust.reviewer).toEqual({
    type: "coding-agent",
    agent: "Rawls",
    id: reviewerId,
  });
  expect(trust.publicKey.value).toBe(RELEASE_REVIEW_BOOTSTRAP_PUBLIC_KEY);
  expect(() => verifyReleaseReviewTrustChain(pinnedBootstrapBytes, "0.2.43"))
    .toThrow("generation 1 bootstrap");
});

test("repository trust document rotates to generation two Fable reviewer under the published 0.2.42 trust root", () => {
  const candidateTrustBytes = readFileSync(
    new URL("../config/release-review-trust.json", import.meta.url),
  );
  const trust = verifyReleaseReviewTrustChain(candidateTrustBytes, "0.2.43", {
    version: RELEASE_REVIEW_BOOTSTRAP_VERSION,
    trustBytes: pinnedBootstrapBytes,
  });
  expect(trust.generation).toBe(2);
  expect(trust.reviewer).toEqual({
    type: "coding-agent",
    agent: generationTwoReviewerAgent,
    id: generationTwoReviewerId,
  });
  expect(trust.publicKey).toEqual({
    algorithm: "ed25519",
    encoding: "base64-spki-der",
    value: generationTwoPublicKey,
    sha256: generationTwoPublicKeySha256,
  });
  expect(trust.signer.secretRef).toBe(generationTwoSigningSecretRef);
  const payload = JSON.parse(
    Buffer.from(trust.rotation?.payload ?? "", "base64").toString("utf8"),
  );
  expect(payload.previousRelease).toEqual({
    package: "@hasna/accounts",
    version: RELEASE_REVIEW_BOOTSTRAP_VERSION,
    registry: "https://registry.npmjs.org",
    trustSha256: createHash("sha256").update(pinnedBootstrapBytes).digest("hex"),
  });
  expect(payload.nextTrust).toEqual({
    schema: "hasna.release-review-trust/v1",
    generation: 2,
    repository: "hasna/accounts",
    reviewer: trust.reviewer,
    publicKey: trust.publicKey,
    signer: trust.signer,
  });
});

test("publishes the trust document and exposes the finite reviewer signer command", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  expect(manifest.files).toContain(RELEASE_REVIEW_TRUST_PATH);
  expect(manifest.scripts["release-review:sign"])
    .toBe("bun run scripts/release-review-sign.ts");
});

test("accepts old-key-authorized rotation anchored to immutable prior-release bytes", () => {
  const trust = verifyReleaseReviewTrustChain(rotatedTrustBytes(), "0.2.43", {
    version: RELEASE_REVIEW_BOOTSTRAP_VERSION,
    trustBytes: bootstrapBytes,
  });
  expect(trust.generation).toBe(2);
  expect(trust.publicKey.value).toBe(publicKeyValue(nextKey.publicKey));
});

test("repo-owned signer writes generation-two rotation using only the prior trust key", () => {
  const root = mkdtempSync(join(tmpdir(), "accounts-release-trust-"));
  try {
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, RELEASE_REVIEW_TRUST_PATH), bootstrapBytes);
    const trust = rotateReleaseReviewTrustDocument({
      root,
      signingSecret: oldKey.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      previousVersion: RELEASE_REVIEW_BOOTSTRAP_VERSION,
      previousTrustBytes: bootstrapBytes,
      reviewerAgent: generationTwoReviewerAgent,
      reviewerId: generationTwoReviewerId,
      signerSecretRef: generationTwoSigningSecretRef,
      publicKey: generationTwoPublicKey,
      publicKeyEncoding: "base64-spki-der",
    });
    const written = readFileSync(join(root, RELEASE_REVIEW_TRUST_PATH));
    expect(trust.generation).toBe(2);
    expect(trust.reviewer.agent).toBe(generationTwoReviewerAgent);
    expect(trust.signer.secretRef).toBe(generationTwoSigningSecretRef);
    expect(() => verifyReleaseReviewTrustChain(written, "0.2.43", {
      version: RELEASE_REVIEW_BOOTSTRAP_VERSION,
      trustBytes: bootstrapBytes,
    })).not.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects substituted prior roots and unauthorized rotation", () => {
  const substitutedPrior = trustBytes({
    ...trustCore(1, attackerKey.publicKey),
    rotation: null,
  });
  expect(() => verifyReleaseReviewTrustChain(rotatedTrustBytes(), "0.2.43", {
    version: RELEASE_REVIEW_BOOTSTRAP_VERSION,
    trustBytes: substitutedPrior,
  })).toThrow("prior release trust");
  expect(() => verifyReleaseReviewTrustChain(
    rotatedTrustBytes(nextKey.privateKey),
    "0.2.43",
    { version: RELEASE_REVIEW_BOOTSTRAP_VERSION, trustBytes: bootstrapBytes },
  )).toThrow("prior trust root");
  const unsigned = JSON.parse(rotatedTrustBytes().toString("utf8"));
  unsigned.rotation = null;
  expect(() => verifyReleaseReviewTrustChain(
    trustBytes(unsigned),
    "0.2.43",
    { version: RELEASE_REVIEW_BOOTSTRAP_VERSION, trustBytes: bootstrapBytes },
  )).toThrow("rotation authorization");
});

test("ignores mutable reviewer environment substitution and uses pinned trust", () => {
  const trust = parseReleaseReviewTrust(bootstrapBytes);
  const substitutedEnvironment = {
    RELEASE_REVIEWER_AGENT: "publisher-controlled",
    RELEASE_REVIEW_PUBLIC_KEY: publicKeyValue(attackerKey.publicKey),
  };
  expect(substitutedEnvironment.RELEASE_REVIEWER_AGENT).not.toBe(trust.reviewer.agent);
  expect(() => verifyReleaseReviewReceipt(
    signedComment(attackerKey.privateKey, {
      reviewer: {
        type: "coding-agent",
        agent: substitutedEnvironment.RELEASE_REVIEWER_AGENT,
        id: reviewerId,
      },
    }),
    expectation,
    trust,
  )).toThrow("signature is invalid");
  expect(() => verifyReleaseReviewReceipt(signedComment(), expectation, trust)).not.toThrow();
});

test("reviewer signer requires the named credential and posts one exact unedited comment", async () => {
  const trust = parseReleaseReviewTrust(bootstrapBytes);
  const privateKey = oldKey.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  let postedBody = "";
  const postComment = async (repository: string, commit: string, body: string) => {
    expect(repository).toBe(expectation.repository);
    expect(commit).toBe(expectation.commit);
    postedBody = body;
    return {
      id: expectation.commentId,
      commit_id: expectation.commit,
      created_at: "2026-08-09T12:00:00Z",
      updated_at: "2026-08-09T12:00:00Z",
      body,
    };
  };
  await expect(postReleaseReviewReceipt({
    expectation,
    trust,
    env: {},
    postComment,
  })).rejects.toThrow("RELEASE_REVIEW_SIGNING_PRIVATE_KEY");
  await expect(postReleaseReviewReceipt({
    expectation: { ...expectation, publisherAgent: "Rawls" },
    trust,
    env: { RELEASE_REVIEW_SIGNING_PRIVATE_KEY: privateKey },
    postComment,
  })).rejects.toThrow("independent");
  const commentId = await postReleaseReviewReceipt({
    expectation,
    trust,
    env: { RELEASE_REVIEW_SIGNING_PRIVATE_KEY: privateKey },
    postComment,
  });
  expect(commentId).toBe(expectation.commentId);
  const receipt = JSON.parse(postedBody);
  const payload = JSON.parse(Buffer.from(receipt.payload, "base64").toString("utf8"));
  expect(receipt.schema).toBe(RELEASE_REVIEW_RECEIPT_SCHEMA);
  expect(payload.schema).toBe(RELEASE_REVIEW_PAYLOAD_SCHEMA);
  expect(payload).toEqual(buildReleaseReviewPayload(expectation));
  expect(payload.trust).toEqual({
    path: RELEASE_REVIEW_TRUST_PATH,
    revision: expectation.trustRevision,
  });
});

test("reviewer signing key is removed from every subprocess environment", () => {
  const child = reviewSignerChildEnvironment({
    PATH: "/usr/bin",
    RELEASE_REVIEW_SIGNING_PRIVATE_KEY: "fixture-never-print",
  });
  expect(child.PATH).toBe("/usr/bin");
  expect(child.RELEASE_REVIEW_SIGNING_PRIVATE_KEY).toBeUndefined();
  const signerSource = readFileSync(
    new URL("./release-review-sign.ts", import.meta.url),
    "utf8",
  );
  const mainSource = signerSource.slice(signerSource.indexOf("async function main()"));
  expect(mainSource.indexOf("delete process.env[PRIVATE_KEY_ENV]")).toBeGreaterThan(-1);
  expect(mainSource.indexOf("delete process.env[PRIVATE_KEY_ENV]"))
    .toBeLessThan(mainSource.indexOf('command(root, "git"'));
});

test("reviewer signer rejects a wrong key and edited or mismatched comment response", async () => {
  const trust = parseReleaseReviewTrust(bootstrapBytes);
  const wrongPrivateKey = attackerKey.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  await expect(postReleaseReviewReceipt({
    expectation,
    trust,
    env: { RELEASE_REVIEW_SIGNING_PRIVATE_KEY: wrongPrivateKey },
    postComment: async () => signedComment(),
  })).rejects.toThrow("does not match the pinned public key");

  const privateKey = oldKey.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  await expect(postReleaseReviewReceipt({
    expectation,
    trust,
    env: { RELEASE_REVIEW_SIGNING_PRIVATE_KEY: privateKey },
    postComment: async (_repository, _commit, body) => ({
      id: expectation.commentId,
      commit_id: expectation.commit,
      created_at: "2026-08-09T12:00:00Z",
      updated_at: "2026-08-09T12:01:00Z",
      body,
    }),
  })).rejects.toThrow("must not be edited");
  await expect(postReleaseReviewReceipt({
    expectation,
    trust,
    env: { RELEASE_REVIEW_SIGNING_PRIVATE_KEY: privateKey },
    postComment: async (_repository, _commit, body) => ({
      id: expectation.commentId,
      commit_id: "fedcba9876543210fedcba9876543210fedcba98",
      created_at: "2026-08-09T12:00:00Z",
      updated_at: "2026-08-09T12:00:00Z",
      body,
    }),
  })).rejects.toThrow("commit disagrees with the tagged candidate");
});
