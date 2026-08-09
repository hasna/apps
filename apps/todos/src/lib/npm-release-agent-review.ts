import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify as verifySignature,
} from "node:crypto";

export const NPM_RELEASE_AGENT_REVIEW_SCHEMA = "hasna.npm-release-agent-review.v1" as const;

export type NpmReleaseAgentReviewPayload = {
  schema: typeof NPM_RELEASE_AGENT_REVIEW_SCHEMA;
  repository: string;
  commit: string;
  package: {
    name: string;
    version: string;
  };
  tag: string;
  workflow: {
    path: string;
    revision: string;
  };
  registry: string;
  reviewer: {
    type: "coding-agent";
    agent: string;
  };
  publisher: {
    type: "coding-agent";
    agent: string;
  };
  verdict: "GO" | "NO_GO";
  openReachableInScopeBlockers: {
    p0: number;
    p1: number;
  };
};

export type SignedNpmReleaseAgentReviewReceipt = {
  schema: typeof NPM_RELEASE_AGENT_REVIEW_SCHEMA;
  payload: string;
  signature: {
    algorithm: "ed25519";
    key_id: string;
    value: string;
  };
};

export type ExpectedNpmReleaseAgentReview = {
  repository: string;
  releaseCommit: string;
  packageName: string;
  packageVersion: string;
  tag: string;
  workflowPath: string;
  workflowRevision: string;
  registry: string;
  reviewerAgentId: string;
  reviewerKeyId: string;
  reviewerPublicKey: string;
  publisherAgentId: string;
};

export type NpmReleaseAgentReviewFailure = {
  check: string;
  message: string;
};

export type NpmReleaseAgentReviewValidation = {
  receipt?: SignedNpmReleaseAgentReviewReceipt;
  payload?: NpmReleaseAgentReviewPayload;
  failures: NpmReleaseAgentReviewFailure[];
};

const RECEIPT_KEYS = ["schema", "payload", "signature"];
const PAYLOAD_KEYS = [
  "schema",
  "repository",
  "commit",
  "package",
  "tag",
  "workflow",
  "registry",
  "reviewer",
  "publisher",
  "verdict",
  "openReachableInScopeBlockers",
];

