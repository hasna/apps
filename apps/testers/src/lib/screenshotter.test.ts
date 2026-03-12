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
  it("generates correct filename with underscore separator", () => {
    expect(generateFilename(1, "navigate homepage")).toBe(
      "001_navigate-homepage.png",
    );
  });

  it("generates correct filename for step 15", () => {
    expect(generateFilename(15, "click submit")).toBe(
      "015_click-submit.png",
    );
  });

  it("generates correct filename for step 100+", () => {
    expect(generateFilename(100, "verify results")).toBe(
      "100_verify-results.png",
    );
  });
});

describe("getScreenshotDir", () => {
  it("builds project-scoped date-organized path", () => {
    const ts = new Date("2026-03-12T10:30:00.000Z");
    const dir = getScreenshotDir("/base", "abcd1234-full-id", "login-flow", "myapp", ts);
    expect(dir).toBe("/base/myapp/2026-03-12/10-30-00_abcd1234/login-flow");
  });

  it("uses default project name when not provided", () => {
    const ts = new Date("2026-03-12T10:30:00.000Z");
    const dir = getScreenshotDir("/base", "abcd1234-full-id", "login-flow", undefined, ts);
    expect(dir).toContain("/base/default/2026-03-12/");
  });

  it("handles various characters in scenario slug", () => {
    const ts = new Date("2026-01-15T08:05:30.000Z");
    const dir = getScreenshotDir("/screenshots", "run-abc", "my-scenario", "project-x", ts);
    expect(dir).toBe("/screenshots/project-x/2026-01-15/08-05-30_run-abc/my-scenario");
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
