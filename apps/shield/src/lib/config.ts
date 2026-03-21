import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";
import { homedir } from "os";
import { type ConfigFile, DEFAULT_CONFIG } from "../types/index.js";

const CONFIG_DIR_NAME = ".security";
const CONFIG_FILE_NAME = "config.json";

export function getGlobalConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME);
}

export function getGlobalConfigPath(): string {
  return join(getGlobalConfigDir(), CONFIG_FILE_NAME);
}

export function getProjectConfigDir(projectPath: string): string {
  return join(projectPath, CONFIG_DIR_NAME);
}

export function getProjectConfigPath(projectPath: string): string {
  return join(getProjectConfigDir(projectPath), CONFIG_FILE_NAME);
}

export function getConfigPath(projectPath?: string): string {
  if (projectPath) {
    const projectConfig = getProjectConfigPath(projectPath);
    if (existsSync(projectConfig)) {
      return projectConfig;
    }
  }

  const globalConfig = getGlobalConfigPath();
  if (existsSync(globalConfig)) {
    return globalConfig;
  }

  // Default to project if projectPath given, else global
  return projectPath
    ? getProjectConfigPath(projectPath)
    : getGlobalConfigPath();
}

function readConfigFile(path: string): Partial<ConfigFile> {
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Partial<ConfigFile>;
  } catch {
    return {};
  }
}

export function loadConfig(projectPath?: string): ConfigFile {
  // Start with defaults
  const config = { ...DEFAULT_CONFIG };

  // Merge global config
  const globalConfig = readConfigFile(getGlobalConfigPath());
  Object.assign(config, globalConfig);

  // Merge project-local config on top (if exists)
  if (projectPath) {
    const projectConfig = readConfigFile(getProjectConfigPath(projectPath));
    Object.assign(config, projectConfig);
  }

  return config;
}

export function saveConfig(
  config: Partial<ConfigFile>,
  projectPath?: string,
): void {
  const targetDir = projectPath
    ? getProjectConfigDir(projectPath)
    : getGlobalConfigDir();
  const targetPath = projectPath
    ? getProjectConfigPath(projectPath)
    : getGlobalConfigPath();

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // Load existing config and merge
  const existing = readConfigFile(targetPath);
  const merged = { ...existing, ...config };

  writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

export function initProject(path: string): void {
  const configDir = getProjectConfigDir(path);
  const configPath = getProjectConfigPath(path);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
      "utf-8",
    );
  }

  // Create .gitignore inside .security to ignore cache/db files
  const gitignorePath = join(configDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, "*.db\n*.db-journal\ncache/\n", "utf-8");
  }
}
