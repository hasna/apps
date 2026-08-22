/**
 * Regression (I38-00559): conversations 0.7.1 serve answered EVERY authenticated
 * /v1 request with 503 status_unavailable ("Could not verify API key status")
 * while /health and /version reported ok, breaking all fleet auth from 04:43Z
 * until the 04:47Z rollback to 0.6.1 (incident 719261).
 *
 * Root cause, from the 0.6.1 -> 0.7.1 diff: the pinned @hasna/contracts upgrade
 * (^0.4.2 -> 0.13.1) replaced the vendored storage kit's TLS resolution, and
 * the kit now resolves `sslmode=require` as `{ rejectUnauthorized: true }`
 * (verify the server certificate against the trust store) instead of the
 * 0.4.2-kit `{ rejectUnauthorized: false }` (encrypt without verification).
 * The production DSN uses sslmode=require and the image had no RDS CA bundle,
 * so every database connection failed the handshake ("self signed certificate
 * in certificate chain" — measured on the same release's migrate task), every
 * per-request key-status lookup threw, and verifyApiKey's fail-closed catch
 * answered 503 status_unavailable. The serve booted "healthy" into that state
 * because /health is process-local.
 *
 * The serve's auth verification depends on a key-status DB lookup that can
 * never succeed while the database TLS handshake cannot complete. That state
 * must be impossible to boot into silently: a verifying DSN (sslmode require /
 * verify-ca / verify-full under the kit's semantics) with no resolvable CA
 * bundle is a boot-time refusal, not a fleet-wide 503. This file pins that
 * contract. The CA bundle itself (and the migrate image) is I38-00558's lane;
 * this is the serve's own half of the same defect.
 *
 * Synthetic throwaway values only — no credential is read, captured, or
 * printed.
 */
import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDbTlsContract } from "./db-tls-contract.js";
import { buildDeps } from "./api.js";

const REQUIRE_DSN =
  "postgresql://synthetic-user:synthetic-pass@127.0.0.1:5432/conversations?sslmode=require";
const DISABLE_DSN =
  "postgresql://synthetic-user:synthetic-pass@127.0.0.1:5432/conversations?sslmode=disable";
const PLAIN_DSN = "postgresql://synthetic-user:synthetic-pass@127.0.0.1:5432/conversations";

const SYNTHETIC_PEM = "-----BEGIN CERTIFICATE-----\nSYNTHETIC-CA-CONTENT\n-----END CERTIFICATE-----\n";

const ENV_KEYS = [
  "PGSSLROOTCERT",
  "NODE_EXTRA_CA_CERTS",
  "HASNA_CONVERSATIONS_DATABASE_URL",
  "HASNA_CONVERSATIONS_API_SIGNING_KEY",
] as const;
const saved = new Map<string, string | undefined>();
for (const key of ENV_KEYS) saved.set(key, process.env[key]);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("serve database TLS contract (I38-00559)", () => {
  test("a verifying DSN with no resolvable CA is a boot-time refusal, never a silent 503 fleet", () => {
    // The production failure shape: sslmode=require, no CA anywhere. The serve
    // must refuse to boot instead of serving 503 status_unavailable on every
    // authenticated request while /health reports ok.
    expect(() => assertDbTlsContract(REQUIRE_DSN, {})).toThrow(/CA bundle/i);
    expect(() => assertDbTlsContract(REQUIRE_DSN, {})).toThrow(/PGSSLROOTCERT/);
  });

  test("a verifying DSN with an explicit CA passes", () => {
    expect(() => assertDbTlsContract(REQUIRE_DSN, {}, { ca: SYNTHETIC_PEM })).not.toThrow();
  });

  test("a verifying DSN with PGSSLROOTCERT pointing at a CA file passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "i38-00559-ca-"));
    try {
      const caPath = join(dir, "synthetic-ca.pem");
      writeFileSync(caPath, SYNTHETIC_PEM, "utf8");
      expect(() =>
        assertDbTlsContract(REQUIRE_DSN, { PGSSLROOTCERT: caPath }),
      ).not.toThrow();
      expect(() =>
        assertDbTlsContract(REQUIRE_DSN, { NODE_EXTRA_CA_CERTS: caPath }),
      ).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("non-verifying configurations are unaffected", () => {
    expect(() => assertDbTlsContract(DISABLE_DSN, {})).not.toThrow();
    expect(() => assertDbTlsContract(PLAIN_DSN, {})).not.toThrow();
    expect(() => assertDbTlsContract(null, {})).not.toThrow();
  });

  test("buildDeps refuses to boot under the production DSN shape without a CA", () => {
    // The production environment at the time of incident 719261:
    // HASNA_CONVERSATIONS_DATABASE_URL with sslmode=require, no CA resolvable.
    // (The image does not inherit a station's ambient PGSSLROOTCERT /
    // NODE_EXTRA_CA_CERTS, so both are cleared to simulate it.)
    // The serve's deps construction must refuse; booting into this state is a
    // fleet-wide auth outage (every key-status lookup throws, every /v1
    // request 503s) that /health does not signal.
    delete process.env.PGSSLROOTCERT;
    delete process.env.NODE_EXTRA_CA_CERTS;
    process.env.HASNA_CONVERSATIONS_DATABASE_URL = REQUIRE_DSN;
    process.env.HASNA_CONVERSATIONS_API_SIGNING_KEY =
      "synthetic-test-signing-secret-0123456789abcdef";
    expect(() => buildDeps()).toThrow(/CA bundle/i);
  });
});
