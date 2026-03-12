// Types
export * from "./types/index.js";

// DB — configs
export { createConfig, getConfig, getConfigById, listConfigs, updateConfig, deleteConfig, getConfigStats } from "./db/configs.js";

// DB — snapshots
export { createSnapshot, listSnapshots, getSnapshot, getSnapshotByVersion, pruneSnapshots } from "./db/snapshots.js";

// DB — profiles
export { createProfile, getProfile, listProfiles, updateProfile, deleteProfile, addConfigToProfile, removeConfigFromProfile, getProfileConfigs } from "./db/profiles.js";

// DB — machines
export { registerMachine, updateMachineApplied, listMachines, currentHostname, currentOs } from "./db/machines.js";

// DB — database utilities
export { getDatabase, resetDatabase, uuid, now, slugify } from "./db/database.js";

// Lib — apply
export { applyConfig, applyConfigs, expandPath } from "./lib/apply.js";
export type { ApplyOptions } from "./lib/apply.js";

// Lib — sync
export { syncFromDir, syncToDir, diffConfig, detectCategory, detectAgent, detectFormat } from "./lib/sync.js";
export type { SyncFromDirOptions, SyncToDirOptions } from "./lib/sync.js";

// Lib — export/import
export { exportConfigs } from "./lib/export.js";
export { importConfigs } from "./lib/import.js";
export type { ExportOptions } from "./lib/export.js";
export type { ImportOptions, ImportResult } from "./lib/import.js";

// Lib — template
export { parseTemplateVars, extractTemplateVars, renderTemplate, isTemplate } from "./lib/template.js";
export type { TemplateVar } from "./lib/template.js";
