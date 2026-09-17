import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveInstalledSecrets } from "./installed-secrets.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "installed-sdk-"));
  roots.push(root);
  const consumer = join(root, "consumer space", "dist");
  mkdirSync(consumer, { recursive: true });
  const url = pathToFileURL(join(consumer, "index.js")).href;
  const nearest = join(consumer, "node_modules/@hasna/secrets");
  return { root, consumer, url, nearest };
}
function install(directory: string, exports: unknown = { ".": { require: "./wrong.cjs", import: "./sdk.js" } }) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@hasna/secrets", exports }));
  writeFileSync(join(directory, "sdk.js"), "export const fixture = true;\n");
  return pathToFileURL(join(directory, "sdk.js")).href;
}

test("resolves the installed import-only SDK from the consumer location", () => {
  const f = fixture();
  const expected = install(join(f.root, "node_modules/@hasna/secrets"));
  expect(resolveInstalledSecrets(f.url)).toBe(expected);
});

test("the nearest installation wins and an invalid nearest installation is terminal", () => {
  const f = fixture();
  install(join(f.root, "node_modules/@hasna/secrets"));
  expect(resolveInstalledSecrets(f.url)).not.toContain("consumer%20space");
  const nearest = install(f.nearest);
  expect(resolveInstalledSecrets(f.url)).toBe(nearest);
  for (const metadata of ["{", "null", '{}', '{"name":"other","exports":"./sdk.js"}', '{"name":"@hasna/secrets","main":"./sdk.js"}', '{"name":"@hasna/secrets","exports":{"require":"./sdk.js"}}']) {
    writeFileSync(join(f.nearest, "package.json"), metadata);
    expect(() => resolveInstalledSecrets(f.url)).toThrow();
  }
});

test("missing entry files do not switch to another export or an ancestor SDK", () => {
  const f = fixture();
  install(join(f.root, "node_modules/@hasna/secrets"));
  install(f.nearest, ["./missing.js", "./sdk.js"]);
  expect(() => resolveInstalledSecrets(f.url)).toThrow();
});

test("supports package-manager symlinks but refuses broken nearest links", () => {
  const f = fixture();
  const directory = join(f.root, "workspace/secrets");
  const expected = install(directory);
  install(join(f.root, "node_modules/@hasna/secrets"));
  mkdirSync(join(f.consumer, "node_modules/@hasna"), { recursive: true });
  symlinkSync(directory, f.nearest, "dir");
  expect(resolveInstalledSecrets(f.url)).toBe(expected);
  rmSync(directory, { recursive: true });
  expect(() => resolveInstalledSecrets(f.url)).toThrow();
});

test("exports cannot escape the installed package", () => {
  const f = fixture();
  for (const target of ["../sdk.js", "/sdk.js", "./../sdk.js", "./node_modules/sdk.js", "./%2e%2e/sdk.js", "./sdk.js?other", "./sdk.js#other", "./dist\\sdk.js"]) {
    install(f.nearest, target);
    expect(() => resolveInstalledSecrets(f.url)).toThrow();
  }
  install(f.nearest, "./outside.js");
  const outside = join(f.root, "outside.js");
  writeFileSync(outside, "export {};\n");
  symlinkSync(outside, join(f.nearest, "outside.js"));
  expect(() => resolveInstalledSecrets(f.url)).toThrow();
});

test("rejects non-file and oversized package metadata", () => {
  const f = fixture();
  install(f.nearest);
  const metadata = join(f.nearest, "package.json");
  writeFileSync(metadata, " ".repeat(1024 * 1024 + 1));
  expect(() => resolveInstalledSecrets(f.url)).toThrow();
  rmSync(metadata);
  mkdirSync(metadata);
  expect(() => resolveInstalledSecrets(f.url)).toThrow();
});

test("does not resolve a peer from the current working directory", () => {
  const f = fixture();
  // This test runner has @hasna/secrets installed; the isolated consumer does not.
  expect(() => resolveInstalledSecrets(f.url)).toThrow();
  expect(() => resolveInstalledSecrets("https://example.com/consumer.js")).toThrow();
});
