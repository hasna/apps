import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { diffStations } from "../src/commands/diff.js";

describe("machine diff", () => {
  test("detects package and file differences", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-diff-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    manifestInit();

    manifestAdd({
      id: "demo-node-01",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      packages: [{ name: "ripgrep", manager: "apt" }],
      files: [{ source: "~/.zshrc", target: "~/.config/zsh/.zshrc", mode: "copy" }],
    });
    manifestAdd({
      id: "demo-controller-03",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
      packages: [{ name: "fd", manager: "brew" }],
      files: [{ source: "~/.gitconfig", target: "~/.config/git/config", mode: "copy" }],
    });

    const diff = diffStations("demo-node-01", "demo-controller-03");
    expect(diff.changedFields).toContain("platform");
    expect(diff.missingPackages.leftOnly).toContain("ripgrep");
    expect(diff.missingPackages.rightOnly).toContain("fd");
  });
});
