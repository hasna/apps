/**
 * Local email-to-PDF rendering for `emails inbox pdf <id>`.
 *
 * Package-owned renderer, sibling of format.ts. The PDF is produced entirely on
 * the machine with pdf-lib (pure-JS, zero native deps, no external rendering
 * service, no headless browser; standard Helvetica fonts are built into
 * pdf-lib, so @pdf-lib/fontkit is NOT required). Full HTML fidelity is out of
 * scope and deliberately matches the TUI's existing reduction: the body is
 * reduced through the package's canonical html->text path
 * (readableMessageText in format.ts) — text preferred, html-only falls back
 * via htmlToReadableText, empty bodies render the '(no text content)' marker.
 *
 * Layout: a Subject/From/To/CC/Date header block followed by word-wrapped body
 * paragraphs, paginated across pages with pdf-lib text drawing.
 *
 * Text is sanitized before drawing: pdf-lib's standard-font drawing throws on
 * characters outside the WinAnsi table (measured: `WinAnsi cannot encode` on a
 * single emoji), and real email bodies routinely carry emoji and curly quotes.
 * The renderer must never crash the verb on realistic input, so non-WinAnsi
 * characters are mapped to a placeholder.
 */
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { readableMessageText, wrapText, type MessageBodyLike } from "./format.js";

export const PDF_PAGE_WIDTH = 612; // US Letter
export const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN = 50;
const PDF_BODY_FONT_SIZE = 11;
const PDF_HEADER_FONT_SIZE = 10.5;
const PDF_SUBJECT_FONT_SIZE = 13;
const PDF_LINE_HEIGHT = 16;
const PDF_HEADER_LINE_HEIGHT = 14;
const PDF_HEADER_BODY_GAP = 14;
// Helvetica average advance for lowercase-heavy text is ~0.55em; the wrap is a
// character-count approximation, exactly like the TUI's, not a glyph metric.
const PDF_MAX_BODY_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const PDF_CHARS_PER_LINE = Math.floor(PDF_MAX_BODY_WIDTH / (PDF_BODY_FONT_SIZE * 0.55));

const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.36, 0.36, 0.36);

/** One line of the drawn layout; `bold` selects the header emphasis face. */
export interface PdfLayoutLine {
  text: string;
  bold: boolean;
}

const PUNCTUATION_TO_ASCII: Record<string, string> = {
  "—": "-", // em dash
  "–": "-", // en dash
  "“": "\"", // left double quote
  "”": "\"", // right double quote
  "‘": "'", // left single quote
  "’": "'", // right single quote
  "…": "...", // ellipsis
  "•": "-", // bullet
};

/**
 * Map text to the WinAnsi subset pdf-lib's standard fonts can draw. Every
 * character outside [0x20-0x7E] ∪ [0xA0-0xFF] (plus '\n') is replaced with '?'
 * so a real email body can never crash the renderer.
 */
export function sanitizeForPdfText(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "\n") {
      out += char;
      continue;
    }
    if (char === "\t") {
      out += " ";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    const mapped = PUNCTUATION_TO_ASCII[char];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = char.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7E) || (code >= 0xa0 && code <= 0xff)) {
      out += char;
    } else {
      out += "?";
    }
  }
  return out;
}

// Wrap one header value (label on the first line only) so a long subject or
// address list cannot overflow the page width.
function headerEntry(label: string, value: string, width: number): string[] {
  const wrapped = wrapText(value, width, Number.MAX_SAFE_INTEGER);
  return wrapped.map((text, index) => (index === 0 && label ? `${label} ${text}` : text));
}

/** Header block: subject (bold), From/To/CC/Date (muted). */
export function emailPdfHeaderLines(input: MessageBodyLike): PdfLayoutLine[] {
  const subject = sanitizeForPdfText(input.subject?.trim() || "(no subject)");
  const from = sanitizeForPdfText(input.from || "-");
  const to = sanitizeForPdfText(input.to || "-");
  const cc = input.cc ? sanitizeForPdfText(input.cc) : "";
  const date = sanitizeForPdfText(input.date || "-");
  const lines: PdfLayoutLine[] = [
    ...headerEntry("", subject, PDF_CHARS_PER_LINE + 12).map((text) => ({ text, bold: true })),
    ...headerEntry("From:", from, PDF_CHARS_PER_LINE).map((text) => ({ text, bold: false })),
    ...headerEntry("To:", to, PDF_CHARS_PER_LINE).map((text) => ({ text, bold: false })),
    ...(cc ? headerEntry("CC:", cc, PDF_CHARS_PER_LINE).map((text) => ({ text, bold: false })) : []),
    ...headerEntry("Date:", date, PDF_CHARS_PER_LINE).map((text) => ({ text, bold: false })),
  ];
  return lines;
}

/**
 * Body lines: the message body reduced through the canonical html->text path
 * and word-wrapped. Returns one entry per drawn line; blank lines carry the
 * paragraph spacing.
 */
export function emailPdfBodyLines(input: MessageBodyLike): PdfLayoutLine[] {
  const body = readableMessageText(input.text, input.html);
  const sanitized = sanitizeForPdfText(body);
  const wrapped = wrapText(sanitized, PDF_CHARS_PER_LINE, Number.MAX_SAFE_INTEGER);
  return wrapped.map((text) => ({ text, bold: false }));
}

/** Header block, gap, then body lines — the full drawn sequence. */
export function emailPdfLines(input: MessageBodyLike): PdfLayoutLine[] {
  return [...emailPdfHeaderLines(input), ...emailPdfBodyLines(input)];
}

function drawLine(
  page: ReturnType<PDFDocument["addPage"]>,
  line: PdfLayoutLine,
  font: PDFFont,
  boldFont: PDFFont,
  y: number,
): number {
  if (line.bold) {
    page.drawText(line.text, {
      x: PDF_MARGIN,
      y,
      size: PDF_SUBJECT_FONT_SIZE,
      font: boldFont,
      color: INK,
    });
    return y - PDF_HEADER_LINE_HEIGHT;
  }
  page.drawText(line.text, {
    x: PDF_MARGIN,
    y,
    size: PDF_HEADER_FONT_SIZE,
    font,
    color: MUTED,
  });
  return y - PDF_HEADER_LINE_HEIGHT;
}

/**
 * Render a message to a local PDF document's bytes. Deterministic for a given
 * input (used by the CLI verb and by tests).
 */
export async function renderEmailToPdfBytes(input: MessageBodyLike): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  let y = PDF_PAGE_HEIGHT - PDF_MARGIN;

  const header = emailPdfHeaderLines(input);
  for (const line of header) {
    if (y - PDF_HEADER_LINE_HEIGHT < PDF_MARGIN) {
      page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
      y = PDF_PAGE_HEIGHT - PDF_MARGIN;
    }
    y = drawLine(page, line, font, boldFont, y);
  }
  y -= PDF_HEADER_BODY_GAP;

  const body = emailPdfBodyLines(input);
  for (const line of body) {
    if (y - PDF_LINE_HEIGHT < PDF_MARGIN) {
      page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
      y = PDF_PAGE_HEIGHT - PDF_MARGIN;
    }
    page.drawText(line.text, {
      x: PDF_MARGIN,
      y,
      size: PDF_BODY_FONT_SIZE,
      font,
      color: INK,
    });
    y -= PDF_LINE_HEIGHT;
  }

  return doc.save();
}
