import { describe, expect, test } from "bun:test";
import { platform } from "os";
import { getHeadlessStatus } from "../src/drivers/mac/headless.js";

describe("headless status", () => {
  test("reports unavailable status instead of throwing when macOS tools are absent", async () => {
    const status = await getHeadlessStatus();

    expect(typeof status.display).toBe("boolean");
    expect(typeof status.screenSharing).toBe("boolean");
    expect(typeof status.lume).toBe("boolean");
    expect(status.recommendation.length).toBeGreaterThan(0);

    if (platform() !== "darwin") {
      expect(status.display).toBe(false);
      expect(status.screenSharing).toBe(false);
      expect(status.recommendation).toContain("macOS-only");
    }
  });
});
