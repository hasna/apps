import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";

function chmodIfSupported(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Some platforms/filesystems do not support POSIX modes.
  }
}

export function isInsidePath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || Boolean(rel && !rel.startsWith("..") && !isAbsolute(rel));
}

export function ensurePrivateDirectory(path: string, options: { tightenExisting?: boolean } = {}): void {
  const existed = existsSync(path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!existed || options.tightenExisting) chmodIfSupported(path, 0o700);
}

export function writePrivateTextFile(path: string, content: string): void {
  ensurePrivateDirectory(dirname(path));
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  chmodIfSupported(path, 0o600);
}
