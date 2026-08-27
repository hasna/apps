import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * Regression test for O15-04014 — the deployed sessions container
 * (sessions-serve in oss-fleet-prod ECS) cannot reach the shared RDS:
 * the TLS handshake fails with `self signed certificate in certificate
 * chain`, so the server never comes up and /ready answers 503 at
 * sessions.hasna.xyz.
 *
 * The sessions cloud client (src/db/cloud/client.ts) builds its pool through
 * the vendored storage kit (src/generated/storage-kit), whose TLS module
 * resolves the CA bundle from PGSSLROOTCERT (priority 4) or
 * NODE_EXTRA_CA_CERTS (priority 5) and, under the deployed `sslmode=require`,
 * verifies with `rejectUnauthorized: true`. Amazon RDS roots are not in the
 * stock Node trust store, so without the bundle in the image the handshake
 * fails with SELF_SIGNED_CERT_IN_CHAIN and the container never serves.
 *
 * This test pins the image contract: the RDS global CA bundle must be copied
 * into the image and the connection's CA path must point at it through the
 * two env vars the storage kit honors. The bundle checksum is pinned to the
 * AWS-published global bundle (same artifact the
 * logs/emails/todos/files/loops/economy/conversations/knowledge/telephony/
 * hooks images ship), so a stale or wrong bundle fails CI.
 */

const dockerfilePath = new URL("../Dockerfile", import.meta.url);
const dockerfile = readFileSync(dockerfilePath, "utf8");

const CA_TARGET = "/etc/ssl/certs/rds-global-bundle.pem";
const BUNDLE_RELATIVE = "docker/rds-global-bundle.pem";

/** sha256 of the AWS-published RDS global bundle (truststore.pki.rds.amazonaws.com/global/global-bundle.pem). */
const AWS_GLOBAL_BUNDLE_SHA256 =
  "e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3";

describe("sessions image RDS CA contract (O15-04014)", () => {
  test("copies the RDS CA bundle into the image", () => {
    expect(dockerfile).toContain(
      `COPY ${BUNDLE_RELATIVE} ${CA_TARGET}`,
    );
  });

  test("wires the connection's CA path to the bundled CA", () => {
    // The storage kit resolves the CA from PGSSLROOTCERT, then
    // NODE_EXTRA_CA_CERTS (src/generated/storage-kit/tls.ts) and verifies
    // with rejectUnauthorized: true under sslmode=require, so the image ENV
    // is what makes the RDS server certificate verifiable inside the bun
    // runtime. NODE_EXTRA_CA_CERTS additionally covers non-kit consumers
    // (node:tls based health probes and one-off scripts).
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
