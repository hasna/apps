import { describe, it, expect } from "bun:test";
import { smartDisplay } from "./smart-display.js";

describe("smartDisplay", () => {
  it("passes through short output unchanged", () => {
    const lines = ["file1.txt", "file2.txt", "file3.txt"];
    expect(smartDisplay(lines)).toEqual(lines);
  });

  it("collapses node_modules paths", () => {
    const lines = [
      "./src/app.ts",
      "./node_modules/foo/index.js",
      "./node_modules/bar/index.js",
      "./node_modules/baz/index.js",
      "./node_modules/qux/index.js",
      "./node_modules/quux/index.js",
      "./tests/app.test.ts",
    ];
    const result = smartDisplay(lines);
    expect(result.length).toBeLessThanOrEqual(lines.length);
    expect(result.some(l => l.includes("node_modules/") && l.includes("matches"))).toBe(true);
  });

  it("groups files by directory", () => {
    const lines = [
      "./src/components/Button.tsx",
      "./src/components/Modal.tsx",
      "./src/components/Input.tsx",
      "./src/components/Select.tsx",
      "./src/components/Table.tsx",
      "./src/lib/utils.ts",
    ];
    const result = smartDisplay(lines);
    expect(result.length).toBeLessThan(lines.length);
  });

  it("detects duplicate filenames across directories", () => {
    const lines = [
      "./open-testers/node_modules/zod/.github/logo.png",
      "./open-attachments/node_modules/zod/.github/logo.png",
      "./open-terminal/node_modules/zod/.github/logo.png",
      "./open-emails/node_modules/zod/.github/logo.png",
      "./src/app.ts",
      "./tests/app.test.ts",
    ];
    const result = smartDisplay(lines);
    // Should collapse the 4 identical logo.png into one entry
    expect(result.length).toBeLessThan(lines.length);
  });

  it("collapses timestamp-like patterns", () => {
    const lines = [
      "./screenshots/page-2026-03-09T05-43-19-525Z.png",
      "./screenshots/page-2026-03-09T05-43-30-441Z.png",
      "./screenshots/page-2026-03-09T05-48-20-401Z.png",
      "./screenshots/page-2026-03-09T05-58-25-884Z.png",
      "./screenshots/page-2026-03-10T05-30-07-086Z.png",
      "./screenshots/page-2026-03-10T05-32-31-790Z.png",
      "./screenshots/page-2026-03-10T13-37-04-963Z.png",
    ];
    const result = smartDisplay(lines);
    expect(result.length).toBeLessThan(lines.length);
    // Should show pattern like page-*.png ×7
    expect(result.some(l => l.includes("×"))).toBe(true);
  });

  it("handles the exact user example", () => {
    const lines = [
      "./open-testers/node_modules/playwright-core/lib/server/chromium/appIcon.png",
      "./open-testers/node_modules/zod-to-json-schema/.github/CR_logotype-full-color.png",
      "./open-attachments/node_modules/zod-to-json-schema/.github/CR_logotype-full-color.png",
      "./open-attachments/dashboard/src/assets/hero.png",
      "./open-terminal/node_modules/zod-to-json-schema/.github/CR_logotype-full-color.png",
      "./open-emails/node_modules/zod-to-json-schema/.github/CR_logotype-full-color.png",
      "./open-todos/node_modules/zod-to-json-schema/.github/CR_logotype-full-color.png",
      "./open-todos/.playwright-mcp/page-2026-03-09T05-43-19-525Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-09T05-43-30-441Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-09T06-01-53-897Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-09T05-58-25-884Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-10T05-30-07-086Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-09T08-38-38-240Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-10T13-37-04-963Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-09T05-40-31-213Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-10T05-32-31-790Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-09T08-38-26-591Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-09T05-48-20-401Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-09T08-38-16-511Z.png",
      "./open-todos/.playwright-mcp/page-2026-03-09T05-34-10-009Z.png",
    ];
    const result = smartDisplay(lines);
    console.log("User example output:");
    for (const line of result) console.log(line);
    console.log(`\nCompressed: ${lines.length} → ${result.length} lines`);
    expect(result.length).toBeLessThan(lines.length);
  });
});
