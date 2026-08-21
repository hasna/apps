import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getPackageVersion } from "../src/version.js";

test("reads package version", () => {
  const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  expect(getPackageVersion()).toBe(version);
});

test("reads package version when imported through a symlinked bin path", async () => {
  const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  const dir = mkdtempSync(join(tmpdir(), "stations-version-symlink-"));
  const link = join(dir, "version-link.ts");
  symlinkSync(new URL("../src/version.ts", import.meta.url), link);

  const mod = await import(`${pathToFileURL(link).href}?case=symlink`);
  expect(mod.getPackageVersion()).toBe(version);
});
