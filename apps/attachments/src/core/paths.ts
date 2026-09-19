import { resolvePath } from "@hasna/paths";

/** Non-authoritative configuration only. No mkdir, legacy discovery, or copying. */
export function ensureAttachmentsDataDir(): string {
  return resolvePath("config", { app: "attachments" });
}

export const HASNA_ATTACHMENTS_DB_PATH_ENV = "HASNA_ATTACHMENTS_DB_PATH";

/** Legacy data is preserved in place; SQLite is no longer an application backend. */
export function getAttachmentsDbPath(): never {
  throw new Error("Local attachment databases are retired. Existing data is preserved; use the authenticated HTTPS service.");
}
