// Renderer unit tests for `emails inbox pdf` (see pdf.ts).
//
// The renderer is pure and local: it reduces the body through the package's
// canonical html->text path (readableMessageText in format.ts), wraps it, and
// draws a paginated header+body layout with pdf-lib (pure-JS, no external
// service, no headless browser).
//
// The byte-level PDF contract asserted here comes from the design contract:
// %PDF magic header, %%EOF trailer, non-zero byte length, and a
// PDFDocument.load(bytes) round-trip, plus the body-reduction paths
// (text body, html-only fallback, empty '(no text content)' marker) and
// pagination across more than one page.
//
// Content assertions decode the page content streams through pdf-lib's OWN
// decoder (decodePDFRawStream — a deep import inside the installed package;
// pdf-lib has no public text-extraction API). Bun's built-in zlib rejects
// pdf-lib's pako-compressed streams (measured: invalid stored block lengths
// on every stream), so the test uses the package's own decoder rather than
// Bun.inflateSync. pdf-lib draws standard-font text as hex strings
// (<...> Tj), so the helper hex-decodes them.
//
// The decoder import MUST come from the same build as the top-level `pdf-lib`
// import: "pdf-lib" resolves to the CJS build, and mixing in the ESM decoder
// (pdf-lib/es/...) instantiates a second copy of the package whose PDFName
// class differs by identity — the decoder then misses the /Filter key and
// returns the still-compressed bytes. Both imports are CJS here.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { decodePDFRawStream } from "pdf-lib/cjs/core/streams/decode.js";
import type { MessageBodyLike } from "./format.js";
import { emailPdfBodyLines, emailPdfHeaderLines, renderEmailToPdfBytes, sanitizeForPdfText } from "./pdf.js";

function message(overrides: Partial<MessageBodyLike> = {}): MessageBodyLike {
  return {
    from: "sender@example.test",
    to: "me@example.test",
    subject: "Weekly digest",
    date: "2026-08-20T10:00:00Z",
    text: null,
    html: null,
    ...overrides,
  };
}

// Decode the text pdf-lib drew into the page content streams. Returns the
// concatenated decoded strings in draw order.
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const page of doc.getPages()) {
    const node = page.node as unknown as { Contents(): unknown };
    const contents = node.Contents() as {
      array?: unknown[];
      context?: { lookup(ref: unknown): unknown };
    } | null;
    for (const ref of contents?.array ?? []) {
      const stream = contents?.context?.lookup(ref) as { contents?: Uint8Array } | undefined;
      if (!stream || stream.contents === undefined) continue;
      const decoded = decodePDFRawStream(stream as Parameters<typeof decodePDFRawStream>[0]);
      if (!decoded) continue;
      parts.push(decodeDrawnText(new TextDecoder().decode(decoded.getBytes())));
    }
  }
  return parts.join("\n");
}

// pdf-lib draws standard-font text as hex strings (`<...> Tj`); literal
// `(text) Tj` also appears for some operators. Decode both forms.
function decodeDrawnText(content: string): string {
  const parts: string[] = [];
  const hex = /<([0-9a-fA-F]{2,})>\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = hex.exec(content)) !== null) {
    const hexValue = m[1]!;
    const bytes = new Uint8Array(hexValue.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(hexValue.slice(i * 2, i * 2 + 2), 16);
    }
    parts.push(new TextDecoder().decode(bytes));
  }
  const literal = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  while ((m = literal.exec(content)) !== null) {
    parts.push(m[1]!.replace(/\\([\\()])/g, "$1"));
  }
  return parts.join("\n");
}

beforeEach(() => {
  // nothing shared to reset; the renderer is pure
});

afterEach(() => {
  // nothing to tear down
});

