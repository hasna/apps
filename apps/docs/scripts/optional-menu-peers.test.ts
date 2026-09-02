import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("optional TipTap menus use the exact core/pm version, not a newer incompatible peer family", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8"));
  const version = manifest.dependencies["@tiptap/core"];
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(manifest.dependencies["@tiptap/pm"]).toBe(version);
  expect(manifest.dependencies["@tiptap/react"]).toBe(version);
  for (const menu of ["@tiptap/extension-bubble-menu", "@tiptap/extension-floating-menu"]) {
    expect(manifest.optionalDependencies?.[menu]).toBe(version);
    expect(manifest.dependencies[menu]).toBeUndefined();
  }
});
