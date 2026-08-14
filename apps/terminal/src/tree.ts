// Tree compression — convert flat file paths to compact tree representation

import { readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { DEFAULT_EXCLUDE_DIRS } from "./search/filters.js";

export interface TreeNode {
  name: string;
  type: "file" | "dir";
  size?: number;
  children?: TreeNode[];
  fileCount?: number;
}

/** Build a tree from a directory */
export function buildTree(
  dirPath: string,
  options: { maxDepth?: number; includeHidden?: boolean; depth?: number } = {}
): TreeNode {
  const { maxDepth = 2, includeHidden = false, depth = 0 } = options;
  const name = basename(dirPath) || dirPath;

  const node: TreeNode = { name, type: "dir", children: [], fileCount: 0 };

  if (depth >= maxDepth) {
    // Count files without listing them
    try {
      const entries = readdirSync(dirPath);
      node.fileCount = entries.length;
      node.children = undefined; // don't expand
    } catch { node.fileCount = 0; }
    return node;
  }

  try {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      if (!includeHidden && entry.startsWith(".")) continue;
      if (DEFAULT_EXCLUDE_DIRS.includes(entry)) {
        // Show as collapsed with count
        try {
          const subPath = join(dirPath, entry);
          const subStat = statSync(subPath);
          if (subStat.isDirectory()) {
            node.children!.push({ name: entry, type: "dir", fileCount: -1 }); // -1 = hidden
            continue;
          }
        } catch { continue; }
      }

      const fullPath = join(dirPath, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          node.children!.push(buildTree(fullPath, { maxDepth, includeHidden, depth: depth + 1 }));
        } else {
          node.children!.push({ name: entry, type: "file", size: stat.size });
          node.fileCount!++;
        }
      } catch { continue; }
    }
  } catch {}

  return node;
}

/** Render tree as compact string (for agents — minimum tokens) */
export function compactTree(node: TreeNode, indent: number = 0): string {
  const pad = "  ".repeat(indent);

  if (node.type === "file") return `${pad}${node.name}`;

  if (node.fileCount === -1) return `${pad}${node.name}/ (hidden)`;
  if (!node.children || node.children.length === 0) return `${pad}${node.name}/ (empty)`;
  if (!node.children.some(c => c.children)) {
    // Leaf directory — compact single line
    const files = node.children.filter(c => c.type === "file").map(c => c.name);
    const dirs = node.children.filter(c => c.type === "dir");
    const parts: string[] = [];
    if (files.length <= 5) {
      parts.push(...files);
    } else {
      parts.push(`${files.length} files`);
    }
    for (const d of dirs) {
      parts.push(`${d.name}/${d.fileCount != null ? ` (${d.fileCount === -1 ? "hidden" : d.fileCount + " files"})` : ""}`);
    }
    return `${pad}${node.name}/ [${parts.join(", ")}]`;
  }

  const lines = [`${pad}${node.name}/`];
  for (const child of node.children) {
    lines.push(compactTree(child, indent + 1));
  }
  return lines.join("\n");
}

/** Render tree as JSON (for MCP) */
export function treeToJson(node: TreeNode): object {
  return node;
}
