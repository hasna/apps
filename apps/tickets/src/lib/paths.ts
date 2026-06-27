import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getHomeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

function copyDirectory(sourceDir: string, targetDir: string): void {
  try {
    mkdirSync(targetDir, { recursive: true });
    for (const entry of readdirSync(sourceDir)) {
      const sourcePath = join(sourceDir, entry);
      const targetPath = join(targetDir, entry);
      try {
        const stat = statSync(sourcePath);
        if (stat.isDirectory()) {
          copyDirectory(sourcePath, targetPath);
        } else if (stat.isFile() && !existsSync(targetPath)) {
          copyFileSync(sourcePath, targetPath);
        }
      } catch {
        // Best-effort legacy migration; unreadable entries should not block startup.
      }
    }
  } catch {
    // Best-effort legacy migration; unreadable directories should not block startup.
  }
}

export function getTicketsDir(): string {
  const home = getHomeDir();
  const newDir = join(home, ".hasna", "tickets");
  const legacyDir = join(home, ".tickets");

  if (existsSync(legacyDir)) {
    copyDirectory(legacyDir, newDir);
  }

  return newDir;
}

export function getTicketsDbPath(): string {
  return join(getTicketsDir(), "tickets.db");
}
