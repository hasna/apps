import { describe, expect, test } from "bun:test";
import { createAccountSchema, updateAccountSchema } from "./schema.js";

describe("accounts API path validation", () => {
  test("create rejects NUL and newline directory paths", () => {
    expect(
      createAccountSchema.safeParse({ name: "bad-dir", tool: "claude", dir: "/tmp/bad\0path" }).success,
    ).toBe(false);
    expect(
      createAccountSchema.safeParse({ name: "bad-dir", tool: "claude", dir: "/tmp/bad\npath" }).success,
    ).toBe(false);
  });

  test("update rejects invalid directory paths", () => {
    expect(updateAccountSchema.safeParse({ dir: "/tmp/bad\0path" }).success).toBe(false);
    expect(updateAccountSchema.safeParse({ dir: "/tmp/bad\rpath" }).success).toBe(false);
  });
});

// R-P1-4 (2026-07-31-accounts-debloat-design.md): PATCH /v1/accounts/:tool/:name
// accepts aliases + nativeName so the cloud repo can record a rename.
describe("accounts API alias fields (R-P1-4)", () => {
  test("update accepts nativeName and aliases", () => {
    const parsed = updateAccountSchema.safeParse({ nativeName: "account005", aliases: ["account005"] });
    expect(parsed.success).toBe(true);
  });

  test("update rejects a nativeName that is not a valid profile-name slug", () => {
    expect(updateAccountSchema.safeParse({ nativeName: "Not A Slug!" }).success).toBe(false);
  });

  test("update rejects an aliases entry that is not a valid profile-name slug", () => {
    expect(updateAccountSchema.safeParse({ aliases: ["ok-name", "Not Ok!"] }).success).toBe(false);
  });
});

// b27cc4a0: PATCH /v1/accounts/:tool/:name accepts a per-machine authStatus
// map so the cloud repo can record which machines a profile is authenticated
// on. First-class field, deliberately NOT inside `metadata` (flat scalars).
describe("accounts API authStatus field (b27cc4a0)", () => {
  test("update accepts per-machine authStatus entries", () => {
    const parsed = updateAccountSchema.safeParse({
      authStatus: {
        "host-a": { authenticated: true, checkedAt: "2026-08-19T00:00:00.000Z", detail: "ok" },
        "host-b": { authenticated: false, checkedAt: "2026-08-19T00:00:00.000Z" },
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("update rejects an authStatus entry that is missing checkedAt", () => {
    const parsed = updateAccountSchema.safeParse({
      authStatus: { "host-a": { authenticated: true } },
    });
    expect(parsed.success).toBe(false);
  });

  test("update rejects an authStatus entry whose authenticated flag is not a boolean", () => {
    const parsed = updateAccountSchema.safeParse({
      authStatus: { "host-a": { authenticated: "yes", checkedAt: "2026-08-19T00:00:00.000Z" } },
    });
    expect(parsed.success).toBe(false);
  });
});
