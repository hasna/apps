import { describe, expect, it } from "bun:test";
import { resolveTlsConfig, sslModeFromConnectionString } from "../src/generated/storage-kit/tls.js";

// §4.8: cloud Postgres MUST use sslmode=verify-full with a pinned CA bundle.
// Assert the vendored kit enforces this (config-level, no live DB).

describe("cloud TLS (sslmode=verify-full)", () => {
  it("extracts verify-full from the DSN", () => {
    expect(sslModeFromConnectionString("postgres://u:p@h/db?sslmode=verify-full")).toBe("verify-full");
  });

  it("refuses verify-full without a CA bundle (no silent downgrade)", () => {
    expect(() =>
      resolveTlsConfig("postgres://u:p@h/db?sslmode=verify-full", { env: {} }),
    ).toThrow(/requires a CA bundle/);
  });

  it("verifies the server cert when a CA bundle is supplied", () => {
    const config = resolveTlsConfig("postgres://u:p@h/db?sslmode=verify-full", { ca: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----" });
    expect(config).toEqual({ rejectUnauthorized: true, ca: expect.any(String) });
  });

  it("never verifies for plain require (downgrade is explicit, not accidental)", () => {
    const config = resolveTlsConfig("postgres://u:p@h/db?sslmode=require", { env: {} });
    expect(config).toEqual({ rejectUnauthorized: false });
  });
});
