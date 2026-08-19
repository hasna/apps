// b27cc4a0: `accounts auth-status <name>` probes THIS machine and maps the
// existing per-machine runtime probes onto the stored authStatus entry shape
// { authenticated, checkedAt, detail? }. These tests pin the mapping for the
// three observable cases: claude health, foreign/missing dir, non-claude tool.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeProfileAuthStatus } from "./auth-status.js";

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "accounts-auth-status-probe-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("probeProfileAuthStatus", () => {
  test("a claude profile whose dir has no auth maps to authenticated:false with detail 'missing'", () => {
    const entry = probeProfileAuthStatus({
      name: "p1",
      tool: "claude",
      dir: join(scratch, "empty-dir"),
      createdAt: new Date(0).toISOString(),
    });
    expect(entry.authenticated).toBe(false);
    expect(entry.detail).toBe("missing");
    expect(typeof entry.checkedAt).toBe("string");
    expect(Date.parse(entry.checkedAt)).not.toBeNaN();
  });

  test("a non-claude profile with a missing dir maps to authenticated:false with detail 'profile-dir-missing'", () => {
    const entry = probeProfileAuthStatus({
      name: "p2",
      tool: "codewith",
      dir: join(scratch, "does-not-exist"),
      createdAt: new Date(0).toISOString(),
    });
    expect(entry.authenticated).toBe(false);
    expect(entry.detail).toBe("profile-dir-missing");
  });

  test("a non-claude profile with an existing but credential-less dir is authenticated:false 'not-locally-verifiable'", () => {
    const dir = join(scratch, "empty");
    mkdirSync(dir);
    const entry = probeProfileAuthStatus({
      name: "p3",
      tool: "codewith",
      dir,
      createdAt: new Date(0).toISOString(),
    });
    expect(entry.authenticated).toBe(false);
    expect(entry.detail).toBe("not-locally-verifiable");
  });
});
