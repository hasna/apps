// ── Database ──────────────────────────────────────────────────────────────────
export { getDb, initDb, DB_PATH } from "./lib/db.js";

// ── Registry ──────────────────────────────────────────────────────────────────
export {
  STYLES,
  CATEGORIES,
  ALL_STYLE_NAMES,
  getStyle,
  searchStyles,
  getStylesByCategory,
  findSimilarStyles,
} from "./lib/registry.js";
export type { StyleMeta, Category, StyleName } from "./lib/registry.js";

// ── Filesystem helpers ────────────────────────────────────────────────────────
export {
  getStylesDir,
  getProjectsDir,
  initStylesDir,
  hashProjectPath,
  getProjectDir,
  initProjectDir,
  getProjectConfig,
  setProjectConfig,
  listProjectDirs,
  getHealthDir,
  getOutputDir,
  writeStyleContextFile,
} from "./lib/fs.js";
export type { ProjectConfig } from "./lib/fs.js";

// ── Style profiles ────────────────────────────────────────────────────────────
export {
  createProfile,
  getProfile,
  getProfileByName,
  listProfiles,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  getActiveProfile,
  getBuiltinStyleProfile,
} from "./lib/profiles.js";
export type { StyleProfile, CreateProfileInput } from "./lib/profiles.js";

// ── Preferences ───────────────────────────────────────────────────────────────
export {
  getPref,
  setPref,
  deletePref,
  listPrefs,
  getPrefs,
} from "./lib/preferences.js";

// ── Templates ─────────────────────────────────────────────────────────────────
export {
  createTemplate,
  getTemplate,
  listTemplates,
  deleteTemplate,
  applyTemplate,
} from "./lib/templates.js";
export type {
  StyleTemplate,
  CreateTemplateInput,
  ApplyResult,
} from "./lib/templates.js";

// ── Health checks ─────────────────────────────────────────────────────────────
export {
  BUILTIN_RULES,
  getDefaultRules,
  checkFile,
  runHealthCheck,
} from "./lib/health.js";
export type {
  StyleRule,
  FileViolation,
  HealthCheckResult,
  FileCacheEntry,
  HealthCheckOptions,
} from "./lib/health.js";

// ── Health diff ───────────────────────────────────────────────────────────────
export { getHealthDiff } from "./lib/healthdiff.js";
export type { HealthDiffResult } from "./lib/healthdiff.js";

// ── AI inspector ──────────────────────────────────────────────────────────────
export {
  isCerebrasAvailable,
  inspectFile,
  inspectProject,
} from "./lib/inspector.js";
export type { AIViolation, InspectionResult } from "./lib/inspector.js";

// ── Task generation ───────────────────────────────────────────────────────────
export { createTasksFromViolations } from "./lib/taskgen.js";
export type { CreatedTask } from "./lib/taskgen.js";

// ── Hook manager ──────────────────────────────────────────────────────────────
export {
  getClaudeSettingsPath,
  injectStyleHook,
  injectAllStyleHooks,
  removeStyleHook,
  removeAllStyleHooks,
  isHookInstalled,
  getInstalledAgentHooks,
} from "./lib/hookmanager.js";
export type { InjectResult } from "./lib/hookmanager.js";

// ── Project detection ─────────────────────────────────────────────────────────
export {
  detectProjectPath,
  detectAgents,
  hasAnyAgent,
  getDetectedAgentNames,
  AGENT_DIRS,
} from "./lib/detect.js";
export type { AgentName, DetectedAgents } from "./lib/detect.js";

// ── Context injector ──────────────────────────────────────────────────────────
export {
  buildContextSection,
  injectIntoClaudeMd,
  injectIntoAgentMd,
  injectIntoAllAgentMds,
  removeFromClaudeMd,
  removeFromAgentMd,
  removeFromAllAgentMds,
} from "./lib/contextinjector.js";

// ── Fixer ─────────────────────────────────────────────────────────────────────
export { getFixSuggestions, applyFixes } from "./lib/fixer.js";
export type { FixSuggestion, FixResult } from "./lib/fixer.js";

// ── Examples ──────────────────────────────────────────────────────────────────
export { getExample, listExamples, PATTERNS } from "./lib/examples.js";
export type { Pattern } from "./lib/examples.js";
