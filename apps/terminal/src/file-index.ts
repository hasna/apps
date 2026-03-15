// Pre-computed file index — build once, serve search from memory
// Eliminates subprocess spawning for repeat file queries

import { spawn } from "child_process";
import { watch, type FSWatcher } from "fs";

interface FileIndexEntry {
  path: string;
  dir: string;
  name: string;
  ext: string;
}

let index: FileIndexEntry[] | null = null;
let indexCwd: string = "";
let indexTime: number = 0;
let watcher: FSWatcher | null = null;

const INDEX_TTL = 30_000; // 30 seconds

function exec(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("/bin/zsh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => resolve(out));
  });
}

/** Build or return cached file index */
export async function getFileIndex(cwd: string): Promise<FileIndexEntry[]> {
  // Return cached if fresh
  if (index && indexCwd === cwd && Date.now() - indexTime < INDEX_TTL) {
    return index;
  }

  const raw = await exec(
    "find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*' -not -path '*/build/*' 2>/dev/null",
    cwd
  );

  index = raw.split("\n").filter(l => l.trim()).map(p => {
    const path = p.trim();
    const parts = path.split("/");
    const name = parts[parts.length - 1] ?? path;
    const dir = parts.slice(0, -1).join("/") || ".";
    const ext = name.includes(".") ? "." + name.split(".").pop() : "";
    return { path, dir, name, ext };
  });

  indexCwd = cwd;
  indexTime = Date.now();

  return index;
}

/** Search file index by glob pattern (in-memory, no subprocess) */
export async function searchIndex(cwd: string, pattern: string): Promise<string[]> {
  const idx = await getFileIndex(cwd);

  // Convert glob to regex
  const regex = new RegExp(
    "^" + pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")
    + "$",
    "i"
  );

  return idx.filter(e => regex.test(e.name) || regex.test(e.path)).map(e => e.path);
}

/** Get file index stats */
export async function indexStats(cwd: string): Promise<{ totalFiles: number; byExtension: Record<string, number>; byDir: Record<string, number> }> {
  const idx = await getFileIndex(cwd);

  const byExt: Record<string, number> = {};
  const byDir: Record<string, number> = {};

  for (const e of idx) {
    byExt[e.ext || "(none)"] = (byExt[e.ext || "(none)"] ?? 0) + 1;
    const topDir = e.dir.split("/").slice(0, 2).join("/");
    byDir[topDir] = (byDir[topDir] ?? 0) + 1;
  }

  return { totalFiles: idx.length, byExtension: byExt, byDir };
}

/** Invalidate index */
export function invalidateIndex(): void {
  index = null;
}
