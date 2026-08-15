import { readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { deflateSync, inflateSync } from "node:zlib";
import type { CaptureAnnotation, CaptureArrowAnnotation, CaptureRect } from "../types.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_MARKUP_COLOR = "#ff3b30";
const DEFAULT_ARROW_COLOR = "#0a84ff";

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface CaptureAnnotationFileResult {
  outputPath: string;
  operations: CaptureAnnotation[];
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
}

export class CaptureAnnotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureAnnotationError";
  }
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < CRC_TABLE.length; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array = new Uint8Array()): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const payload = Buffer.from(data);
  return Buffer.concat([
    uint32(payload.byteLength),
    typeBytes,
    payload,
    uint32(crc32(Buffer.concat([typeBytes, payload]))),
  ]);
}

function channelsForColorType(colorType: number): number {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type ${colorType}; annotation supports grayscale, RGB, and RGBA PNGs.`);
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : upLeft;
}

export function decodePng(input: Uint8Array): RgbaImage {
  const buffer = Buffer.from(input);
  if (buffer.byteLength < PNG_SIGNATURE.byteLength || !buffer.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
    throw new Error("Expected a PNG image for screenshot annotation.");
  }

  let offset = PNG_SIGNATURE.byteLength;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filterMethod = 0;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= buffer.byteLength) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.toString("ascii", offset, offset + 4);
    offset += 4;
    if (offset + length + 4 > buffer.byteLength) throw new Error("PNG chunk length exceeds file size.");
    const data = buffer.subarray(offset, offset + length);
    offset += length;
    offset += 4;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      compression = data[10]!;
      filterMethod = data[11]!;
      interlace = data[12]!;
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
  }

  if (!width || !height) throw new Error("PNG image is missing a valid IHDR chunk.");
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}; annotation supports 8-bit PNGs.`);
  if (compression !== 0 || filterMethod !== 0 || interlace !== 0) {
    throw new Error("Unsupported PNG encoding; annotation supports non-interlaced PNGs with standard compression and filters.");
  }

  const sourceChannels = channelsForColorType(colorType);
  const stride = width * sourceChannels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const expected = (stride + 1) * height;
  if (inflated.byteLength !== expected) {
    throw new Error(`PNG pixel data length ${inflated.byteLength} did not match expected ${expected}.`);
  }

  const rgba = new Uint8Array(width * height * 4);
  let readOffset = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[readOffset]!;
    readOffset += 1;
    const row = inflated.subarray(readOffset, readOffset + stride);
    readOffset += stride;
    const reconstructed = new Uint8Array(stride);

    for (let i = 0; i < stride; i += 1) {
      const raw = row[i]!;
      const left = i >= sourceChannels ? reconstructed[i - sourceChannels]! : 0;
      const up = previous[i] ?? 0;
      const upLeft = i >= sourceChannels ? previous[i - sourceChannels]! : 0;
      let value: number;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      else throw new Error(`Unsupported PNG filter type ${filter}.`);
      reconstructed[i] = value & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const source = x * sourceChannels;
      const target = (y * width + x) * 4;
      if (colorType === 0) {
        const gray = reconstructed[source]!;
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        rgba[target + 3] = 255;
      } else if (colorType === 2) {
        rgba[target] = reconstructed[source]!;
        rgba[target + 1] = reconstructed[source + 1]!;
        rgba[target + 2] = reconstructed[source + 2]!;
        rgba[target + 3] = 255;
      } else if (colorType === 4) {
        const gray = reconstructed[source]!;
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        rgba[target + 3] = reconstructed[source + 1]!;
      } else {
        rgba[target] = reconstructed[source]!;
        rgba[target + 1] = reconstructed[source + 1]!;
        rgba[target + 2] = reconstructed[source + 2]!;
        rgba[target + 3] = reconstructed[source + 3]!;
      }
    }

    previous = reconstructed;
  }

  return { width, height, data: rgba };
}

export function encodePng(image: RgbaImage): Uint8Array {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
    throw new Error("PNG image dimensions must be positive integers.");
  }
  if (image.data.byteLength !== image.width * image.height * 4) {
    throw new Error("RGBA image data length does not match dimensions.");
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const target = y * (stride + 1);
    raw[target] = 0;
    raw.set(image.data.subarray(y * stride, (y + 1) * stride), target + 1);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND"),
  ]);
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CaptureAnnotationError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new CaptureAnnotationError(`${label} must be a finite number.`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new CaptureAnnotationError(`${label} must be a string.`);
  return value;
}

