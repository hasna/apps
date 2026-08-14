import { execSync } from "child_process";

export interface PdfResult {
  text: string;
  pageCount: number;
  method: "pdftotext" | "fallback";
}

/**
 * Check if pdftotext (poppler-utils) is available on the system.
 */
function hasPdfToText(): boolean {
  try {
    execSync("which pdftotext", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract text from a PDF buffer using pdftotext (poppler-utils) if available,
 * otherwise falls back to a simple byte-level text scan.
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<PdfResult> {
  const bytes = new Uint8Array(buffer);

  // Verify PDF magic bytes
  const magic = String.fromCharCode(...bytes.slice(0, 4));
  if (magic !== "%PDF") {
    throw new Error("Not a valid PDF file");
  }

  // Count pages via %%EOF / /Type /Page markers
  const content = Buffer.from(bytes).toString("latin1");
  const pageCount = (content.match(/\/Type\s*\/Page[^s]/g) ?? []).length || 1;

  if (hasPdfToText()) {
    // Write to temp file, run pdftotext, read output
    const tmpIn = `/tmp/opencrawl-${Date.now()}.pdf`;
    const tmpOut = `/tmp/opencrawl-${Date.now()}.txt`;
    try {
      await Bun.write(tmpIn, bytes);
      execSync(`pdftotext -enc UTF-8 "${tmpIn}" "${tmpOut}"`, { timeout: 30_000 });
      const text = await Bun.file(tmpOut).text();
      return { text: text.trim(), pageCount, method: "pdftotext" };
    } finally {
      try { execSync(`rm -f "${tmpIn}" "${tmpOut}"`); } catch { /* ignore */ }
    }
  }

  // Fallback: extract readable ASCII strings from raw PDF bytes
  const text = extractRawText(content);
  return { text, pageCount, method: "fallback" };
}

/**
 * Extract readable text strings from raw PDF content (fallback when pdftotext unavailable).
 * Finds text inside BT...ET blocks (PDF text operators).
 */
function extractRawText(content: string): string {
  const parts: string[] = [];

  // Match text in parentheses within BT...ET blocks
  const btBlocks = content.match(/BT[\s\S]*?ET/g) ?? [];
  for (const block of btBlocks) {
    const strings = block.match(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g) ?? [];
    for (const s of strings) {
      const inner = s.slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\(.)/g, "$1");
      if (inner.trim().length > 0) parts.push(inner);
    }
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Detect if a response content-type is PDF.
 */
export function isPdf(contentType: string): boolean {
  return contentType.includes("application/pdf") || contentType.includes("application/x-pdf");
}
