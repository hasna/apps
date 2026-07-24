// @generated from the @hasna/contracts 0.4.0 declarations; Stage-A runtime containment stub.
import { KnowledgeContainmentError } from '../../runtime-role.js';

export const STORAGE_MODES = ['local', 'cloud'] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];
export const DEPRECATED_STORAGE_MODE_ALIASES = ['remote', 'hybrid', 'self_hosted'] as const;
export type Env = Record<string, string | undefined>;

export interface StorageModeNormalization {
  mode: StorageMode;
  deprecatedAlias: string | null;
}

export interface StorageEnvKeys {
  modeKeys: string[];
  databaseUrlKeys: string[];
}

export interface StorageModeResolution {
  mode: StorageMode;
  source: string;
  deprecatedAlias: string | null;
  databaseUrlPresent: boolean;
  databaseUrlSource: string | null;
  warning: string | null;
}

function containedMode(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED', 503, 'hosted-client', 'public-api',
    'storage mode capability is unavailable during Stage A',
  );
}

export function normalizeStorageMode(value: string): StorageModeNormalization {
  return containedMode();
}

export function envToken(name: string): string {
  return containedMode();
}

export function storageEnvKeys(name: string): StorageEnvKeys {
  return containedMode();
}

export function resolveStorageMode(name: string, env?: Env): StorageModeResolution;
export function resolveStorageMode(name: string): StorageModeResolution {
  return containedMode();
}

export function resolveDatabaseUrl(name: string, env?: Env): string | null;
export function resolveDatabaseUrl(name: string): string | null {
  return null;
}
