import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * Regression test for O15-00682 — the one-shot migrate task
 * (`hooks migrate`, run as the `hooks-prod-migrate` ECS task)
 * exited 1 against the shared RDS with `self signed certificate in certificate
 * chain`, blocking every hooks deploy (oss-fleet-prod ECS).
 *
 * The hooks image is the single artifact used by BOTH the serve task and the
 * migrate task (the migrate task overrides the CMD to `hooks migrate`). The
 * hooks PG adapter (src/db/remote-storage.ts, `PgAdapterAsync`) builds its
 * client with `ssl: { rejectUnauthorized: true }` and no explicit `ca`, so
 * verification resolves through Node's trust store; when no CA bundle is in
 * the image, the handshake falls back to the stock root store — which does
 * not contain the Amazon RDS root, so it fails.
 *
 * This test pins the image contract: the RDS global CA bundle must be copied
 * into the image and the connection's CA path must point at it through the two
 * env vars Node/libpq honor (NODE_EXTRA_CA_CERTS, then PGSSLROOTCERT). The
 * bundle checksum is pinned to the AWS-published global bundle (same artifact
 * the logs/emails/todos/files/loops/economy/conversations/knowledge/telephony
 * images ship), so a stale or wrong bundle fails CI.
 */

const dockerfilePath = new URL("../Dockerfile", import.meta.url);
const dockerfile = readFileSync(dockerfilePath, "utf8");

const CA_TARGET = "/etc/ssl/certs/rds-global-bundle.pem";
const BUNDLE_RELATIVE = "docker/rds-global-bundle.pem";

/** sha256 of the AWS-published RDS global bundle (truststore.pki.rds.amazonaws.com/global/global-bundle.pem). */
const AWS_GLOBAL_BUNDLE_SHA256 =
  "e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3";

describe("hooks image RDS CA contract (O15-00682)", () => {
  test("copies the RDS CA bundle into the image", () => {
    expect(dockerfile).toContain(
      `COPY ${BUNDLE_RELATIVE} ${CA_TARGET}`,
    );
  });

  test("wires the connection's CA path to the bundled CA", () => {
    // The hooks PG adapter verifies with rejectUnauthorized: true and no
    // explicit ca, so NODE_EXTRA_CA_CERTS is what makes the RDS server
    // certificate verifiable inside the bun runtime; PGSSLROOTCERT covers
    // libpq-style consumers. The migrate runner (`hooks migrate`) builds its
    // client through the same adapter, so the image ENV is what makes the
    // one-shot migration task succeed.
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
