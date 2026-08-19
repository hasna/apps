// demoHtml — the demo page contract shared by the local and reference pickers.

import { describe, expect, test } from "bun:test";
import { demoHtml } from "../src/demo.ts";

describe("demoHtml", () => {
  test("produces distinct titles for local and reference modes", () => {
    expect(demoHtml("/ui-picker.js", "local")).toContain("<title>ui-local demo — local picker</title>");
    expect(demoHtml("/ui-picker.reference.js", "reference")).toContain(
      "<title>ui-local demo — reference picker</title>",
    );
  });

  test("contains exactly three hero option variants", () => {
    const html = demoHtml("/ui-picker.js", "local");
    const options = html.match(/data-uidotsh-option="/g) ?? [];
    expect(options).toHaveLength(3);
    for (const name of ["Minimal", "Editorial", "Bold"]) {
      expect(html).toContain(`data-uidotsh-option="${name}"`);
    }
  });

  test("marks the active picker in the badge", () => {
    expect(demoHtml("/ui-picker.js", "local")).toContain("picker: local");
    expect(demoHtml("/ui-picker.reference.js", "reference")).toContain("picker: reference");
  });

  test("loads the requested script source in both modes", () => {
    expect(demoHtml("/ui-picker.js", "local")).toContain('<script src="/ui-picker.js">');
    expect(demoHtml("/ui-picker.reference.js", "reference")).toContain(
      '<script src="/ui-picker.reference.js">',
    );
    expect(demoHtml("/ui-picker.js", "local")).not.toContain("/ui-picker.reference.js");
    expect(demoHtml("/ui-picker.reference.js", "reference")).not.toContain('src="/ui-picker.js"');
  });
});
