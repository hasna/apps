export interface DocxResult {
  text: string;
  paragraphCount: number;
  method: "xml-parse";
}

export function isDocx(contentType: string): boolean {
  return contentType.includes("application/vnd.openxmlformats-officedocument.wordprocessingml") ||
    contentType.includes("application/docx");
}

export async function extractDocxText(buffer: ArrayBuffer): Promise<DocxResult> {
  // DOCX is a ZIP. Use DecompressionStream isn't for ZIP — we need to find word/document.xml
  // Bun doesn't have native ZIP, so use a simple approach:
  // Search for the XML content directly in the binary buffer
  const bytes = new Uint8Array(buffer);
  const text = Buffer.from(bytes).toString("binary");

  // Find word/document.xml content between PK entries
  // Look for the XML content after "word/document.xml" marker
  const xmlStart = text.indexOf("<?xml");
  if (xmlStart === -1) {
    // Try to find w:body directly
    const bodyStart = text.indexOf("<w:body");
    if (bodyStart === -1) return { text: "", paragraphCount: 0, method: "xml-parse" };

    // Extract readable text from w:t elements
    const wtMatches = text.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) ?? [];
    const extractedText = wtMatches
      .map(m => m.replace(/<[^>]+>/g, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const paragraphCount = (text.match(/<w:p[ >]/g) ?? []).length;
    return { text: extractedText, paragraphCount, method: "xml-parse" };
  }

  // Parse XML content
  const wtMatches = text.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) ?? [];
  const extractedText = wtMatches
    .map(m => m.replace(/<[^>]+>/g, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const paragraphCount = (text.match(/<w:p[ >]/g) ?? []).length;
  return { text: extractedText, paragraphCount, method: "xml-parse" };
}
