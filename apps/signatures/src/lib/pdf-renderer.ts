import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

function getCacheDir(): string {
  const dir = join(homedir(), ".signatures", "cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function docHash(filePath: string): string {
  try {
    const buf = readFileSync(filePath);
    return createHash("sha256").update(buf).digest("hex").slice(0, 16);
  } catch {
    return createHash("sha256").update(filePath).digest("hex").slice(0, 16);
  }
}

/**
 * Render a single PDF page to a PNG buffer using Ghostscript.
 * Returns null if GS is unavailable or fails.
 */
export async function renderPageToPng(
  filePath: string,
  pageNumber: number,
  dpi = 150
): Promise<Buffer | null> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const cacheDir = getCacheDir();
  const hash = docHash(filePath);
  const cachePath = join(cacheDir, `${hash}-p${pageNumber}-${dpi}.png`);

  if (existsSync(cachePath)) {
    return readFileSync(cachePath);
  }

  try {
    const result = await Bun.$`gs -dNOPAUSE -dBATCH -sDEVICE=png16m -r${dpi} -dFirstPage=${pageNumber} -dLastPage=${pageNumber} -sOutputFile=${cachePath} ${filePath}`
      .quiet()
      .nothrow();

    if (result.exitCode === 0 && existsSync(cachePath)) {
      return readFileSync(cachePath);
    }
  } catch {
    // Ghostscript not available
  }

  return null;
}

/**
 * Render a PDF page to a base64 PNG string.
 * Returns null if rendering is unavailable.
 */
export async function renderPageToBase64(
  filePath: string,
  pageNumber: number,
  dpi = 150
): Promise<string | null> {
  const buf = await renderPageToPng(filePath, pageNumber, dpi);
  if (!buf) return null;
  return buf.toString("base64");
}

/**
 * Get the number of pages in a PDF using pdf-lib.
 */
export async function getPageCount(filePath: string): Promise<number> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const { PDFDocument } = await import("pdf-lib");
  const bytes = readFileSync(filePath);
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}