function positiveInteger(value: number | undefined, fallback: number, label: string, max: number): number {
  const raw = value ?? fallback;
  if (!Number.isFinite(raw) || raw <= 0) throw new CaptureAnnotationError(`${label} must be positive.`);
  return Math.max(1, Math.min(Math.round(raw), max));
}

function parseRect(record: Record<string, unknown>, label: string): CaptureRect {
  return {
    x: finiteNumber(record["x"], `${label}.x`),
    y: finiteNumber(record["y"], `${label}.y`),
    width: finiteNumber(record["width"], `${label}.width`),
    height: finiteNumber(record["height"], `${label}.height`),
  };
}

function parsePoint(value: unknown, label: string): { x: number; y: number } {
  const record = objectRecord(value, label);
  return {
    x: finiteNumber(record["x"], `${label}.x`),
    y: finiteNumber(record["y"], `${label}.y`),
  };
}

function normalizeOperation(value: unknown, index: number): CaptureAnnotation {
  const label = `annotations[${index}]`;
  const record = objectRecord(value, label);
  const type = record["type"];
  if (type === "crop") {
    return { type, ...parseRect(record, label) };
  }
  if (type === "box") {
    return {
      type,
      ...parseRect(record, label),
      color: optionalString(record["color"], `${label}.color`),
      lineWidth: record["lineWidth"] === undefined ? undefined : finiteNumber(record["lineWidth"], `${label}.lineWidth`),
    };
  }
  if (type === "blur") {
    return {
      type,
      ...parseRect(record, label),
      radius: record["radius"] === undefined ? undefined : finiteNumber(record["radius"], `${label}.radius`),
    };
  }
  if (type === "arrow") {
    return {
      type,
      from: parsePoint(record["from"], `${label}.from`),
      to: parsePoint(record["to"], `${label}.to`),
      color: optionalString(record["color"], `${label}.color`),
      lineWidth: record["lineWidth"] === undefined ? undefined : finiteNumber(record["lineWidth"], `${label}.lineWidth`),
    };
  }
  throw new CaptureAnnotationError(`${label}.type must be crop, box, blur, or arrow.`);
}

export function validateCaptureAnnotations(annotations: readonly CaptureAnnotation[] | undefined): CaptureAnnotation[] {
  const operations = normalizeCaptureAnnotations(annotations);
  for (const operation of operations) {
    if (operation.type === "crop") {
      if (operation.width <= 0 || operation.height <= 0) throw new CaptureAnnotationError("crop annotation width and height must be positive.");
    } else if (operation.type === "box") {
      if (operation.width <= 0 || operation.height <= 0) throw new CaptureAnnotationError("box annotation width and height must be positive.");
      parseHexColor(operation.color, DEFAULT_MARKUP_COLOR);
      positiveInteger(operation.lineWidth, 3, "box annotation lineWidth", 96);
    } else if (operation.type === "blur") {
      if (operation.width <= 0 || operation.height <= 0) throw new CaptureAnnotationError("blur annotation width and height must be positive.");
      positiveInteger(operation.radius, 8, "blur annotation radius", 128);
    } else {
      parseHexColor(operation.color, DEFAULT_ARROW_COLOR);
      positiveInteger(operation.lineWidth, 4, "arrow annotation lineWidth", 96);
    }
  }
  return operations;
}

export function parseCaptureAnnotations(value: unknown): CaptureAnnotation[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : [value];
  return validateCaptureAnnotations(list.map((item, index) => normalizeOperation(item, index)));
}

export function normalizeCaptureAnnotations(annotations: readonly CaptureAnnotation[] | undefined): CaptureAnnotation[] {
  if (!annotations || annotations.length === 0) return [];
  return annotations.map((annotation, index) => normalizeOperation(annotation, index));
}

