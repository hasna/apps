import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  executeDeploymentEvidenceExpression,
  executeDomainIntegrityComparison,
  executeDomainArchiveValidation,
  executeObjectLockExpression,
  executeStableDomainIntegrityComparison,
  executeWormObjectHeadExpression,
  selfTestInstructionsDeploy,
  validateInstructionsDeploy,
} from "../../check-instructions-deploy";

const root = join(import.meta.dir, "../../../..");
const workflow = readFileSync(
  join(root, ".github/workflows/deploy-instructions.yml"),
  "utf8",
);

const counts = {
  configs: 260,
  config_snapshots: 510,
  profiles: 8,
  profile_config_bindings: 23,
  profile_asset_bindings: 4,
  machines: 3,
};

const hashes = {
  configs: "a".repeat(64),
  config_snapshots: "b".repeat(64),
  profiles: "c".repeat(64),
  profile_config_bindings: "d".repeat(64),
  profile_asset_bindings: "e".repeat(64),
  machines: "f".repeat(64),
};

const manifest = {
  schema: "hasna.instructions.domain-archive/v2",
  version: "2.0.0",
  payload: {
    path: "domain.json",
    sha256: "1".repeat(64),
    size_bytes: 4096,
  },
  integrity: {
    algorithm: "sha256",
    canonicalization: "hasna.instructions.logical-json/v1",
    counts,
    hashes,
    domain_sha256: "9".repeat(64),
  },
};

