import { describe, expect, test } from "bun:test";
import {
  FILES_DEPLOY_IMAGE_DIGEST_ENV,
  FILES_DEPLOY_SOURCE_COMMIT_ENV,
  resolveDeploymentIdentity,
} from "./deployment-identity.js";

const source = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;

describe("Files readiness deployment identity", () => {
  test("accepts only canonical immutable production identity", () => {
    expect(resolveDeploymentIdentity(true, {
      [FILES_DEPLOY_SOURCE_COMMIT_ENV]: source,
      [FILES_DEPLOY_IMAGE_DIGEST_ENV]: digest,
    })).toEqual({
      ok: true,
      identity: { deployment_environment: "production", source_commit: source, image_digest: digest },
    });
  });

  test("fails closed when production identity is absent or malformed", () => {
    expect(resolveDeploymentIdentity(true, {})).toEqual({ ok: false, identity: null, reason: "missing" });
    expect(resolveDeploymentIdentity(true, {
      [FILES_DEPLOY_SOURCE_COMMIT_ENV]: "main",
      [FILES_DEPLOY_IMAGE_DIGEST_ENV]: digest,
    })).toEqual({ ok: false, identity: null, reason: "invalid" });
    expect(resolveDeploymentIdentity(true, {
      [FILES_DEPLOY_SOURCE_COMMIT_ENV]: source,
      [FILES_DEPLOY_IMAGE_DIGEST_ENV]: "open-files:latest",
    })).toEqual({ ok: false, identity: null, reason: "invalid" });
  });

  test("labels local development explicitly and cannot resemble production", () => {
    expect(resolveDeploymentIdentity(false, {
      [FILES_DEPLOY_SOURCE_COMMIT_ENV]: source,
      [FILES_DEPLOY_IMAGE_DIGEST_ENV]: digest,
    })).toEqual({
      ok: false,
      reason: "non_production",
      identity: { deployment_environment: "non_production", source_commit: null, image_digest: null },
    });
  });
});
