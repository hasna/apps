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

  it("require mode does NOT verify the cert (why the cohort mandates verify-full)", () => {
    const cfg = resolveTlsConfig(REQUIRE_DSN, { ca: FAKE_CA });
    expect(cfg).toEqual({ rejectUnauthorized: false, ca: FAKE_CA });
  });
});
