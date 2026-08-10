#!/usr/bin/env bun

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  RELEASE_REVIEW_PAYLOAD_SCHEMA,
  RELEASE_REVIEW_RECEIPT_SCHEMA,
  RELEASE_REVIEW_TRUST_SCHEMA,
  RELEASE_REVIEW_TRUST_PATH,
  RELEASE_WORKFLOW,
  buildReleaseReviewPayload,
  buildReleaseReviewTrustRotationPayload,
  parseReleaseReviewTrust,
  releaseTag,
  repositorySlug,
  resolveReleaseReviewTrust,
  verifyReleaseReviewReceipt,
  verifyReleaseReviewTrustChain,
  type ReleaseReviewExpectation,
  type ReleaseReviewTrust,
} from "./release-provenance";

const PRIVATE_KEY_ENV = "RELEASE_REVIEW_SIGNING_PRIVATE_KEY";
const REGISTRY = "https://registry.npmjs.org";
const MAX_GH_OUTPUT_BYTES = 8 * 1024 * 1024;

type SignerExpectation = Omit<ReleaseReviewExpectation, "commentId">;
type TrustRotationOptions = {
  root: string;
  signingSecret: string;
  previousVersion: string;
  previousTrustBytes: Uint8Array;
  reviewerAgent: string;
  reviewerId: string;
  signerSecretRef: string;
  publicKey: string;
  publicKeyEncoding: string;
};
type PostComment = (
  repository: string,
  commit: string,
  body: string,
) => Promise<unknown>;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function exactCommit(value: string, label: string): string {
  check(value.match(/^[0-9a-f]{40}$/), `${label} must be an exact 40-character lowercase git SHA`);
  return value;
}

function semver(value: string, label: string): string {
  check(value.match(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/), `${label} must be an exact SemVer`);
  return value;
}

export function reviewSignerChildEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...source, NO_UPDATE_NOTIFIER: "1" };
  delete childEnv[PRIVATE_KEY_ENV];
  return childEnv;
}

function command(root: string, executable: string, args: string[]): string {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_GH_OUTPUT_BYTES,
    env: reviewSignerChildEnvironment(process.env),
  });
  check(!result.error, `could not run ${executable}: ${result.error?.message}`);
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  check(
    result.status === 0,
    `${executable} ${args.join(" ")} failed with exit ${result.status}${detail ? `:\n${detail}` : ""}`,
  );
  return result.stdout ?? "";
}

