import { describe, expect, test } from "bun:test";
import { resolveTlsConfig, sslModeFromConnectionString } from "./tls.js";

const CA = "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----\n";

describe("generated storage kit TLS", () => {
  test("leaves local non-TLS URLs without pg ssl config", () => {
    expect(resolveTlsConfig("postgres://localhost/loops")).toBeUndefined();
    expect(resolveTlsConfig("postgres://localhost/loops?sslmode=disable")).toBeUndefined();
  });

  test("requires a CA bundle for sslmode=require", () => {
    expect(() => resolveTlsConfig("postgres://rds.example.test/loops?sslmode=require", { env: {} })).toThrow(
      "requires verified TLS",
    );
  });

  test("verifies certificates for sslmode=require when a CA bundle is available", () => {
    expect(resolveTlsConfig("postgres://rds.example.test/loops?sslmode=require", { ca: CA })).toEqual({
      rejectUnauthorized: true,
      ca: CA,
    });
  });

  test("normalizes legacy ssl=true to the verified require path", () => {
    expect(sslModeFromConnectionString("postgres://rds.example.test/loops?ssl=true")).toBe("require");
    expect(() => resolveTlsConfig("postgres://rds.example.test/loops?ssl=true", { env: {} })).toThrow(
      "requires verified TLS",
    );
  });
});
