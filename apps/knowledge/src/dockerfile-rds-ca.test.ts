import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * Regression test for O15-00668 — the one-shot migrate task
 * (`bun scripts/apply-postgres-migrations.mjs`, run as `knowledge-prod-migrate`)
 * exited 1 against the shared RDS with `self signed certificate in certificate
 * chain`, blocking every knowledge deploy (oss-fleet-prod ECS).
 *
 * The knowledge image is the single artifact used by BOTH the serve task and
 * the migrate task (the migrate task overrides the CMD to
 * `bun scripts/apply-postgres-migrations.mjs`). The vendored storage kit
 * resolves the CA bundle from `sslrootcert` in the DSN, then `PGSSLROOTCERT`,
 * then `NODE_EXTRA_CA_CERTS` (src/generated/storage-kit/tls.ts) and verifies
 * the RDS server certificate under `sslmode=require`; when no CA bundle is in
 * the image, the handshake falls back to Node's default trust store — which
 * does not contain the Amazon RDS root, so it fails.
 *
 * This test pins the image contract: the RDS global CA bundle must be copied
 * into the image and the connection's CA path must point at it through the two
 * env vars the kit honors (PGSSLROOTCERT, then NODE_EXTRA_CA_CERTS). The bundle
 * checksum is pinned to the AWS-published global bundle (same artifact the
 * logs/emails/todos/files/loops/economy/conversations images ship), so a stale
 * or wrong bundle fails CI.
 */

const dockerfilePath = new URL("../Dockerfile", import.meta.url);
const dockerfile = readFileSync(dockerfilePath, "utf8");

const CA_TARGET = "/etc/ssl/certs/rds-global-bundle.pem";
const BUNDLE_RELATIVE = "docker/rds-global-bundle.pem";

/** sha256 of the AWS-published RDS global bundle (truststore.pki.rds.amazonaws.com/global/global-bundle.pem). */
const AWS_GLOBAL_BUNDLE_SHA256 =
  "e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3";

describe("knowledge image RDS CA contract (O15-00668)", () => {
  test("copies the RDS CA bundle into the image", () => {
    expect(dockerfile).toContain(
      `COPY ${BUNDLE_RELATIVE} ${CA_TARGET}`,
    );
  });

  test("wires the connection's CA path to the bundled CA", () => {
    // The vendored storage kit resolves the CA bundle from PGSSLROOTCERT first,
    // then NODE_EXTRA_CA_CERTS (src/generated/storage-kit/tls.ts). The migrate
    // runner (scripts/apply-postgres-migrations.mjs) builds its client through
    // the same kit, so the image ENV is what makes the RDS server certificate
    // verifiable.
    expect(dockerfile).toContain(`PGSSLROOTCERT=${CA_TARGET}`);
    expect(dockerfile).toContain(`NODE_EXTRA_CA_CERTS=${CA_TARGET}`);
  });

  test("ships the current AWS RDS global bundle artifact", () => {
    const bundlePath = new URL(`../${BUNDLE_RELATIVE}`, import.meta.url);
    expect(existsSync(bundlePath), `missing ${BUNDLE_RELATIVE} in the app build context`).toBe(true);
    const digest = createHash("sha256").update(readFileSync(bundlePath)).digest("hex");
    expect(digest).toBe(AWS_GLOBAL_BUNDLE_SHA256);
  });
});
