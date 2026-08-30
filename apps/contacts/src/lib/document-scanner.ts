import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

export interface DocumentScanResult {
  fields: Record<string, string>;
  raw_text: string;
  document_type: string;
  confidence: number;
}

export async function scanDocument(imageSource: string, docType?: string): Promise<DocumentScanResult> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set. Set it in ~/.secrets or environment to use document scanning.");
  }

  let imageData: string;

  // Check if it's already base64/data URI
  if (imageSource.startsWith("data:image/")) {
    imageData = imageSource;
  } else if (existsSync(imageSource)) {
    // Read file and convert to base64 data URI
    const buffer = readFileSync(imageSource);
    const ext = extname(imageSource).slice(1).toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
    imageData = `data:${mime};base64,${buffer.toString("base64")}`;
  } else if (/^[A-Za-z0-9+/=\n\r]+$/.test(imageSource.trim()) && imageSource.length > 100) {
    imageData = `data:image/jpeg;base64,${imageSource.trim()}`;
  } else {
    throw new Error(`Image source not found or invalid: ${imageSource.slice(0, 50)}...`);
  }

  const typeHint = docType ? ` This is a ${docType} document.` : "";
  const prompt = `Extract all text and structured data from this document image.${typeHint} Return a JSON object with these fields:
- document_type: detected type (passport, national_id, drivers_license, tax_document, medical_record, prescription, insurance_card, bank_statement, visa, certificate, contract, other)
- full_name: full name as shown
- date_of_birth: in YYYY-MM-DD format if visible
- document_number: main ID/document number
- issuing_country: country code or name
- issue_date: in YYYY-MM-DD format if visible
- expiry_date: in YYYY-MM-DD format if visible
- address: full address if visible
- nationality: if visible
- gender: if visible
- mrz_code: Machine Readable Zone text if this is a passport/ID with MRZ
- phone: any phone numbers visible
- email: any email addresses visible
- additional_fields: object with any other visible structured data
- raw_text: all visible text transcribed

Only include fields that are actually visible in the document. Return valid JSON only.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageData, detail: "high" } },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content || "";

  // Extract JSON from response (may be wrapped in markdown code block)
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { fields: {}, raw_text: content, document_type: docType || "unknown", confidence: 0.3 };
  }

  try {
    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    const { document_type, raw_text, additional_fields, ...mainFields } = parsed;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(mainFields)) {
      if (v && typeof v === "string") fields[k] = v;
    }
    if (additional_fields && typeof additional_fields === "object") {
      for (const [k, v] of Object.entries(additional_fields as Record<string, unknown>)) {
        if (v && typeof v === "string") fields[k] = v;
      }
    }
    return {
      fields,
      raw_text: raw_text || content,
      document_type: document_type || docType || "unknown",
      confidence: Object.keys(fields).length > 3 ? 0.9 : Object.keys(fields).length > 0 ? 0.7 : 0.3,
    };
  } catch {
    return { fields: {}, raw_text: content, document_type: docType || "unknown", confidence: 0.3 };
  }
}