function privateKey(value: string) {
  try {
    return createPrivateKey(value);
  } catch {
    try {
      return createPrivateKey({
        key: Buffer.from(value, "base64"),
        format: "der",
        type: "pkcs8",
      });
    } catch (error) {
      throw new Error(
        `${PRIVATE_KEY_ENV} is not a valid PKCS8 Ed25519 key: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function exactPublicKeyMatchesTrust(
  signingKey: ReturnType<typeof createPrivateKey>,
  trust: ReleaseReviewTrust,
): void {
  check(signingKey.asymmetricKeyType === "ed25519", `${PRIVATE_KEY_ENV} must be Ed25519`);
  const derived = createPublicKey(signingKey)
    .export({ format: "der", type: "spki" })
    .toString("base64");
  check(
    derived === trust.publicKey.value,
    `${PRIVATE_KEY_ENV} does not match the pinned public key in ${RELEASE_REVIEW_TRUST_PATH}`,
  );
}

function publicKeySha256(publicKey: string): string {
  return createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex");
}

function releaseReviewTrustDocument(trust: ReleaseReviewTrust): string {
  return `${JSON.stringify(trust, null, 2)}\n`;
}

export function rotateReleaseReviewTrustDocument(options: TrustRotationOptions): ReleaseReviewTrust {
  check(
    options.publicKeyEncoding === "base64-spki-der",
    "rotation public key encoding must be base64-spki-der",
  );
  const previousTrustBytes = Buffer.from(options.previousTrustBytes);
  const previousTrust = parseReleaseReviewTrust(previousTrustBytes);
  const currentTrustBytes = readFileSync(resolve(options.root, RELEASE_REVIEW_TRUST_PATH));
  check(
    currentTrustBytes.equals(previousTrustBytes),
    `${RELEASE_REVIEW_TRUST_PATH} must match the previous published trust bytes before rotation`,
  );
  const signingKey = privateKey(options.signingSecret);
  exactPublicKeyMatchesTrust(signingKey, previousTrust);
  const nextTrustCore = {
    schema: RELEASE_REVIEW_TRUST_SCHEMA,
    generation: previousTrust.generation + 1,
    repository: previousTrust.repository,
    reviewer: {
      type: "coding-agent" as const,
      agent: options.reviewerAgent,
      id: options.reviewerId,
    },
    publicKey: {
      algorithm: "ed25519" as const,
      encoding: "base64-spki-der" as const,
      value: options.publicKey,
      sha256: publicKeySha256(options.publicKey),
    },
    signer: {
      secretRef: options.signerSecretRef,
    },
  };
  const payload = buildReleaseReviewTrustRotationPayload(nextTrustCore, {
    package: "@hasna/accounts",
    version: options.previousVersion,
    registry: REGISTRY,
    trustSha256: createHash("sha256").update(previousTrustBytes).digest("hex"),
  });
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const nextTrust = parseReleaseReviewTrust({
    ...nextTrustCore,
    rotation: {
      payload: payloadBytes.toString("base64"),
      signature: {
        algorithm: "ed25519",
        value: sign(null, payloadBytes, signingKey).toString("base64"),
      },
    },
  });
  const nextTrustBytes = Buffer.from(releaseReviewTrustDocument(nextTrust));
  const verifiedTrust = verifyReleaseReviewTrustChain(
    nextTrustBytes,
    options.previousVersion,
    { version: options.previousVersion, trustBytes: previousTrustBytes },
  );
  writeFileSync(resolve(options.root, RELEASE_REVIEW_TRUST_PATH), nextTrustBytes);
  return verifiedTrust;
}

async function defaultPostComment(
  repository: string,
  commit: string,
  body: string,
): Promise<unknown> {
  const result = spawnSync("gh", [
    "api",
    "--method", "POST",
    `repos/${repository}/commits/${commit}/comments`,
    "--input", "-",
  ], {
    encoding: "utf8",
    input: JSON.stringify({ body }),
    maxBuffer: MAX_GH_OUTPUT_BYTES,
    env: reviewSignerChildEnvironment(process.env),
  });
  check(!result.error, `could not run gh: ${result.error?.message}`);
  const detail = result.stderr?.trim();
  check(
    result.status === 0,
    `gh commit-comment POST failed with exit ${result.status}${detail ? `: ${detail}` : ""}`,
  );
  try {
    return JSON.parse(result.stdout ?? "") as unknown;
  } catch (error) {
    throw new Error(
      `gh commit-comment response is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function postReleaseReviewReceipt(options: {
  expectation: SignerExpectation;
  trust: ReleaseReviewTrust;
  env: NodeJS.ProcessEnv;
  postComment?: PostComment;
}): Promise<number> {
  const secret = options.env[PRIVATE_KEY_ENV];
  check(
    typeof secret === "string" && secret.length > 0,
    `${PRIVATE_KEY_ENV} is missing; invoke this reviewer-only path through secrets exec`,
  );
  check(
    options.expectation.reviewerAgent === options.trust.reviewer.agent &&
      options.expectation.reviewerAgentId === options.trust.reviewer.id,
    "release review expectation disagrees with candidate-pinned reviewer identity",
  );
  check(
    options.expectation.publisherAgent !== options.trust.reviewer.agent,
    "release review must be independent from the publishing agent",
  );
  const signingKey = privateKey(secret);
  exactPublicKeyMatchesTrust(signingKey, options.trust);
  const payload = buildReleaseReviewPayload({
    ...options.expectation,
    commentId: 0,
  });
  check(payload.schema === RELEASE_REVIEW_PAYLOAD_SCHEMA, "release review payload schema disagrees");
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const body = JSON.stringify({
    schema: RELEASE_REVIEW_RECEIPT_SCHEMA,
    payload: payloadBytes.toString("base64"),
    signature: {
      algorithm: "ed25519",
      value: sign(null, payloadBytes, signingKey).toString("base64"),
    },
  });
  const response = await (options.postComment ?? defaultPostComment)(
    options.expectation.repository,
    options.expectation.commit,
    body,
  );
  check(response && typeof response === "object" && !Array.isArray(response), "GitHub comment response must be an object");
  const comment = response as Record<string, unknown>;
  check(Number.isSafeInteger(comment.id) && (comment.id as number) > 0, "GitHub comment id must be positive");
  check(comment.body === body, "GitHub commit comment body disagrees with the exact signed receipt");
  const commentId = comment.id as number;
  verifyReleaseReviewReceipt(
    comment,
    { ...options.expectation, commentId },
    options.trust,
  );
  return commentId;
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  check(value && !value.startsWith("--"), `missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const args = process.argv.slice(2);
  const signingSecret = process.env[PRIVATE_KEY_ENV];
  delete process.env[PRIVATE_KEY_ENV];
  check(
    typeof signingSecret === "string" && signingSecret.length > 0,
    `${PRIVATE_KEY_ENV} is missing; invoke this reviewer-only path through secrets exec`,
  );
  if (args.includes("--rotate-trust")) {
    const previousTrustRef = exactCommit(option(args, "--previous-trust-ref"), "previous trust ref");
    const previousVersion = semver(option(args, "--previous-version"), "previous release version");
    const previousTrustBytes = Buffer.from(
      command(root, "git", ["show", `${previousTrustRef}:${RELEASE_REVIEW_TRUST_PATH}`]),
    );
    const trust = rotateReleaseReviewTrustDocument({
      root,
      signingSecret,
      previousVersion,
      previousTrustBytes,
      reviewerAgent: option(args, "--reviewer-agent"),
      reviewerId: option(args, "--reviewer-id"),
      signerSecretRef: option(args, "--signer-secret-ref"),
      publicKey: option(args, "--public-key"),
      publicKeyEncoding: option(args, "--public-key-encoding"),
    });
    console.log(`rotated ${RELEASE_REVIEW_TRUST_PATH} to generation ${trust.generation}`);
    return;
  }
  const commit = exactCommit(option(args, "--commit"), "review commit");
  const publisherAgent = option(args, "--publisher-agent");
  check(
    command(root, "git", ["rev-parse", "HEAD"]).trim() === commit,
    "review signer checkout HEAD must equal --commit",
  );
  check(
    command(root, "git", ["status", "--porcelain", "--untracked-files=all"]).trim() === "",
    "review signer checkout must be clean",
  );
  const manifest = JSON.parse(
    command(root, "git", ["show", `${commit}:package.json`]),
  ) as {
    name: string;
    version: string;
    repository: string | { url: string };
    publishConfig?: { registry?: string; access?: string };
  };
  check(manifest.name === "@hasna/accounts", "review signer package must be @hasna/accounts");
  check(manifest.publishConfig?.registry === REGISTRY, "review signer registry disagrees");
  const resolvedTrust = await resolveReleaseReviewTrust(root, manifest, commit);
  const workflowRevision = exactCommit(
    command(root, "git", ["rev-parse", `${commit}:${RELEASE_WORKFLOW}`]).trim(),
    "release workflow revision",
  );
  const commentId = await postReleaseReviewReceipt({
    expectation: {
      repository: repositorySlug(manifest),
      commit,
      packageName: manifest.name,
      version: manifest.version,
      tag: releaseTag(manifest),
      workflow: RELEASE_WORKFLOW,
      workflowRevision,
      trustPath: RELEASE_REVIEW_TRUST_PATH,
      trustRevision: resolvedTrust.trustRevision,
      registry: REGISTRY,
      reviewerAgent: resolvedTrust.trust.reviewer.agent,
      reviewerAgentId: resolvedTrust.trust.reviewer.id,
      publisherAgent,
    },
    trust: resolvedTrust.trust,
    env: { [PRIVATE_KEY_ENV]: signingSecret },
  });
  console.log(commentId);
}

if (import.meta.main) {
  main().catch((error) => {
    delete process.env[PRIVATE_KEY_ENV];
    console.error(`release review signer failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
