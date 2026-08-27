import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverDataRoot,
  exactDataRoot,
  getDataDir,
  legacyDataRoot,
  resolveFeedbackDataDir,
  resolveFeedbackFilePath,
  resolverDataRoot,
} from "./storage.paths.js";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = mkdtempSync(join(tmpdir(), `feedback-paths-test-`));
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const ENV_KEYS = [
  "HASNA_FEEDBACK_HOME",
  "FEEDBACK_HOME",
  "HASNA_DATA_HOME",
  "HASNA_FEEDBACK_DATA_DIR",
  "FEEDBACK_DATA_DIR",
] as const;
const previous = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  // Remove any resolver-home store a prior test may have planted.
  rmSync(join(resolverDataRoot(), "feedback.db"), { force: true });
  rmSync(join(resolverDataRoot(), "feedback.jsonl"), { force: true });
});

afterAll(() => {
  process.env.HOME = savedHome;
  for (const key of ENV_KEYS) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(testHome, { recursive: true, force: true });
});

describe("feedback data-dir resolution", () => {
  it("defaults to ~/.hasna/feedback until the XDG store exists or HASNA_DATA_HOME is set", () => {
    expect(legacyDataRoot()).toBe(join(testHome, ".hasna", "feedback"));
    expect(resolverDataRoot()).toBe(join(testHome, ".local", "share", "hasna", "feedback"));
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(false);
    expect(getDataDir()).toBe(legacyDataRoot());
    expect(resolveFeedbackDataDir()).toBe(legacyDataRoot());
    expect(resolveFeedbackFilePath()).toBe(join(legacyDataRoot(), "feedback.jsonl"));
  });

  it("adopts the resolver data root when HASNA_DATA_HOME is set", () => {
    const dataHome = join(testHome, "xdg-data");
    process.env["HASNA_DATA_HOME"] = dataHome;
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(true);
    expect(getDataDir()).toBe(join(dataHome, "feedback"));
  });

  it("adopts the resolver data root once the store has been migrated there (sqlite)", () => {
    const resolved = resolverDataRoot();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "feedback.db"), "");
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(true);
    expect(getDataDir()).toBe(resolved);
    expect(resolveFeedbackDataDir()).toBe(resolved);
  });

  it("adopts the resolver data root once the store has been migrated there (jsonl)", () => {
    const resolved = resolverDataRoot();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "feedback.jsonl"), "");
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(true);
    expect(getDataDir()).toBe(resolved);
  });

  it("lets the exact-app HASNA_FEEDBACK_HOME override win over the resolver", () => {
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    process.env["HASNA_FEEDBACK_HOME"] = "/tmp/feedback-home";
    expect(exactDataRoot()).toBe("/tmp/feedback-home");
    expect(getDataDir()).toBe("/tmp/feedback-home");
    expect(resolveFeedbackDataDir()).toBe("/tmp/feedback-home");
  });

  it("lets the FEEDBACK_HOME override win too", () => {
    process.env["HASNA_FEEDBACK_HOME"] = "/tmp/feedback-home-a";
    process.env["FEEDBACK_HOME"] = "/tmp/feedback-home-b";
    expect(exactDataRoot()).toBe("/tmp/feedback-home-a");
  });

  it("treats blank or whitespace-only HASNA_FEEDBACK_HOME as unset", () => {
    process.env["HASNA_FEEDBACK_HOME"] = "";
    expect(exactDataRoot()).toBeUndefined();
    expect(getDataDir()).toBe(legacyDataRoot());
    process.env["HASNA_FEEDBACK_HOME"] = "   ";
    expect(exactDataRoot()).toBeUndefined();
    expect(getDataDir()).toBe(legacyDataRoot());
  });

  it("falls through to FEEDBACK_HOME when HASNA_FEEDBACK_HOME is blank or whitespace-only", () => {
    // Restore immediately (try/finally): the afterAll restore only replays the
    // last beforeEach-saved value, which can re-leak a value set mid-file into
    // sibling test files running in the same process.
    process.env["FEEDBACK_HOME"] = "/tmp/feedback-home-b";
    try {
      process.env["HASNA_FEEDBACK_HOME"] = "";
      expect(exactDataRoot()).toBe("/tmp/feedback-home-b");
      expect(getDataDir()).toBe("/tmp/feedback-home-b");
      process.env["HASNA_FEEDBACK_HOME"] = "   ";
      expect(exactDataRoot()).toBe("/tmp/feedback-home-b");
      expect(getDataDir()).toBe("/tmp/feedback-home-b");
    } finally {
      delete process.env["HASNA_FEEDBACK_HOME"];
      delete process.env["FEEDBACK_HOME"];
    }
  });

  it("trims valid HASNA_FEEDBACK_HOME values", () => {
    process.env["HASNA_FEEDBACK_HOME"] = "  /tmp/feedback-home  ";
    expect(exactDataRoot()).toBe("/tmp/feedback-home");
    expect(getDataDir()).toBe("/tmp/feedback-home");
  });

  it("keeps the explicit HASNA_FEEDBACK_DATA_DIR / FEEDBACK_DATA_DIR override winning", () => {
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    process.env["HASNA_FEEDBACK_HOME"] = "/tmp/feedback-home";
    process.env["HASNA_FEEDBACK_DATA_DIR"] = "/tmp/feedback-data-dir";
    expect(resolveFeedbackDataDir()).toBe("/tmp/feedback-data-dir");
    expect(resolveFeedbackFilePath()).toBe(join("/tmp/feedback-data-dir", "feedback.jsonl"));
    delete process.env["HASNA_FEEDBACK_DATA_DIR"];
    process.env["FEEDBACK_DATA_DIR"] = "/tmp/feedback-data-dir-legacy";
    expect(resolveFeedbackDataDir()).toBe("/tmp/feedback-data-dir-legacy");
  });
});
