// Output store — saves full raw output to disk when AI compresses it
// Agents can read the file for full detail. Tiered retention strategy.

import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { getTerminalDir } from "./paths.js";
import { buildOutputManifest } from "./output-manifest.js";

const OUTPUTS_DIR = join(getTerminalDir(), "outputs");
const MANIFESTS_DIR = join(getTerminalDir(), "manifests");

/** Ensure outputs directory exists */
function ensureDir() {
  if (!existsSync(OUTPUTS_DIR)) mkdirSync(OUTPUTS_DIR, { recursive: true });
  if (!existsSync(MANIFESTS_DIR)) mkdirSync(MANIFESTS_DIR, { recursive: true });
}

/** Generate a short hash for an output */
function hashOutput(command: string, output: string): string {
  return createHash("md5").update(command + output.slice(0, 1000)).digest("hex").slice(0, 12);
}

/** Tiered retention: recent = keep all, older = keep only high-value */
function rotate() {
  try {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    const ONE_DAY = 24 * ONE_HOUR;

    const files = readdirSync(OUTPUTS_DIR)
      .filter(f => f.endsWith(".txt"))
      .map(f => {
        const path = join(OUTPUTS_DIR, f);
        const stat = statSync(path);
        return { name: f, path, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first

    for (const file of files) {
      const age = now - file.mtime;

      // Last 1 hour: keep everything
      if (age < ONE_HOUR) continue;

      // Last 24 hours: keep outputs >2KB (meaningful compression)
      if (age < ONE_DAY) {
        if (file.size < 2000) {
          try { unlinkSync(file.path); } catch {}
        }
        continue;
      }

      // Older than 24h: keep only >10KB (high-value saves)
      if (file.size < 10000) {
        try { unlinkSync(file.path); } catch {}
        continue;
      }

      // Older than 7 days: remove everything
      if (age > 7 * ONE_DAY) {
        try { unlinkSync(file.path); } catch {}
      }
    }

    // Hard cap: never exceed 100 files or 10MB total
    const remaining = readdirSync(OUTPUTS_DIR)
      .filter(f => f.endsWith(".txt"))
      .map(f => ({ path: join(OUTPUTS_DIR, f), mtime: statSync(join(OUTPUTS_DIR, f)).mtimeMs, size: statSync(join(OUTPUTS_DIR, f)).size }))
      .sort((a, b) => b.mtime - a.mtime);

    let totalSize = 0;
    for (let i = 0; i < remaining.length; i++) {
      totalSize += remaining[i].size;
      if (i >= 100 || totalSize > 10 * 1024 * 1024) {
        try { unlinkSync(remaining[i].path); } catch {}
      }
    }
  } catch {}
}

/** Save full output to disk, return the file path */
export function saveOutput(command: string, rawOutput: string): string {
  ensureDir();

  const hash = hashOutput(command, rawOutput);
  const filename = `${hash}.txt`;
  const filepath = join(OUTPUTS_DIR, filename);

  const content = `$ ${command}\n${"─".repeat(60)}\n${rawOutput}`;
  writeFileSync(filepath, content, "utf8");

  rotate();
  return filepath;
}

/** Save a compact structured manifest for outputs where full raw text is too noisy. */
export function saveOutputManifest(command: string, rawOutput: string): string | null {
  const manifest = buildOutputManifest(command, rawOutput);
  if (!manifest) return null;
  ensureDir();

  const rawHash = hashOutput(command, rawOutput);
  const rawPath = join(OUTPUTS_DIR, `${rawHash}.raw.txt`);
  writeFileSync(rawPath, `$ ${command}\n${"─".repeat(60)}\n${rawOutput}`, "utf8");

  const content = `${manifest.content}\nraw-ref: ${rawPath}`;
  const hash = hashOutput(command, content);
  const filename = `${hash}.${manifest.kind}.txt`;
  const filepath = join(MANIFESTS_DIR, filename);
  writeFileSync(filepath, content, "utf8");
  return filepath;
}

/** Format the hint line that tells agents where to find full output */
export function formatOutputHint(filepath: string): string {
  const home = process.env.HOME;
  const displayPath = home && filepath.startsWith(home) ? `~${filepath.slice(home.length)}` : filepath;
  return `[full: ${displayPath}]`;
}

/** Format the compact manifest hint line. */
export function formatManifestHint(filepath: string): string {
  const home = process.env.HOME;
  const displayPath = home && filepath.startsWith(home) ? `~${filepath.slice(home.length)}` : filepath;
  return `[manifest: ${displayPath}]`;
}

/** Get the outputs directory path */
export function getOutputsDir(): string {
  return OUTPUTS_DIR;
}

/** Manually purge all outputs */
export function purgeOutputs(): number {
  if (!existsSync(OUTPUTS_DIR)) return 0;
  let count = 0;
  for (const f of readdirSync(OUTPUTS_DIR)) {
    try { unlinkSync(join(OUTPUTS_DIR, f)); count++; } catch {}
  }
  return count;
}
