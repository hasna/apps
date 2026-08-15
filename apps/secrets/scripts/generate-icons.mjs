#!/usr/bin/env node
/**
 * Generate PNG icons for the Secrets Vault Chrome extension.
 * Pure Node.js — no external dependencies. Uses zlib for DEFLATE.
 */

import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, "../extension/icons");

mkdirSync(OUT, { recursive: true });

// ── CRC32 ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk ──────────────────────────────────────────
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(dataBuf.length, 0);
  const combined = Buffer.concat([typeBuf, dataBuf]);
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, dataBuf, crc]);
}

// ── PNG encoder ────────────────────────────────────────
function makePNG(width, height, getPixel) {
  // Raw image rows: filter byte + RGBA per pixel
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.allocUnsafe(1 + width * 4);
    row[0] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = getPixel(x, y, width, height);
      row[1 + x * 4] = r;
      row[1 + x * 4 + 1] = g;
      row[1 + x * 4 + 2] = b;
      row[1 + x * 4 + 3] = a;
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const compressed = deflateSync(raw, { level: 9 });

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Icon design ────────────────────────────────────────
// Dark background + rounded-rect border + lock icon (pixel art)

function drawIcon(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const pad = Math.max(1, Math.round(size * 0.06));
  const r = size / 2 - pad; // outer radius
  const borderW = Math.max(1, Math.round(size * 0.07));

  // BG: #0d0d1a = (13,13,26)
  const BG = [13, 13, 26];
  // Accent: #00d4ff = (0,212,255)
  const ACCENT = [0, 212, 255];
  // Surface: #1a1a2e = (26,26,46)
  const SURFACE = [26, 26, 46];

  // Distance from center (circular)
  const dx = x - cx + 0.5;
  const dy = y - cy + 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Outer circle (background disc)
  if (dist > r + 0.5) return [0, 0, 0, 0]; // transparent outside

  // Border ring
  if (dist > r - borderW) return [...ACCENT, 255];

  // Inner surface
  const inner = [SURFACE[0], SURFACE[1], SURFACE[2]];

  // Draw a simplified lock symbol (scaled to icon size)
  const lockW = Math.round(size * 0.45);
  const lockH = Math.round(size * 0.35);
  const shackleR = Math.round(size * 0.13);
  const shackleThick = Math.max(1, Math.round(size * 0.07));

  const bx = Math.round(cx - lockW / 2);
  const by = Math.round(cy - lockH * 0.25);

  // Lock body (rounded rect)
  if (x >= bx && x < bx + lockW && y >= by && y < by + lockH) {
    // Outer body
    const bCorner = Math.max(1, Math.round(lockW * 0.15));
    const bdx = Math.min(x - bx, bx + lockW - 1 - x);
    const bdy = Math.min(y - by, by + lockH - 1 - y);
    const bDist = Math.min(bdx, bdy);
    if (bCorner > 0 && bdx < bCorner && bdy < bCorner) {
      const cd = Math.sqrt((bdx - bCorner + 0.5) ** 2 + (bdy - bCorner + 0.5) ** 2);
      if (cd > bCorner + 0.5) return inner;
    }

    // Keyhole (centered, lower half of body)
    const kx = Math.round(cx);
    const ky = Math.round(by + lockH * 0.38);
    const kr = Math.max(1, Math.round(lockW * 0.12));
    const kd = Math.sqrt((x - kx + 0.5) ** 2 + (y - ky + 0.5) ** 2);
    const slotW = Math.max(1, Math.round(lockW * 0.08));
    const slotH = Math.round(lockH * 0.28);
    const inSlot = x >= kx - slotW && x <= kx + slotW && y >= ky && y < ky + slotH;
    const inCircle = kd < kr;
    if (inCircle || inSlot) return [...SURFACE, 255]; // cutout shows surface (dark)

    return [...ACCENT, 255];
  }

  // Shackle (top arch of lock)
  const shTopY = by - shackleR * 2 + Math.round(size * 0.05);
  const shLeftX = Math.round(cx - lockW * 0.25);
  const shRightX = Math.round(cx + lockW * 0.25);

  // Left leg
  if (x >= shLeftX - shackleThick && x <= shLeftX + shackleThick &&
      y >= shTopY + shackleR && y < by + shackleThick) {
    return [...ACCENT, 255];
  }
  // Right leg
  if (x >= shRightX - shackleThick && x <= shRightX + shackleThick &&
      y >= shTopY + shackleR && y < by + shackleThick) {
    return [...ACCENT, 255];
  }
  // Top arch
  const ad = Math.sqrt((x - cx + 0.5) ** 2 + (y - (shTopY + shackleR) + 0.5) ** 2);
  const outerShackle = Math.abs(shLeftX - cx);
  if (ad > outerShackle - shackleThick && ad < outerShackle + shackleThick &&
      y <= shTopY + shackleR + 0.5) {
    return [...ACCENT, 255];
  }

  return inner;
}

// ── Generate ───────────────────────────────────────────
for (const size of [16, 32, 48, 128]) {
  const png = makePNG(size, size, (x, y) => drawIcon(x, y, size));
  const path = join(OUT, `${size}.png`);
  writeFileSync(path, png);
  console.log(`  ✓ icons/${size}.png (${png.length} bytes)`);
}

console.log("\nDone.");
