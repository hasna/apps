import { afterEach, describe, expect, it } from "bun:test";
import { getLogger, logError, logInfo, logWarn } from "./logger.js";

const originalProjectId = process.env.LOGS_PROJECT_ID;

afterEach(() => {
  if (originalProjectId === undefined) {
    delete process.env.LOGS_PROJECT_ID;
  } else {
    process.env.LOGS_PROJECT_ID = originalProjectId;
  }
});

describe("optional logs integration", () => {
  it("does not import @hasna/logs when logging is not configured", async () => {
    delete process.env.LOGS_PROJECT_ID;

    await expect(getLogger()).resolves.toBeNull();
    await expect(logError("ignored")).resolves.toBeUndefined();
    await expect(logInfo("ignored")).resolves.toBeUndefined();
    await expect(logWarn("ignored")).resolves.toBeUndefined();
  });
});
