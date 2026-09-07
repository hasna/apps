import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startV1Stub, type V1Stub } from "../test-support/v1-stub.js";
import { attachmentLink, downloadTuiAttachment } from "./tui-attachment-actions.js";
import { loadAttachmentAction, saveAttachmentAction } from "./attachment-preferences.js";
import { resolveMailDataSource } from "./mail-data-source.js";

let stub: V1Stub;
let previousHome: string | undefined;
let home: string;
beforeAll(async () => { stub = await startV1Stub(); });
afterAll(() => stub.stop());
beforeEach(() => {
  previousHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "emails-attachment-actions-"));
  process.env.HOME = home;
  stub.applyEnv();
});
afterEach(() => {
  stub.clearEnv();
  if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("TUI attachment actions", () => {
  it("copies an authenticated resource link with the exact attachment index, never a filename or credential", () => {
    const link = attachmentLink("message/with spaces", { filename: "invoice.pdf", content_type: "application/pdf", size: 10, openable: false, index: 2 });
    expect(link?.requiresAuthentication).toBe(true);
    const url = new URL(link!.url);
    expect(url.pathname).toEndWith("/v1/messages/message%2Fwith%20spaces/attachments/2");
    expect(url.search).toBe("");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
    expect(attachmentLink("message", { filename: "invoice.pdf", content_type: "application/pdf", size: 10, openable: false })).toBeNull();
  });

  it("keeps a device preference in JSON without creating a mail store", () => {
    expect(loadAttachmentAction()).toBe("download");
    saveAttachmentAction("copy-link");
    expect(loadAttachmentAction()).toBe("copy-link");
    expect(JSON.parse(readFileSync(join(home, ".hasna/emails/config/tui-attachments.json"), "utf8"))).toEqual({ action: "copy-link" });
    saveAttachmentAction("download");
    expect(loadAttachmentAction()).toBe("download");
  });

  it("does not write a file for metadata-only attachments and requests their original index", async () => {
    const source = resolveMailDataSource();
    const fetchContent = spyOn(source, "getAttachmentContent").mockResolvedValue({ state: "content_unavailable", index: 3, filename: "invoice.pdf", content_type: "application/pdf", bytes: null });
    try {
      await expect(downloadTuiAttachment("full-message-id", 3)).rejects.toThrow("no stored content");
      expect(fetchContent).toHaveBeenCalledWith("full-message-id", 3, { maxBytes: 25 * 1024 * 1024 });
    } finally { fetchContent.mockRestore(); }
  });
});
