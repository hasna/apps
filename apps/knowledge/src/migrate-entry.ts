#!/usr/bin/env bun
import { KnowledgeContainmentError } from './runtime-role.js';

/** Public compatibility launcher with no private capability construction. */
export function mainKnowledgeMigrationEntry(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_OPERATOR_REQUIRED',
    503,
    'invalid',
    'operator-migration',
    'cloud migrations require a private supervised operator artifact that is not published',
  );
}

if (import.meta.main) {
  try {
    mainKnowledgeMigrationEntry();
  } catch (error) {
    if (error instanceof KnowledgeContainmentError) {
      console.error(JSON.stringify(error.toJSON()));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
