import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getActiveModel, setActiveModel, clearActiveModel } from "./model-config";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDataDir } from "./db";

const TEST_CONFIG_DIR = join(tmpdir(), `conversations-test-model-config-${Date.now()}`);
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "config.json");
const originalGetDataDir = getDataDir;

describe("model-config", () => {
  beforeEach(() => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    process.env.CONVERSATIONS_DB_PATH = join(TEST_CONFIG_DIR, "test.db");
    // Override config path
    process.env.CONVERSATIONS_CONFIG_PATH = TEST_CONFIG_PATH;
  });

  afterEach(() => {
    delete process.env.CONVERSATIONS_DB_PATH;
    delete process.env.CONVERSATIONS_CONFIG_PATH;
    try { rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
  });

  describe("getActiveModel", () => {
    test("returns default model when no config exists", () => {
      const model = getActiveModel();
      expect(model).toBe("gpt-4o-mini");
    });

    test("returns default model when config has no activeModel", () => {
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify({}));
      const model = getActiveModel();
      expect(model).toBe("gpt-4o-mini");
    });

    test("returns activeModel when set", () => {
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ activeModel: "my-custom-model" }));
      const model = getActiveModel();
      expect(model).toBe("my-custom-model");
    });

    test("returns default when config is invalid JSON", () => {
      writeFileSync(TEST_CONFIG_PATH, "not json");
      const model = getActiveModel();
      expect(model).toBe("gpt-4o-mini");
    });
  });

  describe("setActiveModel", () => {
    test("sets active model in config file", () => {
      setActiveModel("custom-model");
      const config = JSON.parse(readFileSync(TEST_CONFIG_PATH, "utf-8"));
      expect(config.activeModel).toBe("custom-model");
    });

    test("overwrites existing active model", () => {
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ activeModel: "old-model" }));
      setActiveModel("new-model");
      const config = JSON.parse(readFileSync(TEST_CONFIG_PATH, "utf-8"));
      expect(config.activeModel).toBe("new-model");
    });

    test("preserves other config fields", () => {
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ otherField: "value" }));
      setActiveModel("model");
      const config = JSON.parse(readFileSync(TEST_CONFIG_PATH, "utf-8"));
      expect(config.otherField).toBe("value");
      expect(config.activeModel).toBe("model");
    });
  });

  describe("clearActiveModel", () => {
    test("removes activeModel from config", () => {
      setActiveModel("to-clear");
      clearActiveModel();
      const config = JSON.parse(readFileSync(TEST_CONFIG_PATH, "utf-8"));
      expect(config.activeModel).toBeUndefined();
    });

    test("preserves other fields when clearing", () => {
      setActiveModel("to-clear");
      const config = JSON.parse(readFileSync(TEST_CONFIG_PATH, "utf-8"));
      config.otherField = "keep";
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));
      clearActiveModel();
      const updated = JSON.parse(readFileSync(TEST_CONFIG_PATH, "utf-8"));
      expect(updated.otherField).toBe("keep");
      expect(updated.activeModel).toBeUndefined();
    });

    test("does not throw when no config exists", () => {
      // Don't create config, just clear
      expect(() => clearActiveModel()).not.toThrow();
    });
  });
});
