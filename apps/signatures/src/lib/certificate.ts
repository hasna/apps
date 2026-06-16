import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createSigningCertificate } from "../db/certificates.js";
import { listAuditEvents } from "../db/audit-events.js";
import type { Document, SigningSession, SigningCertificate } from "../types/index.js";
import { getCertificateOutputPath } from "./files.js";
import { sha256File } from "./hash.js";

export interface CertificateResult {
  certificate: SigningCertificate;
  output_path: string;
}

export async function createCompletionCertificate(input: {
  document: Document;
  session: SigningSession;
  signedDocumentPath: string;
  verificationCode?: string;
}): Promise<CertificateResult> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]);
  const serif = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: 34,
    y: 34,
    width: 774,
    height: 527,
    borderColor: rgb(0.67, 0.52, 0.23),
    borderWidth: 2,
  });
  page.drawRectangle({
    x: 48,
    y: 48,
    width: 746,
    height: 499,
    borderColor: rgb(0.86, 0.78, 0.54),
    borderWidth: 1,
  });

  const signer = input.session.signer_name ?? input.session.signer_email ?? "Unknown signer";
  const issuedAt = new Date().toISOString();
  const originalHash = sha256File(input.document.file_path);
  const signedHash = sha256File(input.signedDocumentPath);

  centerText(page, "Certificate of Completion", 500, 34, serifBold, rgb(0.12, 0.12, 0.14));
  centerText(page, "Open Signatures", 462, 14, sansBold, rgb(0.33, 0.33, 0.36));
  centerText(page, "This certifies that the document below was signed and completed.", 420, 15, sans, rgb(0.24, 0.27, 0.32));
  centerText(page, signer, 365, 30, serifBold, rgb(0.08, 0.11, 0.18));
  centerText(page, input.document.name, 326, 18, serif, rgb(0.14, 0.16, 0.2));

  const details: Array<[string, string]> = [
    ["Document ID", input.document.id],
    ["Session ID", input.session.id],
    ["Signer email", input.session.signer_email ?? "not provided"],
    ["Completed at", input.session.completed_at ?? issuedAt],
    ["Original SHA-256", originalHash],
    ["Signed SHA-256", signedHash],
  ];

  let y = 270;
  for (const [label, value] of details) {
    page.drawText(label, { x: 130, y, size: 10, font: sansBold, color: rgb(0.25, 0.27, 0.32) });
    page.drawText(value, { x: 250, y, size: 10, font: sans, color: rgb(0.11, 0.13, 0.18) });
    y -= 21;
  }

  const events = listAuditEvents({ session_id: input.session.id, limit: 5 });
  page.drawText("Audit trail", { x: 130, y: 128, size: 12, font: sansBold, color: rgb(0.12, 0.12, 0.14) });
  let auditY = 107;
  for (const event of events.slice(-4)) {
    page.drawText(`${event.created_at} - ${event.event_type}`, {
      x: 130,
      y: auditY,
      size: 9,
      font: sans,
      color: rgb(0.25, 0.27, 0.32),
    });
    auditY -= 16;
  }

  const outputPath = getCertificateOutputPath(input.document.file_name);
  writeFileSync(outputPath, await pdfDoc.save());
  const certificate = createSigningCertificate({
    document_id: input.document.id,
    session_id: input.session.id,
    certificate_path: outputPath,
    original_document_hash: originalHash,
    signed_document_hash: signedHash,
    verification_code: input.verificationCode,
    metadata: {
      signer,
      issued_at: issuedAt,
      source: input.session.source,
      connector_name: input.session.connector_name,
    },
  });

  return { certificate, output_path: outputPath };
}

function centerText(
  page: import("pdf-lib").PDFPage,
  text: string,
  y: number,
  size: number,
  font: import("pdf-lib").PDFFont,
  color: import("pdf-lib").RGB
): void {
  page.drawText(text, {
    x: (842 - font.widthOfTextAtSize(text, size)) / 2,
    y,
    size,
    font,
    color,
  });
}
