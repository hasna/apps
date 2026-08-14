import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { renderMarkdown } from "./markdown-template.js";
import { getRenderedOutputPath } from "./files.js";
import type { RecipientStatus, SignerType } from "../types/index.js";

export interface RenderedSignatureField {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: string;
  signer_type?: SignerType;
  role?: string;
  assigned_to?: string;
  signing_order?: number;
  parallel_group?: number;
  required?: number;
  recipient_status?: RecipientStatus;
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
const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
];
const BOLD_FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
];
const ITALIC_FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
];

export async function renderMarkdownToPdf(input: {
  markdown: string;
  variables?: Record<string, unknown>;
  outputName?: string;
}): Promise<MarkdownPdfResult> {
  const rendered = await renderMarkdown(input.markdown, input.variables ?? {}, input.outputName ?? "document.md");
  const pdfDoc = await PDFDocument.create();
  const { regular, bold, italic } = await loadFonts(pdfDoc);
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
    const anchorMatch = rawLine.match(/<span\b([^>]*\bdata-signature-anchor="[^"]+"[^>]*)><\/span>/);
    const anchorAttrs = anchorMatch ? parseSignatureAnchorAttributes(anchorMatch[1] ?? "") : undefined;
    const withoutAnchor = rawLine.replace(/<span\b[^>]*\bdata-signature-anchor="[^"]+"[^>]*><\/span>/g, "____________________________");
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

    if (anchorAttrs) {
      const fieldY = Math.max(5, ((PAGE_HEIGHT - (cursor.y + 30)) / PAGE_HEIGHT) * 100);
      fields.push({
        page: cursor.pageIndex + 1,
        x: (MARGIN_X / PAGE_WIDTH) * 100,
        y: fieldY,
        width: 36,
        height: 7,
        ...anchorAttrs,
      });
    }
  }

  const pdfPath = getRenderedOutputPath(input.outputName ?? "document.md", ".pdf");
  writeFileSync(pdfPath, await pdfDoc.save());
  return { pdf_path: pdfPath, html_path: rendered.html_path, fields };
}

function parseSignatureAnchorAttributes(attrs: string): Pick<RenderedSignatureField, "anchor" | "signer_type" | "role" | "assigned_to" | "signing_order" | "parallel_group" | "required" | "recipient_status"> {
  const values: Record<string, string> = {};
  for (const match of attrs.matchAll(/\b(data-[a-z-]+)="([^"]*)"/g)) {
    values[match[1]!] = unescapeAttribute(match[2] ?? "");
  }
  return {
    anchor: values["data-signature-anchor"] || "signature",
    signer_type: parseSignerType(values["data-signer-type"]),
    role: values["data-signature-role"] || undefined,
    assigned_to: values["data-assigned-to"] || undefined,
    signing_order: parseOptionalInt(values["data-signing-order"]),
    parallel_group: parseOptionalInt(values["data-parallel-group"]),
    required: parseOptionalInt(values["data-required"]),
    recipient_status: parseRecipientStatus(values["data-recipient-status"]),
  };
}

function parseSignerType(value: string | undefined): SignerType | undefined {
  if (!value) return undefined;
  if (value === "human" || value === "agent") return value;
  return undefined;
}

function parseRecipientStatus(value: string | undefined): RecipientStatus | undefined {
  if (!value) return undefined;
  if (value === "pending" || value === "available" || value === "viewed" || value === "signed" || value === "declined" || value === "expired" || value === "failed" || value === "skipped") return value;
  return undefined;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function unescapeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export async function renderMarkdownFileToPdf(input: {
  path: string;
  variables?: Record<string, unknown>;
}): Promise<MarkdownPdfResult> {
  return renderMarkdownToPdf({
    markdown: readFileSync(input.path, "utf-8"),
    variables: input.variables,
    outputName: basename(input.path),
  });
}

async function loadFonts(pdfDoc: PDFDocument) {
  const regularPath = firstExistingPath(FONT_CANDIDATES);
  if (!regularPath) {
    return {
      regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
      bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    };
  }

  pdfDoc.registerFontkit(fontkit);
  const boldPath = firstExistingPath(BOLD_FONT_CANDIDATES) ?? regularPath;
  const italicPath = firstExistingPath(ITALIC_FONT_CANDIDATES) ?? regularPath;
  return {
    regular: await pdfDoc.embedFont(readFileSync(regularPath)),
    bold: await pdfDoc.embedFont(readFileSync(boldPath)),
    italic: await pdfDoc.embedFont(readFileSync(italicPath)),
  };
}

function firstExistingPath(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
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