function roundRect(rect: CaptureRect): CaptureRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function clippedRect(image: RgbaImage, rect: CaptureRect, label: string): CaptureRect {
  const rounded = roundRect(rect);
  if (rounded.width <= 0 || rounded.height <= 0) throw new CaptureAnnotationError(`${label} width and height must be positive.`);
  const x1 = Math.max(0, rounded.x);
  const y1 = Math.max(0, rounded.y);
  const x2 = Math.min(image.width, rounded.x + rounded.width);
  const y2 = Math.min(image.height, rounded.y + rounded.height);
  if (x2 <= x1 || y2 <= y1) throw new CaptureAnnotationError(`${label} is outside the image bounds.`);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function imageIndex(image: RgbaImage, x: number, y: number): number {
  return (y * image.width + x) * 4;
}

function parseHexColor(value: string | undefined, fallback: string): RgbaColor {
  const raw = (value ?? fallback).trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(raw);
  if (!match) throw new CaptureAnnotationError(`Invalid annotation color '${raw}'. Use #rgb, #rrggbb, or #rrggbbaa.`);
  const hex = match[1]!;
  if (hex.length === 3) {
    return {
      r: Number.parseInt(hex[0]! + hex[0]!, 16),
      g: Number.parseInt(hex[1]! + hex[1]!, 16),
      b: Number.parseInt(hex[2]! + hex[2]!, 16),
      a: 255,
    };
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255,
  };
}

function setPixel(image: RgbaImage, x: number, y: number, color: RgbaColor): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const index = imageIndex(image, x, y);
  const alpha = color.a / 255;
  const inverse = 1 - alpha;
  image.data[index] = Math.round(color.r * alpha + image.data[index]! * inverse);
  image.data[index + 1] = Math.round(color.g * alpha + image.data[index + 1]! * inverse);
  image.data[index + 2] = Math.round(color.b * alpha + image.data[index + 2]! * inverse);
  image.data[index + 3] = Math.round(255 * alpha + image.data[index + 3]! * inverse);
}

function drawDisk(image: RgbaImage, centerX: number, centerY: number, radius: number, color: RgbaColor): void {
  const wholeRadius = Math.max(0, Math.ceil(radius));
  const radiusSquared = radius * radius;
  for (let y = Math.floor(centerY) - wholeRadius; y <= Math.floor(centerY) + wholeRadius; y += 1) {
    for (let x = Math.floor(centerX) - wholeRadius; x <= Math.floor(centerX) + wholeRadius; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if ((dx * dx) + (dy * dy) <= radiusSquared + 0.25) setPixel(image, x, y, color);
    }
  }
}

function drawLine(image: RgbaImage, x1: number, y1: number, x2: number, y2: number, lineWidth: number, color: RgbaColor): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2));
  const radius = Math.max(0.5, lineWidth / 2);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    drawDisk(image, x1 + ((x2 - x1) * t), y1 + ((y2 - y1) * t), radius, color);
  }
}

function cropImage(image: RgbaImage, rect: CaptureRect): RgbaImage {
  const clipped = clippedRect(image, rect, "crop annotation");
  const data = new Uint8Array(clipped.width * clipped.height * 4);
  const targetStride = clipped.width * 4;
  for (let y = 0; y < clipped.height; y += 1) {
    const sourceStart = imageIndex(image, clipped.x, clipped.y + y);
    data.set(image.data.subarray(sourceStart, sourceStart + targetStride), y * targetStride);
  }
  return { width: clipped.width, height: clipped.height, data };
}

function applyBox(image: RgbaImage, rect: CaptureRect, color: RgbaColor, lineWidth: number): void {
  const clipped = clippedRect(image, rect, "box annotation");
  const x1 = clipped.x;
  const y1 = clipped.y;
  const x2 = clipped.x + clipped.width - 1;
  const y2 = clipped.y + clipped.height - 1;
  drawLine(image, x1, y1, x2, y1, lineWidth, color);
  drawLine(image, x2, y1, x2, y2, lineWidth, color);
  drawLine(image, x2, y2, x1, y2, lineWidth, color);
  drawLine(image, x1, y2, x1, y1, lineWidth, color);
}

function applyArrow(image: RgbaImage, annotation: CaptureArrowAnnotation): void {
  const color = parseHexColor(annotation.color, DEFAULT_ARROW_COLOR);
  const lineWidth = positiveInteger(annotation.lineWidth, 4, "arrow annotation lineWidth", 96);
  drawLine(image, annotation.from.x, annotation.from.y, annotation.to.x, annotation.to.y, lineWidth, color);

  const angle = Math.atan2(annotation.to.y - annotation.from.y, annotation.to.x - annotation.from.x);
  const length = Math.max(12, lineWidth * 4);
  const spread = Math.PI / 7;
  for (const branch of [angle - spread, angle + spread]) {
    drawLine(
      image,
      annotation.to.x,
      annotation.to.y,
      annotation.to.x - Math.cos(branch) * length,
      annotation.to.y - Math.sin(branch) * length,
      lineWidth,
      color,
    );
  }
}

