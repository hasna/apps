import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getDataRoot } from "../paths.js";

export type AttachmentAction = "download" | "copy-link";
const preferencePath = () => join(getDataRoot(), "config", "tui-attachments.json");

/** Device preference only: no mail, credentials, or SQLite store. */
export function loadAttachmentAction(): AttachmentAction {
  try {
    const value = JSON.parse(readFileSync(preferencePath(), "utf8"));
    return value.action === "copy-link" ? "copy-link" : "download";
  } catch { return "download"; }
}

export function saveAttachmentAction(action: AttachmentAction): void {
  if (action !== "download" && action !== "copy-link") throw new Error("Invalid attachment action");
  const path = preferencePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ action }) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
