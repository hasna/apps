import { cpSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const LEGACY_STYLES_DIRS = [".open-styles", ".styles"] as const;

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

export function getStylesDir(): string {
  const home = homeDir();
  const dir = join(home, ".hasna", "styles");
  migrateLegacyStylesDirs(home, dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getTrainingDir(): string {
  return join(getStylesDir(), "training");
}

export function getModelConfigPath(): string {
  return join(getStylesDir(), "config.json");
}

function migrateLegacyStylesDirs(home: string, targetDir: string): void {
  for (const legacyName of LEGACY_STYLES_DIRS) {
    const legacyDir = join(home, legacyName);
    if (!existsSync(legacyDir) || legacyDir === targetDir) continue;
    try {
      mkdirSync(targetDir, { recursive: true });
      cpSync(legacyDir, targetDir, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    } catch {
      // Best-effort copy-forward only. Existing ~/.hasna/styles data wins.
    }
  }
}