export function validateNpmReleaseAgentReviewReceipt(
  rawReceipt: string | undefined,
  expected: ExpectedNpmReleaseAgentReview,
): NpmReleaseAgentReviewValidation {
  if (!rawReceipt?.trim()) {
    return {
      failures: [{
        check: "release-agent-review-missing",
        message: "NPM_RELEASE_AGENT_REVIEW_RECEIPT must contain the signed independent agent review receipt",
      }],
    };
  }

  let receiptValue: unknown;
  try {
    receiptValue = JSON.parse(rawReceipt);
  } catch {
    return {
      failures: [{
        check: "release-agent-review-json",
        message: "the signed independent agent review receipt must be valid JSON",
      }],
    };
  }
  if (!hasReceiptShape(receiptValue)) {
    return {
      failures: [{
        check: "release-agent-review-shape",
        message: "the signed receipt must match the strict shared v1 wrapper with no unknown fields",
      }],
    };
  }
  const receipt = receiptValue as SignedNpmReleaseAgentReviewReceipt;
  const failures: NpmReleaseAgentReviewFailure[] = [];
  addIf(
    failures,
    receipt.schema !== NPM_RELEASE_AGENT_REVIEW_SCHEMA,
    "release-agent-review-schema",
    `receipt schema must be ${NPM_RELEASE_AGENT_REVIEW_SCHEMA}`,
  );
  addIf(
    failures,
    receipt.signature.algorithm !== "ed25519",
    "release-agent-review-signature-algorithm",
    "receipt signature algorithm must be ed25519",
  );

  const payloadBytes = decodeCanonicalBase64(receipt.payload);
  if (!payloadBytes) {
    failures.push({
      check: "release-agent-review-payload-encoding",
      message: "receipt payload must be canonical base64",
    });
    return { receipt, failures };
  }
  const signatureBytes = decodeCanonicalBase64(receipt.signature.value);
  if (!signatureBytes) {
    failures.push({
      check: "release-agent-review-signature-encoding",
      message: "receipt signature must be canonical base64",
    });
    return { receipt, failures };
  }
  const publicKeyBytes = decodeCanonicalBase64(expected.reviewerPublicKey);
  if (!publicKeyBytes) {
    failures.push({
      check: "release-agent-review-public-key",
      message: "RELEASE_REVIEW_PUBLIC_KEY must be a canonical base64 SPKI DER Ed25519 public key",
    });
    return { receipt, failures };
  }

  const derivedKeyId = deriveKeyId(publicKeyBytes);
  addIf(
    failures,
    expected.reviewerKeyId !== derivedKeyId,
    "release-agent-review-key-id-config",
    "RELEASE_REVIEW_KEY_ID must equal the deterministic id derived from RELEASE_REVIEW_PUBLIC_KEY",
  );
  addIf(
    failures,
    receipt.signature.key_id !== expected.reviewerKeyId,
    "release-agent-review-key-id",
    "receipt signature key_id must equal RELEASE_REVIEW_KEY_ID",
  );

  try {
    const publicKey = createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" });
    addIf(
      failures,
      publicKey.asymmetricKeyType !== "ed25519" || !verifySignature(null, payloadBytes, publicKey, signatureBytes),
      "release-agent-review-signature",
      "receipt signature is not valid under the fixed independent reviewer key",
    );
  } catch {
    failures.push({
      check: "release-agent-review-public-key",
      message: "RELEASE_REVIEW_PUBLIC_KEY is not a valid SPKI DER Ed25519 public key",
    });
  }
  if (failures.some((failure) => failure.check === "release-agent-review-signature" || failure.check === "release-agent-review-public-key")) {
    return { receipt, failures };
  }

  let payloadValue: unknown;
  try {
    payloadValue = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    failures.push({
      check: "release-agent-review-payload-json",
      message: "the signed payload must decode to valid UTF-8 JSON",
    });
    return { receipt, failures };
  }
  if (!hasPayloadShape(payloadValue)) {
    failures.push({
      check: "release-agent-review-payload-shape",
      message: "the signed payload must match the strict shared v1 schema with no unknown fields",
    });
    return { receipt, failures };
  }

  const payload = payloadValue as NpmReleaseAgentReviewPayload;
  addIf(
    failures,
    payload.schema !== NPM_RELEASE_AGENT_REVIEW_SCHEMA,
    "release-agent-review-payload-schema",
    `payload schema must be ${NPM_RELEASE_AGENT_REVIEW_SCHEMA}`,
  );
  addIf(failures, payload.verdict !== "GO", "release-agent-review-verdict", "the signed independent agent verdict must be GO");
  addIf(
    failures,
    payload.openReachableInScopeBlockers.p0 !== 0 || payload.openReachableInScopeBlockers.p1 !== 0,
    "release-agent-review-blockers",
    "a GO receipt must contain zero open concrete reachable in-scope P0/P1 blockers",
  );
  addIf(
    failures,
    payload.reviewer.type !== "coding-agent" || payload.publisher.type !== "coding-agent",
    "release-agent-review-agent-types",
    "reviewer and publisher must both be coding agents rather than human approvers",
  );
  addIf(
    failures,
    payload.reviewer.agent.trim().toLowerCase() === payload.publisher.agent.trim().toLowerCase(),
    "release-agent-review-independence",
    "the fixed reviewer agent must differ from the publisher agent",
  );
  addIf(
    failures,
    payload.reviewer.agent !== expected.reviewerAgentId,
    "release-agent-review-reviewer",
    "reviewer.agent must equal RELEASE_REVIEWER_AGENT",
  );
  addIf(
    failures,
    payload.repository !== expected.repository,
    "release-agent-review-repository",
    `repository must be ${expected.repository}`,
  );
  addIf(
    failures,
    payload.commit !== expected.releaseCommit,
    "release-agent-review-commit",
    "commit must equal the exact release commit",
  );
  addIf(
    failures,
    payload.package.name !== expected.packageName,
    "release-agent-review-package",
    `package.name must be ${expected.packageName}`,
  );
  addIf(
    failures,
    payload.package.version !== expected.packageVersion,
    "release-agent-review-version",
    `package.version must be ${expected.packageVersion}`,
  );
  addIf(failures, payload.tag !== expected.tag, "release-agent-review-tag", `tag must be ${expected.tag}`);
  addIf(
    failures,
    payload.workflow.path !== expected.workflowPath,
    "release-agent-review-workflow-path",
    `workflow.path must be ${expected.workflowPath}`,
  );
  addIf(
    failures,
    payload.workflow.revision !== expected.workflowRevision,
    "release-agent-review-workflow-revision",
    "workflow.revision must equal the release commit workflow blob object",
  );
  addIf(
    failures,
    payload.registry !== expected.registry,
    "release-agent-review-registry",
    `registry must be ${expected.registry}`,
  );
  addIf(
    failures,
    payload.publisher.agent !== expected.publisherAgentId,
    "release-agent-review-publisher",
    "publisher.agent must equal the single Agent trailer on the annotated release tag",
  );

  return { receipt, payload, failures };
}

