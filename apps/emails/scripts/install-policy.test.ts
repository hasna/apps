import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("canonical package installation", () => {
  test("does not register or ship the legacy data-root creation hook", () => {
    expect(manifest.scripts.postinstall).toBeUndefined();
    expect(manifest.files).not.toContain("scripts/ensure-private-data-dir.mjs");
    for (const name of ["preinstall", "install", "postinstall"]) expect(manifest.scripts[name]).toBeUndefined();
  });

  test("the container dependency install no longer copies the removed lifecycle hook", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    expect(dockerfile).not.toContain("COPY scripts/ensure-private-data-dir.mjs");
    expect(dockerfile).toContain("COPY package.json bun.lock ./");
    expect(dockerfile).toContain("RUN bun install --production --frozen-lockfile");
  });
});
