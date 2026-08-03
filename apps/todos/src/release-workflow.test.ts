import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const releaseWorkflow = readFileSync(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8");

describe("npm release workflow", () => {
  test("binds strict prepublish verification to the checked-out Actions commit", () => {
    expect(releaseWorkflow).toContain("HASNA_TODOS_EXPECTED_COMMIT: ${{ github.sha }}");
  });
});
