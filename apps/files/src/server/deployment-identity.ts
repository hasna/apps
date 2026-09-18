/**
 * Immutable identity supplied by the production deployment controller.
 *
 * The application never infers these values from a mutable image tag, package
 * version, task-family tip, or repository branch. Production readiness is
 * unavailable unless both exact values are present and canonical.
 */
export const FILES_DEPLOY_SOURCE_COMMIT_ENV = "HASNA_FILES_DEPLOY_SOURCE_COMMIT";
export const FILES_DEPLOY_IMAGE_DIGEST_ENV = "HASNA_FILES_DEPLOY_IMAGE_DIGEST";

const SOURCE_COMMIT = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface ProductionDeploymentIdentity {
  deployment_environment: "production";
  source_commit: string;
  image_digest: string;
}

export interface NonProductionDeploymentIdentity {
  deployment_environment: "non_production";
  source_commit: null;
  image_digest: null;
}

export type DeploymentIdentityResult =
  | { ok: true; identity: ProductionDeploymentIdentity }
  | { ok: false; identity: NonProductionDeploymentIdentity; reason: "non_production" }
  | { ok: false; identity: null; reason: "missing" | "invalid" };

export function resolveDeploymentIdentity(
  production: boolean,
  env: NodeJS.ProcessEnv = process.env,
): DeploymentIdentityResult {
  if (!production) {
    return {
      ok: false,
      reason: "non_production",
      identity: { deployment_environment: "non_production", source_commit: null, image_digest: null },
    };
  }

  const sourceCommit = env[FILES_DEPLOY_SOURCE_COMMIT_ENV];
  const imageDigest = env[FILES_DEPLOY_IMAGE_DIGEST_ENV];
  if (sourceCommit === undefined || sourceCommit === "" || imageDigest === undefined || imageDigest === "") {
    return { ok: false, identity: null, reason: "missing" };
  }
  if (!SOURCE_COMMIT.test(sourceCommit) || !IMAGE_DIGEST.test(imageDigest)) {
    return { ok: false, identity: null, reason: "invalid" };
  }
  return {
    ok: true,
    identity: { deployment_environment: "production", source_commit: sourceCommit, image_digest: imageDigest },
  };
}
