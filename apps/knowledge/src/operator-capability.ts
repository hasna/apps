import { KnowledgeContainmentError } from './runtime-role.js';
import type { KnowledgeRuntimeResolution } from './runtime-role.js';

const operatorMarker = Symbol('knowledge-operator-capability');

export interface KnowledgeOperatorCapability {
  readonly entrypoint: 'scripts/apply-cloud-migrations.mjs' | 'internal-storage-test';
  readonly [operatorMarker]: true;
}

export function createKnowledgeOperatorCapability(
  entrypoint: KnowledgeOperatorCapability['entrypoint'],
): KnowledgeOperatorCapability {
  return Object.freeze({ entrypoint, [operatorMarker]: true }) as KnowledgeOperatorCapability;
}

export function assertKnowledgeOperatorCapability(
  capability: KnowledgeOperatorCapability | undefined,
): asserts capability is KnowledgeOperatorCapability {
  if (!capability || capability[operatorMarker] !== true) {
    throw new KnowledgeContainmentError(
      'KNOWLEDGE_OPERATOR_REQUIRED',
      503,
      'invalid',
      'operator-migration',
      'an internal operator capability is required before Postgres or schema construction',
    );
  }
}

export function assertKnowledgeOperatorRuntime(
  capability: KnowledgeOperatorCapability | undefined,
): KnowledgeRuntimeResolution {
  assertKnowledgeOperatorCapability(capability);
  return {
    role: 'operator-migration',
    surface: 'operator-migration',
    source: 'branded-operator-capability',
    signals: [],
    issues: [],
  };
}
