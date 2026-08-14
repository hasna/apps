import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertVerifyFull } from "../src/db/cloud.js";

// §4.8: cloud Postgres connections MUST use sslmode=verify-full with a CA bundle.
// sslmode=require is forbidden. Asserted against config, no live DB.

let tmp: string;
let caPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "holdings-ca-"));
  caPath = join(tmp, "rds-ca.pem");
  writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("cloud TLS (§4.8)", () => {
  it("accepts sslmode=verify-full when a CA bundle is available", () => {
    const dsn = "postgres://holdings:pw@rds.example.com:5432/holdings?sslmode=verify-full";
    expect(() => assertVerifyFull(dsn, { PGSSLROOTCERT: caPath })).not.toThrow();
  });

  it("rejects sslmode=require (no cert verification)", () => {
    const dsn = "postgres://holdings:pw@rds.example.com:5432/holdings?sslmode=require";
    expect(() => assertVerifyFull(dsn, { PGSSLROOTCERT: caPath })).toThrow(/verify-full/);
  });

  it("rejects verify-full when no CA bundle can be resolved", () => {
    const dsn = "postgres://holdings:pw@rds.example.com:5432/holdings?sslmode=verify-full";
    expect(() => assertVerifyFull(dsn, {})).toThrow();
  });
});
