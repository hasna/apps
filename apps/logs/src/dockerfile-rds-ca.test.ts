import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * Regression test for O15-00661 — the one-shot migrate task (and serve) failed
 * against the shared RDS with `self signed certificate in certificate chain`.
 *
 * The logs image is the single artifact used by BOTH the serve task and the
 * migrate task (the migrate task overrides the CMD to `logs db migrate`). The
 * vendored storage kit verifies the server certificate under `sslmode=require`
 * and, when no CA bundle is available, falls back to Node's default trust
 * store — which does not contain the Amazon RDS root, so the handshake fails.
 *
 * This test pins the image contract: the RDS global CA bundle must be copied
 * into the image and the connection's CA path must point at it through the two
 * env vars the kit honors (PGSSLROOTCERT, then NODE_EXTRA_CA_CERTS). The bundle
 * checksum is pinned to the AWS-published global bundle (same artifact the
 * emails/todos/files/loops/economy/conversations images ship), so a stale or
 * wrong bundle fails CI.
 */

const dockerfilePath = new URL("../Dockerfile", import.meta.url);
const dockerfile = readFileSync(dockerfilePath, "utf8");

const CA_TARGET = "/etc/ssl/certs/rds-global-bundle.pem";
const BUNDLE_RELATIVE = "docker/rds-global-bundle.pem";

/** sha256 of the AWS-published RDS global bundle (truststore.pki.rds.amazonaws.com/global/global-bundle.pem). */
const AWS_GLOBAL_BUNDLE_SHA256 =
  "e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3";

describe("logs image RDS CA contract (O15-00661)", () => {
  test("copies the RDS CA bundle into the image", () => {
    expect(dockerfile).toContain(
      `COPY ${BUNDLE_RELATIVE} ${CA_TARGET}`,
    );
  });

  test("wires the connection's CA path to the bundled CA", () => {
    // The vendored storage kit resolves the CA bundle from PGSSLROOTCERT first,
    // then NODE_EXTRA_CA_CERTS (src/generated/storage-kit/tls.ts). The migrate
    // runner (src/db/pg-migrate.ts) builds its pool through the same kit, so
    // the image ENV is what makes the RDS server certificate verifiable.
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
