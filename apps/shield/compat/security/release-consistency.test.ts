import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const shieldManifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };
const securityManifest = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string; dependencies: Record<string, string> };

describe("Shield 0.1.30 compatibility release", () => {
  test("keeps the compatibility dependency pinned to the Shield release", () => {
    expect(shieldManifest.version).toBe("0.1.30");
    expect(securityManifest.dependencies["@hasna/shield"]).toBe(
      shieldManifest.version,
    );
  });

  test("advances @hasna/security beyond the published 0.1.14 release", () => {
    expect(securityManifest.version).toBe("0.1.15");
  });
});
