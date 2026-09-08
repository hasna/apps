import { readDevicePreferences, writeDevicePreferences } from "./device-preferences.js";
export type AttachmentAction = "download" | "copy-link";
/** Device preference only: no mail, credentials, or SQLite store. */
export function loadAttachmentAction(): AttachmentAction {
  return readDevicePreferences("tui-attachments").action === "copy-link" ? "copy-link" : "download";
}
export function saveAttachmentAction(action: AttachmentAction): void {
  if (action !== "download" && action !== "copy-link") throw new Error("Invalid attachment action");
  writeDevicePreferences("tui-attachments", { action });
}
