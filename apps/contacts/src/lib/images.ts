/**
 * Image storage for contact photos and company logos.
 * Images stored in ~/.hasna/contacts/images/ as {id}.{ext}
 */
import { existsSync, mkdirSync, copyFileSync, unlinkSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { getDataDir } from "../db/database.js";

const IMAGES_DIR = join(getDataDir(), "images");

function ensureImagesDir(): void {
  if (!existsSync(IMAGES_DIR)) mkdirSync(IMAGES_DIR, { recursive: true });
}

export function getImagesDir(): string {
  ensureImagesDir();
  return IMAGES_DIR;
}

/**
 * Save an image for a contact or company.
 * Accepts a file path (copies it) or base64 data (writes it).
 * Returns the stored filename (e.g. "abc123.jpg")
 */
export function saveImage(
  entityId: string,
  source: string,
  options?: { format?: string }
): string {
  ensureImagesDir();

  // Remove existing images for this entity
  deleteImage(entityId);

  // Check if source is base64 data
  const base64Match = source.match(/^data:image\/(\w+);base64,(.+)$/s);
  if (base64Match) {
    const ext = base64Match[1] === "jpeg" ? "jpg" : base64Match[1]!;
    const data = Buffer.from(base64Match[2]!, "base64");
    const filename = `${entityId}.${ext}`;
    writeFileSync(join(IMAGES_DIR, filename), data);
    return filename;
  }

  // Check if source is raw base64 without data URI prefix
  if (!existsSync(source) && /^[A-Za-z0-9+/=\n\r]+$/.test(source.trim()) && source.length > 100) {
    const ext = options?.format || "jpg";
    const data = Buffer.from(source.trim(), "base64");
    const filename = `${entityId}.${ext}`;
    writeFileSync(join(IMAGES_DIR, filename), data);
    return filename;
  }

  // Source is a file path
  if (!existsSync(source)) {
    throw new Error(`Image file not found: ${source}`);
  }

  const ext = extname(source).slice(1).toLowerCase() || "jpg";
  const validExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "ico"];
  if (!validExts.includes(ext)) {
    throw new Error(`Unsupported image format: ${ext}. Supported: ${validExts.join(", ")}`);
  }

  const filename = `${entityId}.${ext === "jpeg" ? "jpg" : ext}`;
  copyFileSync(source, join(IMAGES_DIR, filename));
  return filename;
}

/**
 * Get the image path for an entity. Returns null if no image exists.
 */
export function getImagePath(entityId: string): string | null {
  ensureImagesDir();
  const files = readdirSync(IMAGES_DIR);
  const match = files.find(f => f.startsWith(`${entityId}.`));
  return match ? join(IMAGES_DIR, match) : null;
}

/**
 * Get image as base64 data URI for embedding in responses.
 */
export function getImageAsBase64(entityId: string): string | null {
  const path = getImagePath(entityId);
  if (!path) return null;
  const ext = extname(path).slice(1);
  const mime = ext === "jpg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : `image/${ext}`;
  const data = readFileSync(path);
  return `data:${mime};base64,${data.toString("base64")}`;
}

/**
 * Delete an entity's image.
 */
export function deleteImage(entityId: string): boolean {
  ensureImagesDir();
  const files = readdirSync(IMAGES_DIR);
  let deleted = false;
  for (const f of files) {
    if (f.startsWith(`${entityId}.`)) {
      unlinkSync(join(IMAGES_DIR, f));
      deleted = true;
    }
  }
  return deleted;
}

/**
 * List all stored images.
 */
export function listImages(): Array<{ entity_id: string; filename: string; path: string }> {
  ensureImagesDir();
  const files = readdirSync(IMAGES_DIR).filter(f => !f.startsWith("."));
  return files.map(f => ({
    entity_id: basename(f, extname(f)),
    filename: f,
    path: join(IMAGES_DIR, f),
  }));
}
