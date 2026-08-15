import { describe, test, expect } from "bun:test";
import { compareSnapshots, extractElements } from "./dom-mutation.js";

describe("DOM mutation detection (OPE9-00233)", () => {
  describe("compareSnapshots", () => {
    test("detects added elements", () => {
      const before = '<body><div id="root"><p>hello</p></div></body>';
      const after = '<body><div id="root"><p>hello</p><span id="new">world</span></div></body>';
      const changes = compareSnapshots(before, after);
      expect(changes.some((c) => c.startsWith("Added:"))).toBe(true);
    });

    test("detects removed elements", () => {
      const before = '<body><div id="root"><p>hello</p></div></body>';
      const after = '<body><div id="root"></div></body>';
      const changes = compareSnapshots(before, after);
      expect(changes.some((c) => c.startsWith("Removed:"))).toBe(true);
    });

    test("returns empty for identical snapshots", () => {
      const html = '<body><div id="root"><p>hello</p></div></body>';
      const changes = compareSnapshots(html, html);
      expect(changes).toHaveLength(0);
    });
  });

  describe("extractElements", () => {
    test("extracts elements by id", () => {
      const els = extractElements('<div id="main"><span id="title">hi</span></div>');
      expect(els["#main"]).toBeDefined();
      expect(els["#title"]).toBeDefined();
    });

    test("extracts elements by class when no id", () => {
      const els = extractElements('<div class="container active"><p></p></div>');
      expect(els["div.container"]).toBeDefined();
    });

    test("handles elements with no id or class", () => {
      const els = extractElements("<p><em></em></p>");
      expect(els["p"]).toBeDefined();
      expect(els["em"]).toBeDefined();
    });
  });
});
