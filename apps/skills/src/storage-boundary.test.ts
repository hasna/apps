import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { useDefaultTestTimeout } from "./test-preload.js";

// Packed-consumer surface: this resolves the same `./storage` subpath that the
// published package maps to `dist/storage.js` (package.json
// `exports["./storage"]`). A consumer of `@hasna/skills/storage` sees exactly
// these exports, so the assertions below are the embedder's compile-time
// guarantee: a future removal of a contract member fails the OSS suite.
import * as storageModule from "./storage.js";
import { storageCapabilities } from "./storage.js";

useDefaultTestTimeout();

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("storage subpath compatibility contract", () => {
  test("contract declares a version and non-empty member sets", () => {
    expect(typeof storageCapabilities.version).toBe("number");
    expect(storageCapabilities.version).toBeGreaterThan(0);
    expect(storageCapabilities.values.length).toBeGreaterThan(0);
    expect(storageCapabilities.types.length).toBeGreaterThan(0);
  });

  test("every contract value is exported by the ./storage subpath", () => {
    const missing = storageCapabilities.values.filter((name) => !(name in storageModule));
    expect(missing).toEqual([]);
  });

  test("retired deployment-mode surface is not re-exported", () => {
    // The retired storage-mode label functions, their mode type, and the
    // storage-mode env variables were removed from both the main entrypoint
    // and this subpath in 0.1.61. The mode concept has no successor;
    // configuration-derived status is the replacement.
    for (const name of [
      "getStorage" + "Mode",
      "getSkillsStorage" + "Mode",
      "SkillsStorage" + "Mode",
    ]) {
      expect(name in storageModule).toBe(false);
    }
  });

  test("storage.ts re-exports every contract member", () => {
    // Content mirror of the no-cloud-boundary entrypoint test, applied to the
    // storage subpath: a listed member that stops being re-exported fails here
    // even before the runtime import above does.
    const entrypoint = readFileSync(join(repoRoot, "src", "storage.ts"), "utf8");
    for (const name of [...storageCapabilities.values, ...storageCapabilities.types]) {
      expect(entrypoint).toContain(name);
    }
  });

  test("storage subpath sources avoid retired deployment-mode vocabulary", () => {
    const files = [
      join(repoRoot, "src", "storage.ts"),
      join(repoRoot, "src", "lib", "native-storage.ts"),
    ];
    const forbidden = [
      "getStorage" + "Mode",
      "getSkillsStorage" + "Mode",
      "SkillsStorage" + "Mode",
      "STORAGE_" + "MODE",
      "deployment" + "Mode",
    ];
    const offenders = files.flatMap((file) =>
      forbidden
        .filter((term) => readFileSync(file, "utf8").includes(term))
        .map((term) => `${file.replace(repoRoot + "/", "")}:${term}`),
    );
    expect(offenders).toEqual([]);
  });
});
