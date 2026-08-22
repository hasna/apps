import { describe, expect, it } from "bun:test";
import { extractPdfText, isPdf } from "./pdf.js";

/**
 * Builds a minimal single- or multi-page PDF with a computed xref table, so
 * poppler's pdftotext (when installed) and the byte-level fallback both see a
 * well-formed file. Object 5 is a Helvetica font; each page references it.
 */
function buildPdf(pageCount: number): ArrayBuffer {
  const content = "BT /F1 12 Tf 72 720 Td (Hello PDF world) Tj ET";
  // Object layout: 1 catalog, 2 pages, 3..(2+pageCount) pages,
  // then one content stream and one font. Page dicts must reference the
  // correct object numbers or poppler rejects the file.
  const contentsIndex = 3 + pageCount;
  const fontIndex = 4 + pageCount;
  const objects: { body: string }[] = [
    { body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { body: `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${pageCount} >>` },
  ];
  for (let i = 0; i < pageCount; i++) {
    objects.push({
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontIndex} 0 R >> >> /Contents ${contentsIndex} 0 R >>`,
    });
  }
  objects.push({ body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` });
  objects.push({ body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" });

  const parts: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(new TextEncoder().encode(parts.join("")).length);
    parts.push(`${i + 1} 0 obj\n${objects[i]!.body}\nendobj\n`);
  }
  const xrefStart = new TextEncoder().encode(parts.join("")).length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  parts.push(
    xref,
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );
  return new TextEncoder().encode(parts.join("")).buffer;
}

describe("isPdf", () => {
  it("recognizes application/pdf and application/x-pdf", () => {
    expect(isPdf("application/pdf")).toBe(true);
    expect(isPdf("application/x-pdf")).toBe(true);
  });

  it("rejects html, docx and empty content types", () => {
    expect(isPdf("text/html")).toBe(false);
    expect(isPdf("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
    expect(isPdf("")).toBe(false);
  });
});

describe("extractPdfText", () => {
  it("throws for a buffer that does not start with the %PDF magic bytes", async () => {
    const notPdf = new TextEncoder().encode("not a pdf at all").buffer;
    await expect(extractPdfText(notPdf)).rejects.toThrow("Not a valid PDF file");
  });

  it("extracts text from a minimal single-page PDF and counts one page", async () => {
    const result = await extractPdfText(buildPdf(1));
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain("Hello PDF world");
    expect(["pdftotext", "fallback"]).toContain(result.method);
  });

  it("counts multiple pages from /Type /Page markers", async () => {
    const result = await extractPdfText(buildPdf(2));
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain("Hello PDF world");
  });
});
