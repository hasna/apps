process.env.TESTERS_DB_PATH = ":memory:";

import { describe, it, expect } from "bun:test";
import { getDefaultConfig, loadConfig, resolveModel } from "./config.js";
import { MODEL_MAP } from "../types/index.js";
import { homedir } from "node:os";
import { join } from "node:path";

describe("getDefaultConfig", () => {
  it("returns correct default model", () => {
    const config = getDefaultConfig();
    expect(config.defaultModel).toBe("claude-haiku-4-5-20251001");
  });

  it("returns correct default viewport", () => {
    const config = getDefaultConfig();
    expect(config.browser.viewport).toEqual({ width: 1280, height: 720 });
  });

  it("returns correct default screenshot dir", () => {
    const config = getDefaultConfig();
    expect(config.screenshots.dir).toBe(
      join(homedir(), ".testers", "screenshots"),
    );
  });

  it("returns correct screenshot format and quality", () => {
    const config = getDefaultConfig();
    expect(config.screenshots.format).toBe("png");
    expect(config.screenshots.quality).toBe(90);
    expect(config.screenshots.fullPage).toBe(false);
  });

  it("returns headless browser by default", () => {
    const config = getDefaultConfig();
    expect(config.browser.headless).toBe(true);
    expect(config.browser.timeout).toBe(60_000);
  });

  it("includes all model presets", () => {
    const config = getDefaultConfig();
    expect(config.models.quick).toBe(MODEL_MAP.quick);
    expect(config.models.thorough).toBe(MODEL_MAP.thorough);
    expect(config.models.deep).toBe(MODEL_MAP.deep);
  });
});

describe("resolveModel", () => {
  it("resolves 'quick' to haiku model ID", () => {
    expect(resolveModel("quick")).toBe("claude-haiku-4-5-20251001");
  });

  it("resolves 'thorough' to sonnet model ID", () => {
    expect(resolveModel("thorough")).toBe("claude-sonnet-4-6-20260311");
  });

  it("resolves 'deep' to opus model ID", () => {
    expect(resolveModel("deep")).toBe("claude-opus-4-6-20260311");
  });

  it("passes through direct model IDs unchanged", () => {
    expect(resolveModel("claude-3-opus-20240229")).toBe(
      "claude-3-opus-20240229",
    );
  });

  it("passes through arbitrary strings unchanged", () => {
    expect(resolveModel("some-custom-model")).toBe("some-custom-model");
  });
});

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const config = loadConfig();
    const defaults = getDefaultConfig();

    expect(config.defaultModel).toBe(defaults.defaultModel);
    expect(config.browser.viewport).toEqual(defaults.browser.viewport);
    expect(config.models).toEqual(defaults.models);
  });
});
