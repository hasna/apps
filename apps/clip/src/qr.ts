import * as QRCode from "qrcode";
import type { GeneratedQRCodeSegment, QRCode as QRCodeSymbol } from "qrcode";

const encoder = new TextDecoder();
const qrOptions = { errorCorrectionLevel: "M" as const };
const terminalQrOptions = { ...qrOptions, type: "terminal" as const, margin: 2 };

export interface TerminalQrCode {
  payload: string;
  terminal: string;
  version: number;
  size: number;
}

export function createShareQrCode(payload: string): QRCodeSymbol {
  if (payload.length === 0) throw new Error("QR payload must not be empty");
  return QRCode.create(payload, qrOptions);
}

export function encodedQrPayloads(qr: QRCodeSymbol): string[] {
  return qr.segments.map((segment) => segmentPayload(segment));
}

export async function renderShareQrCode(payload: string): Promise<TerminalQrCode> {
  const qr = createShareQrCode(payload);
  const terminal = await QRCode.toString(payload, terminalQrOptions);
  return {
    payload,
    terminal: terminal.trimEnd(),
    version: qr.version,
    size: qr.modules.size,
  };
}

function segmentPayload(segment: GeneratedQRCodeSegment): string {
  if (segment.data instanceof Uint8Array) return encoder.decode(segment.data);
  return String(segment.data);
}
