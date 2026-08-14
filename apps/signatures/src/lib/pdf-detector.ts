import { readFileSync, existsSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import type { FieldType } from "../types/index.js";
import { getSetting } from "../db/settings.js";
import { renderPageToBase64, getPageCount } from "./pdf-renderer.js";

export interface DetectedField {
  page: number;
  x: number;        // percentage 0-100
  y: number;        // percentage 0-100
  width: number;    // percentage 0-100
  height: number;   // percentage 0-100
  field_type: FieldType;
  label?: string;
  confidence?: number;
  detected: 1;
}

const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
const DEFAULT_CEREBRAS_MODEL = "qwen-2.5-vrt-32b";

const DETECTION_PROMPT = `You are analyzing a PDF document page to identify form fields that need to be filled or signed.

Identify ALL of the following field types visible on this page:
- signature: A box/line/area where a signature should go. Look for "Signature", "Sign here", "_____", boxes with "X", dotted lines
- initial: Where initials go. Look for "Initials", "Init.", small boxes
- date: Date fields. Look for "Date", "Dated", date format placeholders like __/__/____
- text: Text input fields. Look for blank lines, boxes with labels
- checkbox: Checkboxes

For each field found, return a JSON array with objects:
{
  "field_type": "signature|initial|date|text|checkbox",
  "label": "the label text near this field if any",
  "x": <percentage 0-100 from left edge of page>,
  "y": <percentage 0-100 from top edge of page>,
  "width": <percentage of page width>,
  "height": <percentage of page height>,
  "confidence": <0.0-1.0>
}

Return ONLY valid JSON array, no explanation. If no fields found, return [].`;

function getCerebrasApiKey(): string | null {
  return process.env["CEREBRAS_API_KEY"] ?? getSetting("cerebras_api_key");
}

function getCerebrasModel(): string {
  return (
    process.env["CEREBRAS_MODEL"] ??
    getSetting("cerebras_model") ??
    DEFAULT_CEREBRAS_MODEL
  );
}

export function isCerebrasConfigured(): boolean {
  return !!getCerebrasApiKey();
}

interface CerebrasFieldRaw {
  field_type?: string;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  confidence?: number;
}

async function callCerebrasVision(
  base64Image: string,
  model: string,
  apiKey: string
): Promise<CerebrasFieldRaw[]> {
  const response = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: DETECTION_PROMPT,
            },
          ],
        },
      ],
      max_tokens: 2048,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Cerebras API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? "[]";

  // Strip markdown code fences if present
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as CerebrasFieldRaw[];
  } catch {
    return [];
  }
}

const VALID_FIELD_TYPES = new Set<string>([
  "signature",
  "initial",
  "date",
  "text",
  "checkbox",
]);

function rawToDetectedField(
  raw: CerebrasFieldRaw,
  page: number
): DetectedField | null {
  const ft = raw.field_type ?? "signature";
  if (!VALID_FIELD_TYPES.has(ft)) return null;

  const x = typeof raw.x === "number" ? Math.max(0, Math.min(100, raw.x)) : 10;
  const y = typeof raw.y === "number" ? Math.max(0, Math.min(100, raw.y)) : 80;
  const w = typeof raw.width === "number" ? Math.max(1, Math.min(100, raw.width)) : 30;
  const h = typeof raw.height === "number" ? Math.max(1, Math.min(100, raw.height)) : 8;

  return {
    page,
    x,
    y,
    width: w,
    height: h,
    field_type: ft as FieldType,
    label: raw.label,
    confidence: raw.confidence,
    detected: 1,
  };
}

/**
 * Detect fields on a single page using Cerebras vision.
 */
