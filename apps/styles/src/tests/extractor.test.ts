import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { extractStylesFromFile, type RawExtractedStyles } from "../lib/extractor.js";

let testDir = "";

beforeEach(() => {
  testDir = join(tmpdir(), `styles-extract-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    for (const f of ["test.css", "test.scss"]) {
      const p = join(testDir, f);
      if (existsSync(p)) unlinkSync(p);
    }
    rmdirSync(testDir);
  }
});

describe("extractStylesFromFile", () => {
  test("extracts CSS variables from a CSS file", () => {
    const cssPath = join(testDir, "test.css");
    writeFileSync(cssPath, `:root {\n  --primary: #1a1a2e;\n  --secondary: #e94560;\n  --font-family: Inter, sans-serif;\n}`);
    const result = extractStylesFromFile(cssPath);
    expect(result.url).toContain("file://");
    expect(result.cssVars["--primary"]).toBe("#1a1a2e");
    expect(result.cssVars["--secondary"]).toBe("#e94560");
    expect(result.stylesheets.length).toBe(1);
  });

  test("extracts @font-face declarations", () => {
    const cssPath = join(testDir, "test.css");
    writeFileSync(cssPath, '@font-face { font-family: "Inter"; src: url("/fonts/Inter.woff2"); }');
    const result = extractStylesFromFile(cssPath);
    expect(result.fontFaces.length).toBe(1);
    expect(result.fontFaces[0]).toContain("Inter");
  });

  test("converts SCSS variables to CSS vars", () => {
    const scssPath = join(testDir, "test.scss");
    writeFileSync(scssPath, "$primary: #1a1a2e;\n$font-stack: Inter, sans-serif;");
    const result = extractStylesFromFile(scssPath);
    expect(result.cssVars["--primary"]).toBe("#1a1a2e");
    expect(result.cssVars["--font-stack"]).toBe("Inter, sans-serif");
  });

  test("strips SCSS-specific syntax", () => {
    const scssPath = join(testDir, "test.scss");
    writeFileSync(scssPath, '@mixin flex-center {\n  display: flex;\n  align-items: center;\n}\n$color: red;\n// comment');
    const result = extractStylesFromFile(scssPath);
    // The mixin should be stripped but the dollar variable should be converted
    expect(result.cssVars["--color"]).toBe("red");
  });

  test("has timestamp", () => {
    const cssPath = join(testDir, "test.css");
    writeFileSync(cssPath, ":root { --x: 1; }");
    const result = extractStylesFromFile(cssPath);
    expect(result.extractedAt).toBeGreaterThan(0);
  });

  test("has empty computed elements (static file)", () => {
    const cssPath = join(testDir, "test.css");
    writeFileSync(cssPath, ":root { --x: 1; }");
    const result = extractStylesFromFile(cssPath);
    expect(result.computedElements).toEqual([]);
  });
});
