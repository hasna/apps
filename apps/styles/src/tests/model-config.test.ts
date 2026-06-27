import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { getActiveModel, setActiveModel, clearActiveModel, DEFAULT_MODEL } from "../lib/model-config.js";
import { getModelConfigPath } from "../lib/paths.js";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

function configFile(): string {
  return getModelConfigPath();
}

describe("model-config", () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let testHome = "";

  beforeEach(() => {
    originalHome = process.env["HOME"];
    originalUserProfile = process.env["USERPROFILE"];
    testHome = join(tmpdir(), `styles-model-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env["HOME"] = testHome;
    delete process.env["USERPROFILE"];
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = originalHome;
    if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
    else process.env["USERPROFILE"] = originalUserProfile;
    rmSync(testHome, { recursive: true, force: true });
  });

  describe("getActiveModel", () => {
    test("returns DEFAULT_MODEL when no config exists", () => {
      expect(getActiveModel()).toBe(DEFAULT_MODEL);
    });

    test("returns DEFAULT_MODEL when config has no activeModel", () => {
      if (!existsSync(join(testHome, ".hasna", "styles"))) {
        mkdirSync(join(testHome, ".hasna", "styles"), { recursive: true });
      }
      writeFileSync(configFile(), JSON.stringify({ other: "value" }), "utf-8");
      expect(getActiveModel()).toBe(DEFAULT_MODEL);
    });

    test("returns the stored active model", () => {
      setActiveModel("gpt-4o");
      expect(getActiveModel()).toBe("gpt-4o");
    });
  });

  describe("setActiveModel", () => {
    test("stores the model id in config file", () => {
      setActiveModel("gpt-4o-mini");
      const raw = JSON.parse(readFileSync(configFile(), "utf-8"));
      expect(raw.activeModel).toBe("gpt-4o-mini");
    });

    test("overwrites existing value", () => {
      setActiveModel("gpt-4o");
      setActiveModel("gpt-4o-mini");
      expect(getActiveModel()).toBe("gpt-4o-mini");
    });

    test("preserves other config keys", () => {
      if (!existsSync(join(testHome, ".hasna", "styles"))) {
        mkdirSync(join(testHome, ".hasna", "styles"), { recursive: true });
      }
      writeFileSync(configFile(), JSON.stringify({ other: "keep-me" }), "utf-8");
      setActiveModel("gpt-4o");
      const raw = JSON.parse(readFileSync(configFile(), "utf-8"));
      expect(raw.other).toBe("keep-me");
    });
  });

  describe("clearActiveModel", () => {
    test("removes activeModel from config", () => {
      setActiveModel("gpt-4o");
      clearActiveModel();
      expect(getActiveModel()).toBe(DEFAULT_MODEL);
    });

    test("is idempotent when no model is set", () => {
      clearActiveModel();
      expect(getActiveModel()).toBe(DEFAULT_MODEL);
    });
  });
});