export async function detectSignatureFieldsOnPage(
  filePath: string,
  page: number
): Promise<DetectedField[]> {
  const apiKey = getCerebrasApiKey();
  if (!apiKey) {
    return detectFieldsHeuristic(filePath);
  }

  const model = getCerebrasModel();

  try {
    const base64 = await renderPageToBase64(filePath, page);
    if (!base64) {
      // No image rendering available — fall back to heuristics
      return detectFieldsHeuristic(filePath);
    }

    const rawFields = await callCerebrasVision(base64, model, apiKey);
    const fields: DetectedField[] = [];
    for (const raw of rawFields) {
      const f = rawToDetectedField(raw, page);
      if (f) fields.push(f);
    }
    return fields;
  } catch (err) {
    console.error(`[pdf-detector] Cerebras error on page ${page}, falling back to heuristics:`, err instanceof Error ? err.message : err);
    return detectFieldsHeuristic(filePath);
  }
}

/**
 * Detect signature fields across the entire PDF.
 * Uses Cerebras AI if configured, otherwise falls back to heuristics.
 */
export async function detectSignatureFields(
  filePath: string
): Promise<DetectedField[]> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const apiKey = getCerebrasApiKey();

  if (apiKey) {
    // Cerebras path: render each page and detect
    try {
      const pageCount = await getPageCount(filePath);
      const model = getCerebrasModel();
      const allFields: DetectedField[] = [];

      for (let page = 1; page <= pageCount; page++) {
        const base64 = await renderPageToBase64(filePath, page);
        if (!base64) {
          // Can't render — fall through to heuristics
          return detectFieldsHeuristic(filePath);
        }

        const rawFields = await callCerebrasVision(base64, model, apiKey);
        for (const raw of rawFields) {
          const f = rawToDetectedField(raw, page);
          if (f) allFields.push(f);
        }
      }

      // If Cerebras found nothing, add a heuristic fallback
      if (allFields.length === 0) {
        return detectFieldsHeuristic(filePath);
      }

      return allFields;
    } catch (err) {
      console.error("[pdf-detector] Cerebras detection failed, falling back to heuristics:", err instanceof Error ? err.message : err);
      return detectFieldsHeuristic(filePath);
    }
  }

  // No Cerebras key — use heuristics
  return detectFieldsHeuristic(filePath);
}

/**
 * Original heuristic-based field detector.
 * Used as fallback when Cerebras is unavailable.
 */
export async function detectFieldsHeuristic(
  filePath: string
): Promise<DetectedField[]> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const pdfBytes = readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const detected: DetectedField[] = [];

  // Check AcroForm fields
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  for (const field of fields) {
    const fieldName = field.getName().toLowerCase();
    const widgets = field.acroField.getWidgets();

    for (const widget of widgets) {
      const rect = widget.getRectangle();
      const pageRef = widget.P();

      let pageIndex = 0;
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (!page) continue;
        try {
          if (pageRef && page.ref === pageRef) {
            pageIndex = i;
            break;
          }
        } catch {
          // fallback: assume first page
        }
      }

      const page = pages[pageIndex];
      if (!page) continue;

      const { width: pageWidth, height: pageHeight } = page.getSize();

      let fieldType: FieldType = "signature";
      if (fieldName.includes("initial") || fieldName.includes("init")) {
        fieldType = "initial";
      } else if (fieldName.includes("date")) {
        fieldType = "date";
      } else if (fieldName.includes("check") || fieldName.includes("agree")) {
        fieldType = "checkbox";
      } else if (
        fieldName.includes("text") ||
        fieldName.includes("name") ||
        fieldName.includes("email")
      ) {
        fieldType = "text";
      }

      detected.push({
        page: pageIndex + 1,
        x: (rect.x / pageWidth) * 100,
        y: ((pageHeight - rect.y - rect.height) / pageHeight) * 100,
        width: (rect.width / pageWidth) * 100,
        height: (rect.height / pageHeight) * 100,
        field_type: fieldType,
        label: field.getName(),
        detected: 1,
      });
    }
  }

  // If no AcroForm fields, add heuristic: bottom-of-page signature area
  if (detected.length === 0) {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) continue;

      detected.push({
        page: i + 1,
        x: 10,
        y: 80,
        width: 40,
        height: 8,
        field_type: "signature",
        label: `Signature (Page ${i + 1})`,
        detected: 1,
      });

      // Only auto-detect on last page by default
      break;
    }
  }

  return detected;
}
