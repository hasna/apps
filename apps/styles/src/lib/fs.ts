import { homedir } from "os";
import { join, basename } from "path";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "fs";

export interface ProjectConfig {
  projectPath: string;
  profileId: string | null;
  activeTemplateId: string | null;
  customOverrides: Record<string, unknown>;
  hookInstalled: boolean;
  updatedAt: number;
}

export function getStylesDir(): string {
  return join(homedir(), ".styles");
}

export function getProjectsDir(): string {
  return join(getStylesDir(), "projects");
}

export function initStylesDir(): void {
  const dirs = [
    getStylesDir(),
    getProjectsDir(),
    join(getStylesDir(), "cache"),
    join(getStylesDir(), "logs"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Creates a stable, human-readable directory name from a project path.
 * e.g. /Users/alice/my-app → "bXNlcnMvYW" + "-my-app"  (base64url prefix + basename)
 */
export function hashProjectPath(p: string): string {
  const encoded = Buffer.from(p).toString("base64url").slice(0, 16);
  const name = basename(p);
  return `${encoded}-${name}`;
}

export function getProjectDir(projectPath: string): string {
  return join(getProjectsDir(), hashProjectPath(projectPath));
}

export function initProjectDir(projectPath: string): void {
  const dir = getProjectDir(projectPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const healthDir = getHealthDir(projectPath);
  if (!existsSync(healthDir)) {
    mkdirSync(healthDir, { recursive: true });
  }
  const outputDir = getOutputDir(projectPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
}

export function getProjectConfig(projectPath: string): ProjectConfig | null {
  const configPath = join(getProjectDir(projectPath), "project.json");
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return null;
  }
}

export function setProjectConfig(
  projectPath: string,
  config: ProjectConfig
): void {
  initProjectDir(projectPath);
  const configPath = join(getProjectDir(projectPath), "project.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function listProjectDirs(): string[] {
  const projectsDir = getProjectsDir();
  if (!existsSync(projectsDir)) return [];

  const results: string[] = [];
  try {
    const entries = readdirSync(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const configPath = join(projectsDir, entry.name, "project.json");
      if (!existsSync(configPath)) continue;
      try {
        const raw = readFileSync(configPath, "utf-8");
        const config = JSON.parse(raw) as ProjectConfig;
        if (config.projectPath) {
          results.push(config.projectPath);
        }
      } catch {
        // skip malformed config
      }
    }
  } catch {
    // directory not readable
  }
  return results;
}

export function getHealthDir(projectPath: string): string {
  return join(getProjectDir(projectPath), "health");
}

export function getOutputDir(projectPath: string): string {
  return join(getProjectDir(projectPath), "output");
}

/**
 * Writes a style context file into the project's .styles directory.
 * This is the file AI coding agents read to understand the active design style.
 */
export function writeStyleContextFile(
  projectPath: string,
  styleContent: string
): void {
  const stylesDir = join(projectPath, ".styles");
  if (!existsSync(stylesDir)) {
    mkdirSync(stylesDir, { recursive: true });
  }
  writeFileSync(join(stylesDir, "style.md"), styleContent, "utf-8");
}