describe("standard-adherence: protected Instructions deployment lane", () => {
  test("the checked-in workflow satisfies the strict deployment contract", () => {
    expect(validateInstructionsDeploy(workflow, "ci", "1.3.14")).toEqual([]);
  });

  test("the checker proves a positive control and rejects its negative controls", () => {
    expect(selfTestInstructionsDeploy(root)).toEqual([]);
  });

  test("captures two consecutive identical valid archives before migration and pushes only the stable archive", () => {
    const baseline = workflow.indexOf("Export and validate complete pre-migration domain archive");
    const backup = workflow.indexOf("Create immutable pre-deploy S3 backup");
    const migration = workflow.indexOf("Run one-shot migration task on the digest");
    const preMigration = workflow.slice(baseline, migration);

    expect(baseline).toBeGreaterThan(-1);
    expect(baseline).toBeLessThan(backup);
    expect(backup).toBeLessThan(migration);
    expect(preMigration.match(/dist\/cli\/index\.js export/g)).toHaveLength(1);
    expect(preMigration).toContain('max_capture_attempts=5');
    expect(preMigration).toContain('for capture_attempt in $(seq 1 "${max_capture_attempts}")');
    expect(preMigration).toContain('instructions-domain-candidate-${capture_attempt}.tar.gz');
    expect(preMigration).toContain('candidate-domain-manifest-${capture_attempt}.json');
    expect(preMigration).toContain('.integrity == $previous[0].integrity');
    expect(preMigration).toContain('stable_archive=true');
    expect(preMigration).toContain('failed to capture two consecutive identical valid archives');
    expect(preMigration).toContain("instructions-domain-pre.tar.gz");
    expect(preMigration).toContain("pre-domain-manifest.json");
    expect(preMigration).toContain("chmod 600");
    expect(preMigration).toContain("storage backup push /backup/instructions-domain-pre.tar.gz");
    expect(preMigration).toContain('archive_sha256="$(sha256sum "${PRE_DEPLOY_ARCHIVE}"');
    expect(preMigration).toContain('.sha256 == $sha256 and .sizeBytes == $size_bytes');
    expect(preMigration).not.toContain("capture_identity_collection");
    expect(preMigration).not.toContain("view=identity");
  });

  test("executes the checked-in consecutive archive integrity comparison", () => {
    expect(executeStableDomainIntegrityComparison(workflow, manifest, manifest)).toEqual({ ok: true });
    expect(executeStableDomainIntegrityComparison(workflow, manifest, {
      ...manifest,
      integrity: { ...manifest.integrity, domain_sha256: "8".repeat(64) },
    }).ok).toBe(false);
    expect(executeStableDomainIntegrityComparison(workflow, manifest, {
      ...manifest,
      payload: { ...manifest.payload, sha256: "2".repeat(64) },
    })).toEqual({ ok: true });
  });

  test("executes archive member and complete v2 manifest validation", () => {
    expect(executeDomainArchiveValidation(workflow, manifest)).toEqual({ ok: true });
    expect(executeDomainArchiveValidation(workflow, manifest, [], "post")).toEqual({ ok: true });

    for (const invalid of [
      { ...manifest, version: "1.0.0" },
      { ...manifest, integrity: { ...manifest.integrity, domain_sha256: null } },
      { ...manifest, integrity: { ...manifest.integrity, counts: { ...counts, machines: undefined } } },
      { ...manifest, integrity: { ...manifest.integrity, hashes: { ...hashes, profile_asset_bindings: "short" } } },
    ]) {
      expect(executeDomainArchiveValidation(workflow, invalid).ok).toBe(false);
    }
    expect(executeDomainArchiveValidation(workflow, manifest, ["unexpected.txt"]).ok).toBe(false);
  });

  test("requires exact post-rollout domain integrity equality", () => {
    const verification = workflow.slice(
      workflow.indexOf("Verify exact live task definition, digest, and health"),
      workflow.indexOf("Restore rollback anchor after a failed service rollout"),
    );
    expect(verification).toContain("instructions-domain-post.tar.gz");
    expect(verification).toContain("post-domain-manifest.json");
    expect(verification).toContain(".integrity == $pre[0].integrity");
    expect(verification).toContain("domain integrity changed during deployment");
    expect(verification).not.toContain("capture_identity_collection");
    expect(verification).not.toContain("view=identity");
    expect(executeDomainIntegrityComparison(workflow, manifest, manifest)).toEqual({ ok: true });
    expect(executeDomainIntegrityComparison(workflow, manifest, {
      ...manifest,
      integrity: { ...manifest.integrity, domain_sha256: "8".repeat(64) },
    }).ok).toBe(false);
    expect(executeDomainIntegrityComparison(workflow, manifest, {
      ...manifest,
      integrity: {
        ...manifest.integrity,
        counts: { ...counts, config_snapshots: counts.config_snapshots - 1 },
      },
    }).ok).toBe(false);
  });

  test("executes the COMPLIANCE Object Lock default-retention gate", () => {
    expect(executeObjectLockExpression(workflow, {
      ObjectLockConfiguration: {
        ObjectLockEnabled: "Enabled",
        Rule: { DefaultRetention: { Mode: "COMPLIANCE", Years: 2 } },
      },
    })).toEqual({ ok: true });

    for (const invalid of [
      { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "GOVERNANCE", Years: 2 } } },
      { ObjectLockEnabled: "Disabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 30 } } },
      { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE" } } },
      { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "INVALID", Days: 30 } } },
      { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 30, Years: 1 } } },
    ]) {
      expect(executeObjectLockExpression(workflow, {
        ObjectLockConfiguration: invalid,
      }).ok).toBe(false);
    }
  });

  test("executes per-object WORM verification for payload and manifest", () => {
    const futureEpoch = 1_800_000_000;
    const nowEpoch = 1_700_000_000;
    expect(executeWormObjectHeadExpression(workflow, {
      VersionId: "version-1",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: "2027-01-15T00:00:00+00:00",
    }, nowEpoch, futureEpoch)).toEqual({ ok: true });

    for (const invalid of [
      { response: { VersionId: null, ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: "2027-01-15T00:00:00+00:00" }, retainEpoch: futureEpoch },
      { response: { VersionId: "version-1", ObjectLockMode: "GOVERNANCE", ObjectLockRetainUntilDate: "2027-01-15T00:00:00+00:00" }, retainEpoch: futureEpoch },
      { response: { VersionId: "version-1", ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: null }, retainEpoch: futureEpoch },
      { response: { VersionId: "version-1", ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: "2023-01-15T00:00:00+00:00" }, retainEpoch: nowEpoch },
    ]) {
      expect(executeWormObjectHeadExpression(
        workflow,
        invalid.response,
        nowEpoch,
        invalid.retainEpoch,
      ).ok).toBe(false);
    }
    expect(workflow).toContain('verify_worm_object "payload" "${payload_key}" "${payload_version_id}"');
    expect(workflow).toContain('verify_worm_object "manifest" "${manifest_key}" "${manifest_version_id}"');
  });

  test("records and verifies exact immutable S3 versions and archive bytes", () => {
    const backup = workflow.slice(
      workflow.indexOf("Create immutable pre-deploy S3 backup"),
      workflow.indexOf("Verify immutable scan-on-push ECR repository"),
    );
    expect(backup).toContain("payloadVersionId");
    expect(backup).toContain("manifestVersionId");
    expect(backup).toContain("--payload-version-id");
    expect(backup).toContain("--manifest-version-id");
    expect(backup).toContain('--version-id "${object_version_id}"');
    expect(backup).toContain("aws s3api get-object");
    expect(backup).toContain('sha256sum "${versioned_payload}"');
    expect(backup).toContain('payload_version_id=%s');
    expect(backup).toContain('manifest_version_id=%s');
  });

  test("uses only the redacted receipt for WORM object keys without logging content", () => {
    expect(workflow).toContain("hasna.instructions.redacted-backup-receipt.v2");
    expect(workflow).toContain("payload_key=\"$(jq -er '.payloadKey' \"${backup_receipt}\")\"");
    expect(workflow).toContain("manifest_key=\"$(jq -er '.manifestKey' \"${backup_receipt}\")\"");
    expect(workflow).not.toMatch(/\bcat\s[^\n]*(domain|s3-backup|s3-verify|backup-receipt)/);
    expect(workflow).not.toMatch(/echo[^\n]*(domain\.json|client_key=)/);
  });

  test("rejects archive validation and integrity comparison removal", () => {
    const noArchiveGuard = workflow.replace(
      "archive contains unexpected members",
      "archive accepted without member validation",
    );
    expect(validateInstructionsDeploy(noArchiveGuard, "ci", "1.3.14")).toContain(
      "pre-migration archive control missing: archive contains unexpected members",
    );

    const noIntegrity = workflow.replace(
      ".integrity == $pre[0].integrity",
      ".integrity.domain_sha256 | length > 0",
    );
    expect(validateInstructionsDeploy(noIntegrity, "ci", "1.3.14")).toContain(
      "live verification missing: .integrity == $pre[0].integrity",
    );
  });

  test("executes deployment evidence with complete pre/post integrity and counts", () => {
    const evidence = executeDeploymentEvidenceExpression(workflow);
    expect(evidence.ok).toBe(true);
    expect(evidence.document?.backup).toMatchObject({
      payload_version_id: "fixture-payload-version-id",
      manifest_version_id: "fixture-manifest-version-id",
    });
    expect(evidence.document?.data_integrity).toEqual({
      policy: "exact_domain_integrity",
      pre: { counts, integrity: manifest.integrity },
      post: { counts, integrity: manifest.integrity },
    });
  });
});
