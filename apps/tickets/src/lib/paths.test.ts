import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getTicketsDir,
  getTicketsDbPath,
  getTrainingDir,
  legacyHomeDir,
  resolverHome,
  adoptResolverHome,
  exactTicketsDir,
  hasExactTicketsOverride,
} from "./paths";
import { setActiveModel } from "./model-config";

let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalDataHome: string | undefined;
let originalTicketsHome: string | undefined;
let originalTicketsHomeShort: string | undefined;
let testHome = "";

beforeEach(() => {
  originalHome = process.env["HOME"];
  originalUserProfile = process.env["USERPROFILE"];
  originalDataHome = process.env["HASNA_DATA_HOME"];
  originalTicketsHome = process.env["HASNA_TICKETS_HOME"];
  originalTicketsHomeShort = process.env["TICKETS_HOME"];
  testHome = mkdtempSync(join(tmpdir(), "tickets-paths-home-"));
  process.env["HOME"] = testHome;
  delete process.env["USERPROFILE"];
  // Hermetic: the @hasna/paths resolver and exact-app overrides must not
  // inherit ambient values.
  delete process.env["HASNA_DATA_HOME"];
  delete process.env["HASNA_TICKETS_HOME"];
  delete process.env["TICKETS_HOME"];
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
  else process.env["USERPROFILE"] = originalUserProfile;
  if (originalDataHome === undefined) delete process.env["HASNA_DATA_HOME"];
  else process.env["HASNA_DATA_HOME"] = originalDataHome;
  if (originalTicketsHome === undefined) delete process.env["HASNA_TICKETS_HOME"];
  else process.env["HASNA_TICKETS_HOME"] = originalTicketsHome;
  if (originalTicketsHomeShort === undefined) delete process.env["TICKETS_HOME"];
  else process.env["TICKETS_HOME"] = originalTicketsHomeShort;
  rmSync(testHome, { recursive: true, force: true });
});

describe("tickets data paths", () => {
  it("defaults to the legacy ~/.hasna/tickets home when nothing opts into XDG", () => {
    const dir = getTicketsDir();
    expect(dir).toBe(join(testHome, ".hasna", "tickets"));
    expect(existsSync(dir)).toBe(true);
    expect(legacyHomeDir()).toBe(join(testHome, ".hasna", "tickets"));
  });

  it("resolverHome resolves the @hasna/paths data home", () => {
    expect(resolverHome()).toBe(join(testHome, ".local", "share", "hasna", "tickets"));
  });

  it("HASNA_DATA_HOME opts in and redirects the effective home to the resolver data home", () => {
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    const dir = getTicketsDir();
    expect(dir).toBe(join(testHome, "xdg-data", "tickets"));
    expect(existsSync(dir)).toBe(true);
    expect(adoptResolverHome(resolverHome())).toBe(true);
  });

  it("a migrated tickets.db at the resolver home adopts it", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "tickets.db"), "x");
    expect(getTicketsDir()).toBe(resolved);
  });

  it("a migrated config.json at the resolver home adopts it", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "config.json"), "{}");
    expect(getTicketsDir()).toBe(resolved);
  });

  it("HASNA_TICKETS_HOME exact override wins unconditionally over the resolver", () => {
    process.env["HASNA_TICKETS_HOME"] = join(testHome, "custom-tickets");
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    expect(getTicketsDir()).toBe(join(testHome, "custom-tickets"));
    expect(hasExactTicketsOverride()).toBe(true);
    expect(exactTicketsDir()).toBe(join(testHome, "custom-tickets"));
  });

  it("HASNA_TICKETS_HOME wins over the bare TICKETS_HOME alias", () => {
    process.env["HASNA_TICKETS_HOME"] = join(testHome, "a");
    process.env["TICKETS_HOME"] = join(testHome, "b");
    expect(getTicketsDir()).toBe(join(testHome, "a"));
  });

  it("getTrainingDir and getTicketsDbPath hang off the effective home", () => {
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    expect(getTrainingDir()).toBe(join(testHome, "xdg-data", "tickets", "training"));
    expect(getTicketsDbPath()).toBe(join(testHome, "xdg-data", "tickets", "tickets.db"));
  });

  it("legacy ~/.tickets copies into the effective (XDG) home when adopted", () => {
    const legacyDir = join(testHome, ".tickets");
    const legacyTrainingDir = join(legacyDir, "training");
    mkdirSync(legacyTrainingDir, { recursive: true });
    writeFileSync(join(legacyDir, "tickets.db"), "legacy-db");
    writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ activeModel: "legacy-model" }));
    writeFileSync(join(legacyTrainingDir, "sample.jsonl"), "{\"input\":\"hello\"}\n");
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    const dir = getTicketsDir();
    expect(dir).toBe(join(testHome, "xdg-data", "tickets"));
    expect(readFileSync(join(dir, "tickets.db"), "utf8")).toBe("legacy-db");
    expect(readFileSync(join(dir, "config.json"), "utf8")).toContain("legacy-model");
    expect(readFileSync(join(dir, "training", "sample.jsonl"), "utf8")).toContain("hello");
    expect(existsSync(join(legacyDir, "config.json"))).toBe(true);
  });

  it("migrates legacy ~/.tickets files into the default legacy ~/.hasna/tickets home", () => {
    const legacyDir = join(testHome, ".tickets");
    const legacyTrainingDir = join(legacyDir, "training");
    const newDir = join(testHome, ".hasna", "tickets");

    mkdirSync(legacyTrainingDir, { recursive: true });
    writeFileSync(join(legacyDir, "tickets.db"), "legacy-db");
    writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ activeModel: "legacy-model" }));
    writeFileSync(join(legacyTrainingDir, "sample.jsonl"), "{\"input\":\"hello\"}\n");

    expect(getTicketsDir()).toBe(newDir);
    expect(getTicketsDbPath()).toBe(join(newDir, "tickets.db"));
    expect(readFileSync(join(newDir, "tickets.db"), "utf8")).toBe("legacy-db");
    expect(readFileSync(join(newDir, "config.json"), "utf8")).toContain("legacy-model");
    expect(readFileSync(join(newDir, "training", "sample.jsonl"), "utf8")).toContain("hello");

    setActiveModel("new-model");
    expect(readFileSync(join(newDir, "config.json"), "utf8")).toContain("new-model");
    expect(existsSync(join(legacyDir, "config.json"))).toBe(true);
  });

  it("migrates legacy files when the effective home already exists", () => {
    const legacyDir = join(testHome, ".tickets");
    const newDir = join(testHome, ".hasna", "tickets");

    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(legacyDir, "tickets.db"), "legacy-db");
    writeFileSync(join(newDir, "config.json"), JSON.stringify({ activeModel: "new-model" }));

    expect(getTicketsDir()).toBe(newDir);
    expect(readFileSync(join(newDir, "tickets.db"), "utf8")).toBe("legacy-db");
    expect(readFileSync(join(newDir, "config.json"), "utf8")).toContain("new-model");
  });
});
