import { generateHtmlReport } from "./report.js";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

export interface PdfOptions {
  /** Output file path */
  outputPath: string;
  /** Page format (default: "A4") */
  format?: "A4" | "Letter" | "Legal" | "Tabloid";
  /** Include header with generation timestamp */
  headerTemplate?: string;
  /** Include footer with page numbers */
  footerTemplate?: string;
  /** Page margins */
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
}

const DEFAULT_FOOTER = `<div style="font-size:10px;color:#666;padding:8px 20px;border-top:1px solid #eee;display:flex;justify-content:space-between;width:100%;"><span>open-testers</span><span class="pageNumber"></span></div>`;

/**
 * Generate a PDF report for a test run.
 * Renders the HTML report using Playwright's page.pdf() and saves to disk.
 */
export async function generatePdfReport(
  runId: string,
  options: PdfOptions,
): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const html = generateHtmlReport(runId);
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const pdfPath = options.outputPath;

    // Ensure parent directory exists
    const dir = dirname(pdfPath);
    mkdirSync(dir, { recursive: true });

    await page.pdf({
      path: pdfPath,
      format: options.format ?? "A4",
      printBackground: true,
      margin: {
        top: options.margin?.top ?? "20mm",
        right: options.margin?.right ?? "15mm",
        bottom: options.margin?.bottom ?? "20mm",
        left: options.margin?.left ?? "15mm",
      },
      footerTemplate: options.footerTemplate ?? DEFAULT_FOOTER,
      displayHeaderFooter: !!options.footerTemplate,
    });

    return pdfPath;
  } finally {
    await browser.close();
  }
}

/**
 * Save the HTML report to a file.
 */
export function saveHtmlReport(runId: string, outputPath: string): string {
  const html = generateHtmlReport(runId);
  const dir = dirname(outputPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, html, "utf-8");
  return outputPath;
}
