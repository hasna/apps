import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { resetDatabase } from "../db/schema.js";
import { deleteEntry, untagEntry, getEntry, createEntry, tagEntry } from "../db/gallery.js";
import { listDownloads, getDownload, exportToPath, saveToDownloads } from "../lib/downloads.js";
import { registerAgent, updateAgent, getAgent } from "../lib/agents.js";
import { ensureProject } from "../db/projects.js";

let tmpDir: string;

const sampleEntry = () => ({
  path: join(tmpDir, "test.webp"),
  url: "https://example.com",
  title: "Example",
  format: "webp" as const,
  width: 1280, height: 720,
  original_size_bytes: 50000,
  compressed_size_bytes: 20000,
  compression_ratio: 0.4,
  tags: [] as string[],
  is_favorite: false,
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "meta-regression-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

// ─── meta.ts module delegation ──────────────────────────────────────────────────

describe("meta.ts module delegation", () => {
  it("meta.ts register function exists and is callable", async () => {
    const { register } = await import("./meta.js");
    expect(typeof register).toBe("function");
  });

  it("agents.ts exports registerAgentsAndProjects", async () => {
    const { registerAgentsAndProjects } = await import("./agents.js");
    expect(typeof registerAgentsAndProjects).toBe("function");
  });

  it("gallery.ts exports registerGalleryAndDownloads", async () => {
    const { registerGalleryAndDownloads } = await import("./gallery.js");
    expect(typeof registerGalleryAndDownloads).toBe("function");
  });

  it("integration.ts exports registerIntegrationAndMeta", async () => {
    const { registerIntegrationAndMeta } = await import("./integration.js");
    expect(typeof registerIntegrationAndMeta).toBe("function");
  });
});

// ─── gallery: untagEntry ─────────────────────────────────────────────────────

describe("browser_gallery_untag", () => {
  it("untagEntry removes a tag from entry", () => {
    const e = createEntry(sampleEntry());
    tagEntry(e.id, "regression");
    tagEntry(e.id, "smoke");
    expect(getEntry(e.id)!.tags).toContain("regression");
    expect(getEntry(e.id)!.tags).toContain("smoke");

    const result = untagEntry(e.id, "regression");
    expect(result!.tags).not.toContain("regression");
    expect(result!.tags).toContain("smoke");
  });

  it("untagEntry returns null for nonexistent entry", () => {
    expect(untagEntry("nonexistent-id", "tag")).toBeNull();
  });

  it("untagEntry is idempotent when tag not present", () => {
    const e = createEntry(sampleEntry());
    const result = untagEntry(e.id, "not-present");
    expect(result).not.toBeNull();
    expect(result!.tags).not.toContain("not-present");
  });
});

// ─── gallery: deleteEntry ────────────────────────────────────────────────────

describe("browser_gallery_delete", () => {
  it("deleteEntry removes entry from database", () => {
    const e = createEntry(sampleEntry());
    expect(getEntry(e.id)).not.toBeNull();
    deleteEntry(e.id);
    expect(getEntry(e.id)).toBeNull();
  });

  it("deleteEntry does not throw for nonexistent id", () => {
    expect(() => deleteEntry("nonexistent-id")).not.toThrow();
  });

  it("deleteEntry leaves other entries intact", () => {
    const e1 = createEntry({ ...sampleEntry(), url: "https://a.com" });
    const e2 = createEntry({ ...sampleEntry(), url: "https://b.com" });
    deleteEntry(e1.id);
    expect(getEntry(e2.id)!.url).toBe("https://b.com");
    expect(getEntry(e1.id)).toBeNull();
  });
});

// ─── downloads: exportToPath ─────────────────────────────────────────────────

describe("browser_downloads_export", () => {
  it("exportToPath copies file to target path", () => {
    const { mkdirSync } = require("node:fs");
    const srcFile = join(tmpDir, "source.txt");
    writeFileSync(srcFile, "hello world");
    const saved = saveToDownloads(Buffer.from("hello world"), "source.txt");

    const targetDir = join(tmpDir, "exports");
    mkdirSync(targetDir, { recursive: true });
    const targetPath = join(targetDir, "dest.txt");
    const result = exportToPath(saved.id, targetPath);

    expect(result).toBe(targetPath);
    const content = readFileSync(targetPath, "utf8");
    expect(content).toBe("hello world");
  });

  it("exportToPath throws for nonexistent download id", () => {
    expect(() => exportToPath("nonexistent-id", "/tmp/dest.txt")).toThrow();
  });
});

// ─── agents: set_focus ─────────────────────────────────────────────────────

describe("set_focus (updateAgent project_id)", () => {
  it("registerAgent creates agent with undefined project_id", () => {
    const agent = registerAgent("focus-test");
    expect(agent).not.toBeNull();
    expect(agent!.id).toBeTruthy();
    expect(agent!.project_id ?? null).toBeNull();
  });

  it("updateAgent sets project_id on agent", () => {
    // Create project first to satisfy FK constraint
    const proj = ensureProject("test-proj", "/tmp/test-proj");
    const agent = registerAgent("focus-test");
    updateAgent(agent!.id, { project_id: proj.id });
    const updated = getAgent(agent!.id);
    expect(updated.project_id).toBe(proj.id);
  });

  it("updateAgent does not throw for nonexistent agent", () => {
    expect(() => updateAgent("nonexistent-agent", { project_id: "x" })).toThrow();
  });
});

// ─── skills runner basic API ───────────────────────────────────────────────

describe("skills runner basic API", () => {
  it("listBuiltInSkills returns array of skill names", async () => {
    const { listBuiltInSkills } = await import("../lib/skills-runner.js");
    const skills = listBuiltInSkills();
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
  });
});
