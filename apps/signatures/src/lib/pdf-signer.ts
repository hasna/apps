import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getSignedOutputPath } from "./files.js";
import type { SignaturePlacement, Signature } from "../types/index.js";

export interface SigningInput {
  document_path: string;
  document_name: string;
  placements: Array<{
    placement: SignaturePlacement;
    signature: Signature;
  }>;
}

export interface SigningResult {
  output_path: string;
  pages_signed: number[];
}

/**
 * Stamp signatures onto a PDF at the specified positions.
 * Coordinates are percentage-based (0-100 of page dimensions).
 */
export async function signPdf(input: SigningInput): Promise<SigningResult> {
  if (!existsSync(input.document_path)) {
    throw new Error(`Document not found: ${input.document_path}`);
  }

  const pdfBytes = readFileSync(input.document_path);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const pagesSigned = new Set<number>();

  for (const { placement, signature } of input.placements) {
    const pageIndex = placement.page - 1; // Convert 1-based to 0-based
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(
        `Page ${placement.page} out of range (document has ${pages.length} pages)`
      );
    }

    const page = pages[pageIndex];
    if (!page) continue;

    const { width: pageWidth, height: pageHeight } = page.getSize();

    // Convert percentage to actual coordinates
    const x = (placement.x / 100) * pageWidth;
    // PDF coordinates are bottom-up, convert from top-down percentage
    const yFromTop = (placement.y / 100) * pageHeight;
    const y = pageHeight - yFromTop;

    const sigWidth = placement.width
      ? (placement.width / 100) * pageWidth
      : pageWidth * 0.25;
    const sigHeight = placement.height
      ? (placement.height / 100) * pageHeight
      : pageHeight * 0.08;

    if (
      (signature.type === "image" || signature.type === "drawing") &&
      signature.image_path
    ) {
      if (!existsSync(signature.image_path)) {
        throw new Error(`Signature image not found: ${signature.image_path}`);
      }
      const imgBytes = readFileSync(signature.image_path);
      let img;
      if (signature.image_path.endsWith(".png")) {
        img = await pdfDoc.embedPng(imgBytes);
      } else if (
        signature.image_path.endsWith(".jpg") ||
        signature.image_path.endsWith(".jpeg")
      ) {
        img = await pdfDoc.embedJpg(imgBytes);
      } else {
        // Default to PNG for SVG or unknown
        img = await pdfDoc.embedPng(imgBytes);
      }

      page.drawImage(img, {
        x,
        y: y - sigHeight,
        width: sigWidth,
        height: sigHeight,
      });
    } else if (signature.type === "text" || !signature.image_path) {
      // Draw text signature
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
      const text = signature.text_value ?? signature.name;
      const fontSize = Math.min(signature.font_size ?? 24, sigHeight * 0.7);

      // Parse color hex to rgb
      const [r, g, b] = hexToRgb(signature.color ?? "#000000");

      page.drawText(text, {
        x,
        y: y - sigHeight / 2,
        size: fontSize,
        font,
        color: rgb(r, g, b),
      });
    }

    pagesSigned.add(placement.page);
  }

  const outputPath = getSignedOutputPath(input.document_name);
  const outputBytes = await pdfDoc.save();
  writeFileSync(outputPath, outputBytes);

  return {
    output_path: outputPath,
    pages_signed: Array.from(pagesSigned).sort((a, b) => a - b),
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return [
    isNaN(r) ? 0 : r,
    isNaN(g) ? 0 : g,
    isNaN(b) ? 0 : b,
  ];
}
