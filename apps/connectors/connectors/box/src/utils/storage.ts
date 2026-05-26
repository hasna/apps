import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './config';

// ============================================
// Generic Data Storage Utility
// ============================================

/**
 * Base interface for storable entities
 * All stored entities should have an id field
 */
export interface Storable {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Get the storage directory for an entity type
 */
function getStorageDir(entityType: string): string {
  const dir = join(getConfigDir(), 'data', entityType);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Convert an ID to a safe filename
 */
function idToFilename(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, '_') + '.json';
}

/**
 * Get the file path for an entity
 */
function getEntityPath(entityType: string, id: string): string {
  return join(getStorageDir(entityType), idToFilename(id));
}

/**
 * Save an entity to storage
 */
export function saveEntity<T extends Storable>(entityType: string, entity: T): void {
  const filepath = getEntityPath(entityType, entity.id);
  const now = new Date().toISOString();

  const existing = getEntity<T>(entityType, entity.id);

  const data: T = {
    ...entity,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  writeFileSync(filepath, JSON.stringify(data, null, 2));
}

/**
 * Get an entity by ID
 */
export function getEntity<T extends Storable>(entityType: string, id: string): T | null {
  const filepath = getEntityPath(entityType, id);

  if (!existsSync(filepath)) {
    return null;
  }

  try {
    const content = readFileSync(filepath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Check if an entity exists
 */
export function entityExists(entityType: string, id: string): boolean {
  return existsSync(getEntityPath(entityType, id));
}

/**
 * Get all entities of a type
 */
export function getAllEntities<T extends Storable>(entityType: string): T[] {
  const storageDir = getStorageDir(entityType);
  const files = readdirSync(storageDir).filter(f => f.endsWith('.json'));

  const entities: T[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(storageDir, file), 'utf-8');
      entities.push(JSON.parse(content) as T);
    } catch {
      // Skip invalid files
    }
  }

  return entities.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Delete an entity
 */
export function deleteEntity(entityType: string, id: string): boolean {
  const filepath = getEntityPath(entityType, id);

  if (existsSync(filepath)) {
    unlinkSync(filepath);
    return true;
  }
  return false;
}

/**
 * Search entities by a predicate function
 */
export function searchEntities<T extends Storable>(
  entityType: string,
  predicate: (entity: T) => boolean
): T[] {
  const all = getAllEntities<T>(entityType);
  return all.filter(predicate);
}

/**
 * Search entities by text match across all string fields
 */
export function searchEntitiesByText<T extends Storable>(
  entityType: string,
  query: string,
  fields?: (keyof T)[]
): T[] {
  const all = getAllEntities<T>(entityType);
  const q = query.toLowerCase();

  return all.filter(entity => {
    const searchFields = fields || (Object.keys(entity) as (keyof T)[]);
    return searchFields.some(field => {
      const value = entity[field];
      if (typeof value === 'string') {
        return value.toLowerCase().includes(q);
      }
      return false;
    });
  });
}

/**
 * Count entities of a type
 */
export function countEntities(entityType: string): number {
  const storageDir = getStorageDir(entityType);
  if (!existsSync(storageDir)) {
    return 0;
  }
  return readdirSync(storageDir).filter(f => f.endsWith('.json')).length;
}

/**
 * Clear all entities of a type
 */
export function clearEntities(entityType: string): number {
  const storageDir = getStorageDir(entityType);
  if (!existsSync(storageDir)) {
    return 0;
  }

  const files = readdirSync(storageDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    unlinkSync(join(storageDir, file));
  }

  return files.length;
}

/**
 * Create a typed storage helper for a specific entity type
 * This provides a cleaner API for working with a single entity type
 */
export function createStorage<T extends Storable>(entityType: string) {
  return {
    save: (entity: T) => saveEntity<T>(entityType, entity),
    get: (id: string) => getEntity<T>(entityType, id),
    exists: (id: string) => entityExists(entityType, id),
    getAll: () => getAllEntities<T>(entityType),
    delete: (id: string) => deleteEntity(entityType, id),
    search: (predicate: (entity: T) => boolean) => searchEntities<T>(entityType, predicate),
    searchByText: (query: string, fields?: (keyof T)[]) => searchEntitiesByText<T>(entityType, query, fields),
    count: () => countEntities(entityType),
    clear: () => clearEntities(entityType),
  };
}
