import { describe, expect, test } from "bun:test";

interface PackageManifest {
  version?: string;
  peerDependencies?: Record<string, string>;
}

describe("package compatibility", () => {
  test("requires the first @hasna/todos release with the AI runtime contract", async () => {
    const aiManifest = await Bun.file(
      new URL("../package.json", import.meta.url),
    ).json() as PackageManifest;
    const rootManifest = await Bun.file(
      new URL("../../package.json", import.meta.url),
    ).json() as PackageManifest;
    const range = aiManifest.peerDependencies?.["@hasna/todos"];

    expect(typeof range).toBe("string");
    expect(typeof rootManifest.version).toBe("string");
    if (typeof range !== "string" || typeof rootManifest.version !== "string") {
      return;
    }

    expect(Bun.semver.satisfies("0.15.20", range)).toBe(false);
    expect(Bun.semver.satisfies("0.15.21", range)).toBe(true);
    expect(Bun.semver.satisfies("1.0.0", range)).toBe(false);
    expect(Bun.semver.satisfies(rootManifest.version, range)).toBe(true);
  });
});
