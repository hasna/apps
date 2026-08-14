import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  COMMAND_ALIASES_SCHEMA,
  saveCommandAlias,
  listCommandAliases,
  resolveCommandQuery,
  explainCommandQuery,
  validateAliasName,
  importCommandAliases,
  exportCommandAliases,
} from "./command-aliases.js";

let tempDir: string;
let prevCwd: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-alias-"));
  prevCwd = process.cwd();
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("command aliases", () => {
  it("rejects reserved alias names", () => {
    const result = validateAliasName("status");
    expect(result.ok).toBe(false);
  });

  it("saves and resolves alias", () => {
    saveCommandAlias({ name: "ship", command: "done --notes shipped" });
    const resolution = resolveCommandQuery("@ship");
    expect(resolution.source).toBe("alias");
    expect(resolution.argv).toEqual(["done", "--notes", "shipped"]);
  });

  it("expands builtin shortcuts deterministically", () => {
    const pendingHigh = resolveCommandQuery("pending high");
    expect(pendingHigh.argv).toEqual(["list", "-s", "pending", "-p", "high"]);
    expect(pendingHigh.source).toBe("builtin");

    const blocked = resolveCommandQuery("blocked tasks");
    expect(blocked.argv).toEqual(["search", "--blocked"]);
  });

  it("explains composed keyword queries", () => {
    const text = explainCommandQuery("pending urgent");
    expect(text).toContain("priority=urgent");
    expect(text).toContain("todos list");
  });

  it("imports and exports alias store", () => {
    saveCommandAlias({ name: "qa", command: "verify run" });
    const exported = exportCommandAliases();
    expect(exported.schema_version).toBe(COMMAND_ALIASES_SCHEMA);

    rmSync(join(tempDir, ".todos"), { recursive: true, force: true });
    const result = importCommandAliases(exported, "overwrite");
    expect(result.imported).toBe(1);
    expect(listCommandAliases()).toHaveLength(1);
    expect(existsSync(join(tempDir, ".todos", "aliases.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(tempDir, ".todos", "aliases.json"), "utf8")).aliases.qa).toBeTruthy();
  });
});
