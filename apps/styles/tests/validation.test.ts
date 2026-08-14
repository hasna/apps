import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

import { STYLES, ALL_STYLE_NAMES } from "../src/lib/registry.js";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = join(dirname(thisFile), "..");
const stylesDir = join(projectRoot, "styles");

describe("STYLES registry validation", () => {
  test("has exactly 10 entries", () => {
    expect(STYLES).toHaveLength(10);
  });

  test("no duplicate names", () => {
    const names = STYLES.map((s) => s.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

describe("styles/ directory validation", () => {
  test("every STYLES entry has a corresponding styles/style-{name}/ directory", () => {
    for (const style of STYLES) {
      const dir = join(stylesDir, `style-${style.name}`);
      expect(existsSync(dir)).toBe(true);
    }
  });

  test("every styles/style-{name}/ directory has a STYLE.md file", () => {
    for (const style of STYLES) {
      const styleMd = join(stylesDir, `style-${style.name}`, "STYLE.md");
      expect(existsSync(styleMd)).toBe(true);
    }
  });

  test("every styles/style-{name}/ directory corresponds to a known style", () => {
    const dirs = readdirSync(stylesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("style-"))
      .map((e) => e.name.replace(/^style-/, ""));

    const knownNames = new Set(STYLES.map((s) => s.name));
    for (const dir of dirs) {
      expect(knownNames.has(dir)).toBe(true);
    }
  });
});

describe("ALL_STYLE_NAMES", () => {
  test("has exactly 10 entries", () => {
    expect(ALL_STYLE_NAMES).toHaveLength(10);
  });

  test("matches STYLES names", () => {
    const styleNames = STYLES.map((s) => s.name);
    for (const name of ALL_STYLE_NAMES) {
      expect(styleNames).toContain(name);
    }
  });
});
