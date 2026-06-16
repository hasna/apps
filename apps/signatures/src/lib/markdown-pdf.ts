import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { renderMarkdown } from "./markdown-template.js";
import { getRenderedOutputPath } from "./files.js";

export interface RenderedSignatureField {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: string;
}

export interface MarkdownPdfResult {
  pdf_path: string;
  html_path: string;
  fields: RenderedSignatureField[];
}

interface LayoutCursor {
  pageIndex: number;
  x: number;
  y: number;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 64;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 64;
const BODY_SIZE = 11;
const LINE_HEIGHT = 17;

export async function renderMarkdownToPdf(input: {
  markdown: string;
  variables?: Record<string, unknown>;
  outputName?: string;
}): Promise<MarkdownPdfResult> {
  const rendered = await renderMarkdown(input.markdown, input.variables ?? {}, input.outputName ?? "document.md");
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const pages = [pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])];
  const cursor: LayoutCursor = { pageIndex: 0, x: MARGIN_X, y: PAGE_HEIGHT - MARGIN_TOP };
  const fields: RenderedSignatureField[] = [];

  const currentPage = () => pages[cursor.pageIndex]!;
  const ensureSpace = (needed = LINE_HEIGHT): void => {
    if (cursor.y - needed < MARGIN_BOTTOM) {
      pages.push(pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]));
      cursor.pageIndex = pages.length - 1;
      cursor.y = PAGE_HEIGHT - MARGIN_TOP;
    }
  };
  const drawLine = (text: string, options?: { size?: number; bold?: boolean; italic?: boolean; indent?: number }): void => {
    const size = options?.size ?? BODY_SIZE;
    const font = options?.bold ? bold : options?.italic ? italic : regular;
    const indent = options?.indent ?? 0;
    for (const line of wrapText(text, font.widthOfTextAtSize.bind(font), size, PAGE_WIDTH - MARGIN_X * 2 - indent)) {
      ensureSpace(size + 7);
      currentPage().drawText(line, {
        x: MARGIN_X + indent,
        y: cursor.y,
        size,
        font,
        color: rgb(0.09, 0.12, 0.16),
      });
      cursor.y -= size + 7;
    }
  };

  const lines = rendered.markdown.split(/\r?\n/);
  for (const rawLine of lines) {
    const anchorMatch = rawLine.match(/<span data-signature-anchor="([^"]+)"><\/span>/);
    const withoutAnchor = rawLine.replace(/<span data-signature-anchor="[^"]+"><\/span>/g, "____________________________");
    const line = stripMarkdownInline(withoutAnchor).trimEnd();

    if (!line.trim()) {
      cursor.y -= 9;
      continue;
    }

    if (line.startsWith("# ")) {
      cursor.y -= 8;
      drawLine(line.slice(2).trim(), { size: 24, bold: true });
      cursor.y -= 8;
    } else if (line.startsWith("## ")) {
      cursor.y -= 6;
      drawLine(line.slice(3).trim(), { size: 17, bold: true });
      cursor.y -= 5;
    } else if (line.startsWith("### ")) {
      cursor.y -= 4;
      drawLine(line.slice(4).trim(), { size: 14, bold: true });
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      drawLine(`• ${line.slice(2).trim()}`, { indent: 14 });
    } else if (/^\d+\.\s/.test(line)) {
      drawLine(line, { indent: 14 });
    } else if (line.startsWith("> ")) {
      drawLine(line.slice(2).trim(), { italic: true, indent: 14 });
    } else {
      drawLine(line);
    }

    if (anchorMatch) {
      const anchor = anchorMatch[1] || "signature";
      const fieldY = Math.max(5, ((PAGE_HEIGHT - (cursor.y + 30)) / PAGE_HEIGHT) * 100);
      fields.push({
        page: cursor.pageIndex + 1,
        x: (MARGIN_X / PAGE_WIDTH) * 100,
        y: fieldY,
        width: 36,
        height: 7,
        anchor,
      });
    }
  }

  const pdfPath = getRenderedOutputPath(input.outputName ?? "document.md", ".pdf");
  writeFileSync(pdfPath, await pdfDoc.save());
  return { pdf_path: pdfPath, html_path: rendered.html_path, fields };
}

export async function renderMarkdownFileToPdf(input: {
  path: string;
  variables?: Record<string, unknown>;
}): Promise<MarkdownPdfResult> {
  const { readFileSync } = await import("node:fs");
  return renderMarkdownToPdf({
    markdown: readFileSync(input.path, "utf-8"),
    variables: input.variables,
    outputName: basename(input.path),
  });
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function wrapText(
  text: string,
  widthOfTextAtSize: (text: string, size: number) => number,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}
