import { mkdirSync, existsSync, copyFileSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";

export function getSignaturesDir(): string {
  const dir = join(homedir(), ".signatures");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDocumentsDir(): string {
  const dir = join(getSignaturesDir(), "documents");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getSignedDir(): string {
  const dir = join(getSignaturesDir(), "signed");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getSignatureImagesDir(): string {
  const dir = join(getSignaturesDir(), "signatures");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function storeDocument(sourcePath: string, name?: string): {
  file_path: string;
  file_name: string;
  file_size: number;
} {
  if (!existsSync(sourcePath)) {
    throw new Error(`File not found: ${sourcePath}`);
  }

  const fileName = name ?? basename(sourcePath);
  const ext = extname(fileName) || ".pdf";
  const timestamp = Date.now();
  const storedName = `${basename(fileName, ext)}-${timestamp}${ext}`;
  const destPath = join(getDocumentsDir(), storedName);

  copyFileSync(sourcePath, destPath);
  const stats = statSync(destPath);

  return {
    file_path: destPath,
    file_name: fileName,
    file_size: stats.size,
  };
}

export function getSignedOutputPath(originalFileName: string): string {
  const ext = extname(originalFileName) || ".pdf";
  const base = basename(originalFileName, ext);
  const timestamp = Date.now();
  return join(getSignedDir(), `${base}-signed-${timestamp}${ext}`);
}

export function ensureSignaturesHomeDir(): void {
  mkdirSync(getDocumentsDir(), { recursive: true });
  mkdirSync(getSignedDir(), { recursive: true });
  mkdirSync(getSignatureImagesDir(), { recursive: true });
}
