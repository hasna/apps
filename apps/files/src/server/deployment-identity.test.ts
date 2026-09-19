import { describe, expect, test } from "bun:test";
import {
  FILES_DEPLOY_ENVIRONMENT_ENV,
  FILES_DEPLOY_IMAGE_DIGEST_ENV,
  FILES_DEPLOY_SOURCE_COMMIT_ENV,
  productionDeploymentIntended,
  resolveDeploymentIdentity,
} from "./deployment-identity.js";

const source = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;

describe("Files readiness deployment identity", () => {
  test("accepts only canonical immutable production identity", () => {
    expect(resolveDeploymentIdentity(true, {
      [FILES_DEPLOY_ENVIRONMENT_ENV]: "production",
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
      [FILES_DEPLOY_IMAGE_DIGEST_ENV]: "mutable:latest",
    })).toEqual({ ok: false, identity: null, reason: "invalid" });
    for (const padded of [` ${source}`, `${source} `, `\t${source}`, `${source}\n`]) {
      expect(resolveDeploymentIdentity(true, {
        [FILES_DEPLOY_SOURCE_COMMIT_ENV]: padded,
        [FILES_DEPLOY_IMAGE_DIGEST_ENV]: digest,
      })).toEqual({ ok: false, identity: null, reason: "invalid" });
    }
    for (const padded of [` ${digest}`, `${digest} `, `\t${digest}`, `${digest}\n`]) {
      expect(resolveDeploymentIdentity(true, {
        [FILES_DEPLOY_SOURCE_COMMIT_ENV]: source,
        [FILES_DEPLOY_IMAGE_DIGEST_ENV]: padded,
      })).toEqual({ ok: false, identity: null, reason: "invalid" });
    }

    for (const invalidEnvironment of [" production", "production ", "staging", ""]) {
      expect(resolveDeploymentIdentity(true, {
        [FILES_DEPLOY_ENVIRONMENT_ENV]: invalidEnvironment,
        [FILES_DEPLOY_SOURCE_COMMIT_ENV]: source,
        [FILES_DEPLOY_IMAGE_DIGEST_ENV]: digest,
      })).toEqual({ ok: false, identity: null, reason: "invalid" });
    }
  });

  test("detects production intent without consulting storage configuration", () => {
    expect(productionDeploymentIntended({})).toBe(false);
    expect(productionDeploymentIntended({ [FILES_DEPLOY_ENVIRONMENT_ENV]: "production" })).toBe(true);
    expect(productionDeploymentIntended({ [FILES_DEPLOY_SOURCE_COMMIT_ENV]: source })).toBe(true);
    expect(productionDeploymentIntended({ [FILES_DEPLOY_IMAGE_DIGEST_ENV]: digest })).toBe(true);
    expect(productionDeploymentIntended({ [FILES_DEPLOY_ENVIRONMENT_ENV]: "" })).toBe(true);
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