export function parsePublisherAgentTrailer(message: string): {
  agentId?: string;
  failures: NpmReleaseAgentReviewFailure[];
} {
  const nonEmptyLines = message.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim().length > 0);
  const trailers = nonEmptyLines
    .map((line, index) => ({ line, index, match: /^Agent: ([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(line) }))
    .filter((entry) => entry.match !== null);
  if (trailers.length !== 1 || trailers[0]?.index !== nonEmptyLines.length - 1) {
    return {
      failures: [{
        check: "release-agent-review-tag-publisher",
        message: "the annotated release tag message must end with exactly one Agent: <registered-agent> trailer",
      }],
    };
  }
  return { agentId: trailers[0].match![1], failures: [] };
}

export function deriveNpmReleaseAgentReviewKeyId(publicKeyBase64: string): string {
  const publicKeyBytes = decodeCanonicalBase64(publicKeyBase64);
  if (!publicKeyBytes) throw new Error("public key must be canonical base64");
  const publicKey = createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" });
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("public key must be Ed25519");
  return deriveKeyId(publicKeyBytes);
}

export function issueSignedNpmReleaseAgentReviewReceipt(
  payload: NpmReleaseAgentReviewPayload,
  privateKeyBase64: string,
  reviewerPublicKeyBase64: string,
  reviewerKeyId: string,
): SignedNpmReleaseAgentReviewReceipt {
  const privateKeyBytes = decodeCanonicalBase64(privateKeyBase64);
  if (!privateKeyBytes) throw new Error("private key must be canonical base64 PKCS8 DER");
  const privateKey = createPrivateKey({ key: privateKeyBytes, format: "der", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("private key must be Ed25519");
  const derivedPublicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
  if (derivedPublicKey !== reviewerPublicKeyBase64) throw new Error("private key does not match reviewer public key");
  if (deriveNpmReleaseAgentReviewKeyId(reviewerPublicKeyBase64) !== reviewerKeyId) {
    throw new Error("reviewer key id does not derive from reviewer public key");
  }
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

function hasReceiptShape(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, RECEIPT_KEYS)
    && isNonEmptyString(value.schema)
    && isNonEmptyString(value.payload)
    && isRecord(value.signature)
    && hasExactKeys(value.signature, ["algorithm", "key_id", "value"])
    && isNonEmptyString(value.signature.algorithm)
    && isNonEmptyString(value.signature.key_id)
    && isNonEmptyString(value.signature.value);
}

function hasPayloadShape(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) return false;
  if (!isRecord(value.package) || !hasExactKeys(value.package, ["name", "version"])) return false;
  if (!isRecord(value.workflow) || !hasExactKeys(value.workflow, ["path", "revision"])) return false;
  if (!isRecord(value.reviewer) || !hasExactKeys(value.reviewer, ["type", "agent"])) return false;
  if (!isRecord(value.publisher) || !hasExactKeys(value.publisher, ["type", "agent"])) return false;
  if (!isRecord(value.openReachableInScopeBlockers) || !hasExactKeys(value.openReachableInScopeBlockers, ["p0", "p1"])) return false;

  return [
    value.schema,
    value.repository,
    value.commit,
    value.package.name,
    value.package.version,
    value.tag,
    value.workflow.path,
    value.workflow.revision,
    value.registry,
    value.reviewer.type,
    value.reviewer.agent,
    value.publisher.type,
    value.publisher.agent,
    value.verdict,
  ].every(isNonEmptyString)
    && Number.isInteger(value.openReachableInScopeBlockers.p0)
    && Number.isInteger(value.openReachableInScopeBlockers.p1)
    && (value.openReachableInScopeBlockers.p0 as number) >= 0
    && (value.openReachableInScopeBlockers.p1 as number) >= 0;
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || value.length === 0) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

function deriveKeyId(publicKeyBytes: Buffer): string {
  return `ed25519:sha256:${createHash("sha256").update(publicKeyBytes).digest("base64url")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function addIf(
  failures: NpmReleaseAgentReviewFailure[],
  condition: boolean,
  check: string,
  message: string,
): void {
  if (condition) failures.push({ check, message });
}
