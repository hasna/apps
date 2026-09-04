import { describe, expect, test } from "bun:test";
import { splitNameVersion } from "../../lib/pull.js";
import { bumpPatch } from "./publish.js";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();

describe("name@version parsing and --force-new-version bumps", () => {
  test("splitNameVersion separates an exact version and leaves bare names alone", () => {
    expect(splitNameVersion("release-notes@2.1.0")).toEqual({ name: "release-notes", version: "2.1.0" });
    expect(splitNameVersion("release-notes").version).toBeUndefined();
  });

  test("bumpPatch increments the patch and stays unique for non-semver versions", () => {
    expect(bumpPatch("2.1.0")).toBe("2.1.1");
    expect(bumpPatch("0.0.9")).toBe("0.0.10");
    expect(bumpPatch("nightly")).toBe("nightly.1");
  });
});
