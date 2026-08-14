import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTicketsDbPath, getTicketsDir } from "./paths";
import { setActiveModel } from "./model-config";

describe("tickets data paths", () => {
  it("migrates legacy ~/.tickets files into ~/.hasna/tickets", () => {
    const originalHome = process.env["HOME"];
    const originalUserProfile = process.env["USERPROFILE"];
    const home = mkdtempSync(join(tmpdir(), "tickets-home-"));
    const legacyDir = join(home, ".tickets");
    const legacyTrainingDir = join(legacyDir, "training");
    const newDir = join(home, ".hasna", "tickets");

    process.env["HOME"] = home;
    delete process.env["USERPROFILE"];

    try {
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
    } finally {
      if (originalHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = originalHome;
      if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
      else process.env["USERPROFILE"] = originalUserProfile;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("migrates legacy files when ~/.hasna/tickets already exists", () => {
    const originalHome = process.env["HOME"];
    const originalUserProfile = process.env["USERPROFILE"];
    const home = mkdtempSync(join(tmpdir(), "tickets-home-existing-"));
    const legacyDir = join(home, ".tickets");
    const newDir = join(home, ".hasna", "tickets");

    process.env["HOME"] = home;
    delete process.env["USERPROFILE"];

    try {
      mkdirSync(legacyDir, { recursive: true });
      mkdirSync(newDir, { recursive: true });
      writeFileSync(join(legacyDir, "tickets.db"), "legacy-db");
      writeFileSync(join(newDir, "config.json"), JSON.stringify({ activeModel: "new-model" }));

      expect(getTicketsDir()).toBe(newDir);
      expect(readFileSync(join(newDir, "tickets.db"), "utf8")).toBe("legacy-db");
      expect(readFileSync(join(newDir, "config.json"), "utf8")).toContain("new-model");
    } finally {
      if (originalHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = originalHome;
      if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
      else process.env["USERPROFILE"] = originalUserProfile;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
