import { describe, expect, it } from "bun:test";
import { extractDocxText, isDocx } from "./docx.js";

describe("isDocx", () => {
  it("recognizes the standard docx content type", () => {
    expect(
      isDocx("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    ).toBe(true);
  });

  it("recognizes the application/docx shorthand", () => {
    expect(isDocx("application/docx")).toBe(true);
  });

  it("rejects html, pdf and generic content types", () => {
    expect(isDocx("text/html")).toBe(false);
    expect(isDocx("application/pdf")).toBe(false);
    expect(isDocx("")).toBe(false);
  });
});

describe("extractDocxText", () => {
  function docxBytes(innerXml: string): ArrayBuffer {
    // A real DOCX is a zip; this module scans the raw bytes, so the fixture
    // only needs the XML markers it looks for.
    return new TextEncoder().encode(innerXml).buffer;
  }

  it("returns empty text when neither an xml marker nor w:body exists", async () => {
    const result = await extractDocxText(docxBytes("PK\x03\x04 gibberish, no xml here"));
    expect(result.text).toBe("");
    expect(result.paragraphCount).toBe(0);
  });

  it("extracts text from w:t elements and counts w:p paragraphs", async () => {
    const xml = `<?xml version="1.0"?><w:document><w:body>
      <w:p><w:r><w:t>Hello world</w:t></w:r></w:p>
      <w:p><w:r><w:t>Second</w:t></w:r></w:p>
    </w:body></w:document>`;
    const result = await extractDocxText(docxBytes(xml));
    expect(result.text).toContain("Hello world");
    expect(result.text).toContain("Second");
    expect(result.paragraphCount).toBe(2);
    expect(result.method).toBe("xml-parse");
  });

  it("collapses runs into whitespace-joined single line", async () => {
    const xml = `<?xml version="1.0"?><w:document><w:body>
      <w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:t>Beta</w:t></w:r></w:p>
    </w:body></w:document>`;
    const result = await extractDocxText(docxBytes(xml));
    expect(result.text).toBe("Alpha Beta");
  });

  it("handles the w:body-only path without an xml declaration", async () => {
    const xml = `<w:body><w:p><w:r><w:t>Solo body</w:t></w:r></w:p></w:body>`;
    const result = await extractDocxText(docxBytes(xml));
    expect(result.text).toBe("Solo body");
    expect(result.paragraphCount).toBe(1);
  });

  it("returns empty text when w:body exists but no w:t elements do", async () => {
    const xml = `<w:body><w:p><w:r/></w:p></w:body>`;
    const result = await extractDocxText(docxBytes(xml));
    expect(result.text).toBe("");
    expect(result.paragraphCount).toBe(1);
  });
});
