import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { diffMachines } from "../src/commands/diff.js";

describe("machine diff", () => {
  test("detects package and file differences", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-diff-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();

    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/hasna/workspace",
      packages: [{ name: "ripgrep", manager: "apt" }],
      files: [{ source: "~/.zshrc", target: "~/.config/zsh/.zshrc", mode: "copy" }],
    });
    manifestAdd({
      id: "apple03",
      platform: "macos",
      workspacePath: "/Users/hasna/Workspace",
      packages: [{ name: "fd", manager: "brew" }],
      files: [{ source: "~/.gitconfig", target: "~/.config/git/config", mode: "copy" }],
    });

    const diff = diffMachines("spark01", "apple03");
    expect(diff.changedFields).toContain("platform");
    expect(diff.missingPackages.leftOnly).toContain("ripgrep");
    expect(diff.missingPackages.rightOnly).toContain("fd");
  });
});
