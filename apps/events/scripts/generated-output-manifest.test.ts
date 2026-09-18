import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  GENERATED_OUTPUTS,
  assertExactGeneratedOutputInventory,
  assertGeneratedEntrypointsCovered,
  generatedPackageEntrypoints,
} from "./generated-output-manifest.js";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");

test("the expected manifest exactly covers generated outputs and package.json entrypoints", () => {
  assertExactGeneratedOutputInventory(PACKAGE_ROOT);
  assertGeneratedEntrypointsCovered(PACKAGE_ROOT);
  for (const entrypoint of generatedPackageEntrypoints(PACKAGE_ROOT)) {
    expect(GENERATED_OUTPUTS).toContain(entrypoint);
  }
});

test("the generated-output gate rejects unexpected ignored dist files", () => {
  const fixture = mkdtempSync(join(tmpdir(), "events-generated-output-"));
  try {
    for (const file of GENERATED_OUTPUTS) {
      const destination = join(fixture, file);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, "");
    }
    writeFileSync(join(fixture, "dist", "ignored-extra.js"), "");
    expect(() => assertExactGeneratedOutputInventory(fixture)).toThrow(
      "unexpected generated outputs: dist/ignored-extra.js",
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
