import { describe, it, expect } from "bun:test";
import { buildTree, compactTree } from "./tree.js";
import { basename } from "path";

describe("buildTree", () => {
  it("builds tree from current directory", () => {
    const tree = buildTree(process.cwd(), { maxDepth: 1 });
    expect(tree.type).toBe("dir");
    expect(tree.name).toBe(basename(process.cwd()));
    expect(Array.isArray(tree.children)).toBe(true);
  });

  it("respects maxDepth", () => {
    const tree = buildTree(process.cwd(), { maxDepth: 0 });
    expect(tree.fileCount).toBeGreaterThan(0);
    expect(tree.children).toBeUndefined();
  });

  it("skips hidden files by default", () => {
    const tree = buildTree(process.cwd(), { maxDepth: 1 });
    expect(tree.children?.some(c => c.name.startsWith("."))).toBe(false);
  });

  it("includes hidden files with includeHidden", () => {
    const tree = buildTree(process.cwd(), { maxDepth: 1, includeHidden: true });
    expect(tree.children?.some(c => c.name.startsWith("."))).toBe(true);
  });

  it("collapses excluded directories", () => {
    const tree = buildTree(process.cwd(), { maxDepth: 1 });
    const nodeModules = tree.children?.find(c => c.name === "node_modules");
    if (nodeModules) {
      expect(nodeModules.fileCount).toBe(-1); // hidden/excluded marker
    }
  });
});

describe("compactTree", () => {
  it("renders a file as plain name", () => {
    const node = { name: "package.json", type: "file" as const };
    expect(compactTree(node)).toBe("package.json");
  });

  it("renders an empty dir", () => {
    const node = { name: "empty", type: "dir" as const, children: [] };
    expect(compactTree(node)).toBe("empty/ (empty)");
  });

  it("renders a leaf dir compactly", () => {
    const node = {
      name: "src", type: "dir" as const,
      children: [
        { name: "main.ts", type: "file" as const },
        { name: "utils.ts", type: "file" as const },
      ]
    };
    expect(compactTree(node)).toBe("src/ [main.ts, utils.ts]");
  });

  it("collapses many files in leaf dir", () => {
    const node = {
      name: "src", type: "dir" as const,
      children: Array(6).fill(null).map((_, i) => ({ name: `file${i}.ts`, type: "file" as const }))
    };
    expect(compactTree(node)).toContain("6 files");
  });
});
