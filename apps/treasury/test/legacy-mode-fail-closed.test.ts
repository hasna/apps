import { afterEach, describe, expect, it } from "bun:test";
import { assertServeSafety } from "../src/server/index.js";
import { assertMcpServeSafety } from "../src/mcp/http.js";

/**
 * Regression (0.1.3 release review P1): the deployment-mode removal dropped the
 * backend resolution from the serve/mcp startup guards. `resolveServerBackend()`
 * fails closed on removed storage-mode variables via `assertNoLegacyStorageMode`,
 * but neither `assertServeSafety` nor `assertMcpServeSafety` called it before
 * `Bun.serve` — treasury-serve bound then threw post-bind (brief live socket),
 * and treasury-mcp bound and kept serving with an invalid removed-mode config.
 *
 * The startup guards MUST resolve the backend BEFORE any listener binds so a
 * legacy `HASNA_<APP>_STORAGE_MODE` / `<APP>_STORAGE_MODE` / *_MODE variable
 * refuses startup, never serves.
 */
const LEGACY_KEYS = ["HASNA_TREASURY_STORAGE_MODE", "HASNA_TREASURY_MODE", "TREASURY_STORAGE_MODE", "TREASURY_MODE"] as const;

afterEach(() => {
  for (const k of LEGACY_KEYS) delete process.env[k];
  delete process.env["HASNA_TREASURY_DATABASE_URL"];
  delete process.env["HASNA_TREASURY_DATABASE_URL_FILE"];
});

describe("legacy storage-mode fail-closed startup guards", () => {
  it("assertServeSafety throws on a legacy HASNA_TREASURY_STORAGE_MODE before bind", () => {
    process.env["HASNA_TREASURY_STORAGE_MODE"] = "cloud";
    expect(() => assertServeSafety()).toThrow(/HASNA_TREASURY_STORAGE_MODE was removed/);
  });

  it("assertServeSafety throws on a bare TREASURY_MODE legacy variable", () => {
    process.env["TREASURY_MODE"] = "local";
    expect(() => assertServeSafety()).toThrow(/TREASURY_MODE was removed/);
  });

  it("assertMcpServeSafety throws on a legacy storage-mode variable before bind", () => {
    process.env["HASNA_TREASURY_MODE"] = "cloud";
    expect(() => assertMcpServeSafety("127.0.0.1")).toThrow(/HASNA_TREASURY_MODE was removed/);
  });

  it("both guards pass with no legacy variable (loopback, no auth required)", () => {
    expect(() => assertServeSafety()).not.toThrow();
    expect(() => assertMcpServeSafety("127.0.0.1")).not.toThrow();
  });
});
