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

// ── Extractor ─────────────────────────────────────────────────────────────────
export { extractStylesFromUrl, enrichTokensWithAi } from "./lib/extractor.js";
export type { RawExtractedStyles, ComputedElementStyles, AiEnrichment } from "./lib/extractor.js";

// ── Tokenizer ─────────────────────────────────────────────────────────────────
export { tokenizeStyles } from "./lib/tokenizer.js";
export type { DesignTokens, ColorToken, TypographyTokens } from "./lib/tokenizer.js";

// ── Transformer ───────────────────────────────────────────────────────────────
export {
  transform,
  toShadcnConfig,
  toCssVariables,
  toTailwindTheme,
  toMuiTheme,
  toRadixConfig,
} from "./lib/transformer.js";
export type { TransformFormat, TransformResult } from "./lib/transformer.js";

// ── Model config ──────────────────────────────────────────────────────────────
export {
  getActiveModel,
  setActiveModel,
  clearActiveModel,
  DEFAULT_MODEL,
} from "./lib/model-config.js";

// ── Training data gatherer ────────────────────────────────────────────────────
export { gatherTrainingData } from "./lib/gatherer.js";
export type {
  GatherTrainingDataFn,
  GatherResult,
  GathererOptions,
  TrainingExample,
} from "./lib/gatherer.js";

// ── Style Kits ────────────────────────────────────────────────────────────────
export {
  saveKit,
  getKit,
  listKits,
  updateKit,
  deleteKit,
  searchKits,
  kitToProfile,
} from "./lib/kits.js";
export type { StyleKit, CreateKitInput } from "./lib/kits.js";

// ── Accessibility audit ───────────────────────────────────────────────────────
export { auditColorContrast } from "./lib/a11y.js";
export type { A11yReport, ContrastResult, WcagLevel } from "./lib/a11y.js";

// ── Design diff ───────────────────────────────────────────────────────────────
export { diffTokens } from "./lib/diff.js";
export type { TokenDiff } from "./lib/diff.js";

// ── Figma Variables ───────────────────────────────────────────────────────────
export { toFigmaVariables, publishToFigma } from "./lib/figma.js";
export type { FigmaVariablesPayload, FigmaVariable } from "./lib/figma.js";

// ── Screenshot extraction ─────────────────────────────────────────────────────
export { extractStylesFromScreenshot, extractStylesFromFile } from "./lib/extractor.js";
