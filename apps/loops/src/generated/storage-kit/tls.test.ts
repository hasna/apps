import { describe, expect, test } from "bun:test";
import { resolveTlsConfig, sslModeFromConnectionString } from "./tls.js";

const CA = "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----\n";

// Pins the @hasna/contracts 0.10.6 storage-kit mode table (see tls.ts header):
//   - disable (explicit)          -> no TLS, stated explicitly (ssl: false)
//   - (no ssl param)              -> no explicit TLS policy (ssl: undefined)
//   - prefer / require            -> encrypt AND verify (rejectUnauthorized: true),
//                                    pinning a CA bundle when one is available
//   - verify-ca / verify-full     -> encrypt AND verify against a CA bundle,
//                                    which is REQUIRED (throw without one)
// The kit file itself is generated and must not be edited; this test is the
// repo-side pin of its resolved semantics.
describe("generated storage kit TLS", () => {
  test("leaves local non-TLS URLs without pg ssl config", () => {
    expect(resolveTlsConfig("postgres://localhost/openloops")).toBeUndefined();
    expect(resolveTlsConfig("postgres://localhost/openloops?sslmode=disable")).toBe(false);
  });

  test("verifies for sslmode=require using the trust store when no CA bundle is available", () => {
    expect(resolveTlsConfig("postgres://rds.example.test/openloops?sslmode=require", { env: {} })).toEqual({
      rejectUnauthorized: true,
    });
  });

  test("verifies certificates for sslmode=require when a CA bundle is available", () => {
    expect(resolveTlsConfig("postgres://rds.example.test/openloops?sslmode=require", { ca: CA })).toEqual({
      rejectUnauthorized: true,
      ca: CA,
    });
  });

  test("normalizes legacy ssl=true to the verified require path", () => {
    expect(sslModeFromConnectionString("postgres://rds.example.test/openloops?ssl=true")).toBe("require");
    expect(resolveTlsConfig("postgres://rds.example.test/openloops?ssl=true", { env: {} })).toEqual({
      rejectUnauthorized: true,
    });
  });

  test("requires a CA bundle for sslmode=verify-ca and verify-full", () => {
    expect(() => resolveTlsConfig("postgres://rds.example.test/openloops?sslmode=verify-ca", { env: {} })).toThrow(
      "requires a CA bundle",
    );
    expect(() => resolveTlsConfig("postgres://rds.example.test/openloops?sslmode=verify-full", { env: {} })).toThrow(
      "requires a CA bundle",
    );
  });
});
