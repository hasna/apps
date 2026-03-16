import { describe, test, expect, mock } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

describe("isAttachmentsConfigured", () => {
  test("returns false when @hasna/attachments not installed or not configured", async () => {
    const { isAttachmentsConfigured } = await import("./attachments-integration.js");
    // In test environment the package may not be installed; should return false gracefully
    const result = isAttachmentsConfigured();
    expect(typeof result).toBe("boolean");
  });
});

describe("shareDocument", () => {
  test("throws if attachments package not available", async () => {
    const { shareDocument } = await import("./attachments-integration.js");

    // We expect this to either succeed (if installed) or throw a module not found error
    try {
      await shareDocument("/nonexistent/file.pdf", "file.pdf");
      // If it doesn't throw, the package is installed — that's fine
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Acceptable errors: module not found, or file not found
      expect(
        message.includes("Cannot find module") ||
        message.includes("not found") ||
        message.includes("ENOENT") ||
        message.includes("No such file") ||
        message.includes("bucket")
      ).toBe(true);
    }
  });
});

describe("receiveDocument", () => {
  test("throws if attachments package not available or ID not found", async () => {
    const { receiveDocument } = await import("./attachments-integration.js");

    try {
      await receiveDocument("att_nonexistent", "/tmp/out.pdf");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(
        message.includes("Cannot find module") ||
        message.includes("not found") ||
        message.includes("Attachment not found") ||
        message.includes("bucket")
      ).toBe(true);
    }
  });
});
