import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("published ./sdk compatibility subpath", () => {
  it("resolves to the exact generated selfhost runtime without a duplicate sdk tree", async () => {
    expect(existsSync(join(root, "sdk"))).toBe(false);
    expect(existsSync(join(root, "src", "selfhost.ts"))).toBe(true);
    expect(existsSync(join(root, "dist", "selfhost.js"))).toBe(true);

    const [sdk, selfhost] = await Promise.all([
      import("@hasna/emails/sdk"),
      import("@hasna/emails/selfhost"),
    ]);
    expect(Object.keys(sdk).sort()).toEqual(Object.keys(selfhost).sort());
    expect(sdk.ApiError).toBe(selfhost.ApiError);
    expect(sdk.EmailsSelfHostClient).toBe(selfhost.EmailsSelfHostClient);
  });
});
