import { describe, expect, it } from "bun:test";
import { resolveTlsConfig, sslModeFromConnectionString } from "../src/generated/storage-kit/tls.js";

// §4.8: cloud Postgres connections MUST use sslmode=verify-full with a pinned CA
// bundle. This asserts the vendored kit config (no live DB required).

const VERIFY_FULL_DSN = "postgres://fleet:pw@db.internal:5432/fleet?sslmode=verify-full";
const REQUIRE_DSN = "postgres://fleet:pw@db.internal:5432/fleet?sslmode=require";
const FAKE_CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

describe("cloud TLS config (verify-full)", () => {
  it("reads verify-full from the DSN", () => {
    expect(sslModeFromConnectionString(VERIFY_FULL_DSN)).toBe("verify-full");
  });

  it("verify-full requires a CA bundle and verifies the server cert", () => {
    const cfg = resolveTlsConfig(VERIFY_FULL_DSN, { ca: FAKE_CA });
    expect(cfg).toEqual({ rejectUnauthorized: true, ca: FAKE_CA });
  });

  it("verify-full without any CA bundle is rejected", () => {
    expect(() => resolveTlsConfig(VERIFY_FULL_DSN, { env: {} })).toThrow(/CA bundle/);
  });

  it("require mode still verifies the cert when a CA is supplied — verification never downgrades", () => {
    // The vendored kit (0.11.1) fails closed: sslmode=require no longer
    // disables verification. That is why the fleet mandates verify-full — only
    // verify-full demands a pinned CA bundle, while require can no longer
    // silently downgrade to plaintext.
    const cfg = resolveTlsConfig(REQUIRE_DSN, { ca: FAKE_CA });
    expect(cfg).toEqual({ rejectUnauthorized: true, ca: FAKE_CA });
  });
});
