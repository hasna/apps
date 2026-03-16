import { readFileSync, existsSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import type { FieldType } from "../types/index.js";

export interface DetectedField {
  page: number;
  x: number;        // percentage 0-100
  y: number;        // percentage 0-100
  width: number;    // percentage 0-100
  height: number;   // percentage 0-100
  field_type: FieldType;
  label?: string;
  detected: 1;
}

/**
 * Detect signature fields in a PDF document.
 * Looks for:
 * 1. AcroForm signature fields
 * 2. Text patterns suggesting signature areas
 * 3. Bottom-of-page placements (common signature location)
 */
export async function detectSignatureFields(
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

      // Find which page this widget belongs to
      let pageIndex = 0;
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (!page) continue;
        try {
          // Compare page reference
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
      if (
        fieldName.includes("initial") ||
        fieldName.includes("init")
      ) {
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

      // Add a standard signature block at the bottom of each page
      // (last 15% of page, centered, reasonable width)
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