function integralIndex(width: number, x: number, y: number): number {
  return y * (width + 1) + x;
}

function integralSum(table: Float64Array, width: number, x1: number, y1: number, x2: number, y2: number): number {
  return table[integralIndex(width, x2, y2)]!
    - table[integralIndex(width, x1, y2)]!
    - table[integralIndex(width, x2, y1)]!
    + table[integralIndex(width, x1, y1)]!;
}

function applyBlur(image: RgbaImage, rect: CaptureRect, radius: number): void {
  const clipped = clippedRect(image, rect, "blur annotation");
  const blurRadius = positiveInteger(radius, 8, "blur annotation radius", 128);
  const width = clipped.width;
  const height = clipped.height;
  const tableSize = (width + 1) * (height + 1);
  const r = new Float64Array(tableSize);
  const g = new Float64Array(tableSize);
  const b = new Float64Array(tableSize);
  const a = new Float64Array(tableSize);

  for (let y = 1; y <= height; y += 1) {
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;
    let rowA = 0;
    for (let x = 1; x <= width; x += 1) {
      const source = imageIndex(image, clipped.x + x - 1, clipped.y + y - 1);
      rowR += image.data[source]!;
      rowG += image.data[source + 1]!;
      rowB += image.data[source + 2]!;
      rowA += image.data[source + 3]!;
      const target = integralIndex(width, x, y);
      const above = integralIndex(width, x, y - 1);
      r[target] = r[above]! + rowR;
      g[target] = g[above]! + rowG;
      b[target] = b[above]! + rowB;
      a[target] = a[above]! + rowA;
    }
  }

  const output = image.data.slice();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - blurRadius);
      const y1 = Math.max(0, y - blurRadius);
      const x2 = Math.min(width, x + blurRadius + 1);
      const y2 = Math.min(height, y + blurRadius + 1);
      const area = (x2 - x1) * (y2 - y1);
      const target = imageIndex(image, clipped.x + x, clipped.y + y);
      output[target] = Math.round(integralSum(r, width, x1, y1, x2, y2) / area);
      output[target + 1] = Math.round(integralSum(g, width, x1, y1, x2, y2) / area);
      output[target + 2] = Math.round(integralSum(b, width, x1, y1, x2, y2) / area);
      output[target + 3] = Math.round(integralSum(a, width, x1, y1, x2, y2) / area);
    }
  }
  image.data.set(output);
}

function applyAnnotations(image: RgbaImage, operations: CaptureAnnotation[]): RgbaImage {
  let current: RgbaImage = { width: image.width, height: image.height, data: new Uint8Array(image.data) };
  for (const operation of operations) {
    if (operation.type === "crop") {
      current = cropImage(current, operation);
    } else if (operation.type === "box") {
      applyBox(
        current,
        operation,
        parseHexColor(operation.color, DEFAULT_MARKUP_COLOR),
        positiveInteger(operation.lineWidth, 3, "box annotation lineWidth", 96),
      );
    } else if (operation.type === "blur") {
      applyBlur(current, operation, operation.radius ?? 8);
    } else {
      applyArrow(current, operation);
    }
  }
  return current;
}

export function annotatePng(input: Uint8Array, annotations: readonly CaptureAnnotation[] | undefined): Uint8Array {
  const operations = normalizeCaptureAnnotations(annotations);
  if (operations.length === 0) return new Uint8Array(input);
  const image = decodePng(input);
  return encodePng(applyAnnotations(image, operations));
}

export function applyCaptureAnnotationsToFile(
  inputPath: string,
  outputPath: string,
  annotations: readonly CaptureAnnotation[] | undefined,
): CaptureAnnotationFileResult {
  const operations = normalizeCaptureAnnotations(annotations);
  if (operations.length === 0) throw new Error("No capture annotations were provided.");
  const original = decodePng(readFileSync(inputPath));
  const annotated = applyAnnotations(original, operations);
  writeFileSync(outputPath, encodePng(annotated));
  return {
    outputPath,
    operations,
    originalWidth: original.width,
    originalHeight: original.height,
    width: annotated.width,
    height: annotated.height,
  };
}