describe("renderEmailToPdfBytes", () => {
  it("emits a PDF with the %PDF magic header", async () => {
    const bytes = await renderEmailToPdfBytes(message({ text: "Hello" }));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("ends with the %%EOF trailer", async () => {
    const bytes = await renderEmailToPdfBytes(message({ text: "Hello" }));
    const text = new TextDecoder().decode(bytes);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("produces a non-zero byte length", async () => {
    const bytes = await renderEmailToPdfBytes(message({ text: "Hello" }));
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("round-trips through PDFDocument.load", async () => {
    const bytes = await renderEmailToPdfBytes(message({ text: "Hello" }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("renders a text-only body through the canonical path", async () => {
    const bytes = await renderEmailToPdfBytes(message({ text: "Meeting moved to Thursday at noon." }));
    const drawn = await extractPdfText(bytes);
    expect(drawn).toContain("Meeting moved to Thursday at noon.");
  });

  it("falls back to an html-only body through the canonical reduction", async () => {
    const bytes = await renderEmailToPdfBytes(message({
      text: null,
      html: "<p>Invoice <b>due tomorrow</b></p><p>Second paragraph.</p>",
    }));
    const drawn = await extractPdfText(bytes);
    expect(drawn).toContain("Invoice due tomorrow");
    expect(drawn).toContain("Second paragraph.");
  });

  it("renders the '(no text content)' marker for an empty body", async () => {
    const bytes = await renderEmailToPdfBytes(message({ text: null, html: null }));
    const drawn = await extractPdfText(bytes);
    expect(drawn).toContain("(no text content)");
  });

  it("paginates a long body across more than one page", async () => {
    const paragraph = "The quick brown fox jumps over the lazy dog. ".repeat(60);
    const bytes = await renderEmailToPdfBytes(message({ text: paragraph.repeat(4) }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("does not throw on non-WinAnsi characters and sanitizes them", async () => {
    // pdf-lib's standard-font drawing THROWS on characters outside the WinAnsi
    // table (measured: `WinAnsi cannot encode "�" (0x1f600)`), and real email
    // bodies routinely carry emoji and curly quotes. The renderer must never
    // crash the verb on realistic input.
    const bytes = await renderEmailToPdfBytes(message({
      text: "Great \u{1F600} day — see you “there”!",
    }));
    const drawn = await extractPdfText(bytes);
    expect(drawn).toContain("Great ? day - see you \"there\"!");
    expect(drawn).not.toContain("\u{1F600}");
  });
});

describe("layout seams", () => {
  it("derives the header block from the message", () => {
    const lines = emailPdfHeaderLines(message({
      subject: "Quarterly report",
      from: "finance@example.test",
      to: "ops@example.test",
      cc: "cto@example.test",
      date: "2026-08-20T10:00:00Z",
    }));
    expect(lines[0]).toEqual({ text: "Quarterly report", bold: true });
    const flat = lines.map((line) => line.text).join("\n");
    expect(flat).toContain("From: finance@example.test");
    expect(flat).toContain("To: ops@example.test");
    expect(flat).toContain("CC: cto@example.test");
    expect(flat).toContain("Date: 2026-08-20T10:00:00Z");
  });

  it("uses '(no subject)' when the subject is blank", () => {
    const lines = emailPdfHeaderLines(message({ subject: "" }));
    expect(lines[0]!.text).toBe("(no subject)");
  });

  it("reduces the body through readableMessageText (text preferred, html fallback, empty marker)", () => {
    expect(emailPdfBodyLines(message({ text: "plain body", html: "<p>ignored</p>" })).map((l) => l.text)).toContain("plain body");
    expect(emailPdfBodyLines(message({ text: null, html: "<p>from html</p>" })).map((l) => l.text)).toContain("from html");
    expect(emailPdfBodyLines(message({ text: null, html: null })).map((l) => l.text)).toContain("(no text content)");
  });

  it("word-wraps long body lines", () => {
    const lines = emailPdfBodyLines(message({ text: "word ".repeat(200).trim() }));
    for (const line of lines) {
      expect(line.text.length).toBeLessThanOrEqual(120);
    }
    expect(lines.length).toBeGreaterThan(2);
  });
});

describe("sanitizeForPdfText", () => {
  it("keeps WinAnsi characters and maps common punctuation to ASCII", () => {
    expect(sanitizeForPdfText("a—b “c” ‘d’ e… f•g")).toBe("a-b \"c\" 'd' e... f-g");
  });

  it("replaces characters outside WinAnsi with a placeholder", () => {
    expect(sanitizeForPdfText("café \u{1F600} α")).toBe("café ? ?");
  });

  it("replaces tabs with a single space", () => {
    expect(sanitizeForPdfText("a\tb")).toBe("a b");
  });
});
