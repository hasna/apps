process.env.TESTERS_DB_PATH = ":memory:";

import { describe, it, expect, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import {
  slugify,
  generateFilename,
  getScreenshotDir,
  ensureDir,
} from "./screenshotter.js";

describe("slugify", () => {
  it("converts 'Hello World!' to 'hello-world'", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });

  it("converts 'navigate to /login' to 'navigate-to-login'", () => {
    expect(slugify("navigate to /login")).toBe("navigate-to-login");
  });

  it("handles multiple special characters", () => {
    expect(slugify("Click #submit & wait")).toBe("click-submit-wait");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  hello  ")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

describe("generateFilename", () => {
  it("generates correct filename for step 1", () => {
    expect(generateFilename(1, "navigate homepage")).toBe(
      "001-navigate-homepage.png",
    );
  });

  it("generates correct filename for step 15", () => {
    expect(generateFilename(15, "click submit")).toBe(
      "015-click-submit.png",
    );
  });

  it("generates correct filename for step 100+", () => {
    expect(generateFilename(100, "verify results")).toBe(
      "100-verify-results.png",
    );
  });
});

describe("getScreenshotDir", () => {
  it("joins base, runId, and scenarioSlug correctly", () => {
    expect(getScreenshotDir("/base", "run-123", "login-flow")).toBe(
      "/base/run-123/login-flow",
    );
  });

  it("handles paths with various characters", () => {
    expect(
      getScreenshotDir("/home/user/.testers/screenshots", "abc-def", "my-scenario"),
    ).toBe("/home/user/.testers/screenshots/abc-def/my-scenario");
  });
});

describe("ensureDir", () => {
  const testBase = join(tmpdir(), `testers-test-${Date.now()}`);

  afterAll(() => {
    if (existsSync(testBase)) {
      rmSync(testBase, { recursive: true });
    }
  });

  it("creates a directory that does not exist", () => {
    const dir = join(testBase, "a", "b", "c");
    expect(existsSync(dir)).toBe(false);
    ensureDir(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it("does not throw if directory already exists", () => {
    const dir = join(testBase, "a", "b", "c");
    expect(() => ensureDir(dir)).not.toThrow();
  });
});
