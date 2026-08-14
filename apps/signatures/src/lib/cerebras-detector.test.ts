import { describe, test, expect, mock, afterEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

describe("isCerebrasConfigured", () => {
  test("returns false when no API key", async () => {
    delete process.env["CEREBRAS_API_KEY"];
    const { isCerebrasConfigured } = await import("./pdf-detector.js");
    expect(isCerebrasConfigured()).toBe(false);
  });

  test("returns true when CEREBRAS_API_KEY is set", async () => {
    process.env["CEREBRAS_API_KEY"] = "test-key";
    // Clear module cache to re-evaluate
    const mod = await import("./pdf-detector.js");
    expect(mod.isCerebrasConfigured()).toBe(true);
    delete process.env["CEREBRAS_API_KEY"];
  });
});

describe("detectFieldsHeuristic", () => {
  test("returns fallback field for a PDF without AcroForm fields", async () => {
    // Use a simple valid PDF created with pdf-lib
    const { PDFDocument } = await import("pdf-lib");
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const tmpPath = join(tmpdir(), "test-detect.pdf");
    writeFileSync(tmpPath, bytes);

    const { detectFieldsHeuristic } = await import("./pdf-detector.js");
    const fields = await detectFieldsHeuristic(tmpPath);

    expect(fields.length).toBeGreaterThan(0);
    expect(fields[0]!.field_type).toBe("signature");
    expect(fields[0]!.detected).toBe(1);

    unlinkSync(tmpPath);
  });
});

describe("detectSignatureFields fallback", () => {
  test("falls back to heuristic when no Cerebras key", async () => {
    delete process.env["CEREBRAS_API_KEY"];

    const { PDFDocument } = await import("pdf-lib");
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const tmpPath = join(tmpdir(), "test-detect-fallback.pdf");
    writeFileSync(tmpPath, bytes);

    const { detectSignatureFields } = await import("./pdf-detector.js");
    const fields = await detectSignatureFields(tmpPath);

    expect(fields.length).toBeGreaterThan(0);

    unlinkSync(tmpPath);
  });
});
