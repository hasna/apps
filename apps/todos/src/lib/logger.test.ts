import { describe, expect, it } from "bun:test";
import { getLogger, logError, logInfo, logWarn } from "./logger.js";

describe("local no-op logger", () => {
  it("never configures a hosted logger by default", async () => {
    expect(getLogger()).toBeNull();
    await expect(logError("ignored")).resolves.toBeUndefined();
    await expect(logInfo("ignored")).resolves.toBeUndefined();
    await expect(logWarn("ignored")).resolves.toBeUndefined();
  });
});
