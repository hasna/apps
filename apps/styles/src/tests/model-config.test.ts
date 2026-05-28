import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { getActiveModel, setActiveModel, clearActiveModel, DEFAULT_MODEL } from "../lib/model-config.js";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";

const CONFIG_FILE = join(homedir(), ".styles", "config.json");

describe("model-config", () => {
  let originalContent: string | null = null;

  beforeEach(() => {
    // Backup original config if it exists
    if (existsSync(CONFIG_FILE)) {
      originalContent = readFileSync(CONFIG_FILE, "utf-8");
    }
    // Clean state
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
    }
  });

  afterEach(() => {
    // Restore original
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
    }
    if (originalContent !== null) {
      if (!existsSync(join(homedir(), ".styles"))) {
        mkdirSync(join(homedir(), ".styles"), { recursive: true });
      }
      writeFileSync(CONFIG_FILE, originalContent, "utf-8");
    }
  });

  describe("getActiveModel", () => {
    test("returns DEFAULT_MODEL when no config exists", () => {
      expect(getActiveModel()).toBe(DEFAULT_MODEL);
    });

    test("returns DEFAULT_MODEL when config has no activeModel", () => {
      if (!existsSync(join(homedir(), ".styles"))) {
        mkdirSync(join(homedir(), ".styles"), { recursive: true });
      }
      writeFileSync(CONFIG_FILE, JSON.stringify({ other: "value" }), "utf-8");
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
      const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
      expect(raw.activeModel).toBe("gpt-4o-mini");
    });

    test("overwrites existing value", () => {
      setActiveModel("gpt-4o");
      setActiveModel("gpt-4o-mini");
      expect(getActiveModel()).toBe("gpt-4o-mini");
    });

    test("preserves other config keys", () => {
      if (!existsSync(join(homedir(), ".styles"))) {
        mkdirSync(join(homedir(), ".styles"), { recursive: true });
      }
      writeFileSync(CONFIG_FILE, JSON.stringify({ other: "keep-me" }), "utf-8");
      setActiveModel("gpt-4o");
      const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
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
