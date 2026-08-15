/**
 * Decode a base64 string into a Buffer. Uses the global `Buffer` (available in
 * Bun and Node) — no `node:fs`, so this stays bundle-safe.
 */
export function decodeBase64(dataBase64: string): Buffer {
  if (typeof dataBase64 !== "string" || dataBase64.length === 0) {
    throw new Error("media.upload requires a non-empty base64 string in `dataBase64`");
  }
  return Buffer.from(dataBase64, "base64");
}
