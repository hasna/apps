/**
 * Compatibility facade for the pre-Stage-A local executable API.
 *
 * Every exported operation enters the same ambient-first classifier before
 * delegating. This keeps the compatibility surface while preventing a missed
 * per-function option shape from bypassing hosted/S3 containment.
 */
import { dirname, join } from 'node:path';
import {
  assertClassifiedSourceReference,
  assertContainedSourceGraph,
  assertContainedSourceDataGraph,
  assertPublicInvocation,
  denyPublicAuth,
  safePublicProperty,
} from './public-guard.js';

import { buildKnowledgeAgentContextPack as buildKnowledgeAgentContextPackImpl } from './context-pack.js';
import {
  assertAppWikiWriteAllowed as assertAppWikiWriteAllowedImpl,
  getAppWikiNote as getAppWikiNoteImpl,
  ingestAppWikiSourceRef as ingestAppWikiSourceRefImpl,
  initAppWikiScope as initAppWikiScopeImpl,
  listAppWikiNotes as listAppWikiNotesImpl,
  writeAppWikiNote as writeAppWikiNoteImpl,
  type AppWikiSourceRefInput,
} from './app-wiki.js';
import { proposeKnowledgeSyncConflictResolutionWithAi as proposeKnowledgeSyncConflictResolutionWithAiImpl } from './conflict-agent.js';
import {
  createKnowledgeMachinesAdapter as createKnowledgeMachinesAdapterImpl,
  discoverKnowledgeMachineTopology as discoverKnowledgeMachineTopologyImpl,
  preflightKnowledgeMachine as preflightKnowledgeMachineImpl,
  resolveKnowledgeMachineRoute as resolveKnowledgeMachineRouteImpl,
  resolveKnowledgeMachineWorkspace as resolveKnowledgeMachineWorkspaceImpl,
  type KnowledgeMachinesAdapter,
  type KnowledgeMachinesAdapterDefaults,
} from './machines.js';
import {
  applyKnowledgeSyncBundle as applyKnowledgeSyncBundleImpl,
  createKnowledgeSyncBundle as createKnowledgeSyncBundleImpl,
  createKnowledgeSyncSnapshot as createKnowledgeSyncSnapshotImpl,
  getKnowledgeSyncStatus as getKnowledgeSyncStatusImpl,
  listKnowledgeMachines as listKnowledgeMachinesImpl,
  listKnowledgeSyncConflicts as listKnowledgeSyncConflictsImpl,
  recordKnowledgeSyncConflict as recordKnowledgeSyncConflictImpl,
  refreshMachineRegistryFromTopology as refreshMachineRegistryFromTopologyImpl,
  upsertKnowledgeMachine as upsertKnowledgeMachineImpl,
} from './sync.js';
import {
  ensureKnowledgeWorkspace as ensureKnowledgeWorkspaceImpl,
  readKnowledgeConfig as readKnowledgeConfigImpl,
  writeKnowledgeConfig as writeKnowledgeConfigImpl,
} from './workspace.js';
import { createArtifactStore as createArtifactStoreImpl } from './artifact-store.js';
import { hybridSearch as hybridSearchImpl } from './search.js';
import { retrieveKnowledgeContext as retrieveKnowledgeContextImpl } from './retrieval.js';
import { runKnowledgePrompt as runKnowledgePromptImpl } from './agent.js';
import {
  embedTexts as embedTextsImpl,
  embeddingIndexStatus as embeddingIndexStatusImpl,
  indexKnowledgeEmbeddings as indexKnowledgeEmbeddingsImpl,
  searchVectorIndex as searchVectorIndexImpl,
} from './embeddings.js';
import { runProviderWebSearch as runProviderWebSearchImpl } from './web-search.js';
import { explicitOwnGlobalReadAuthority } from './service.js';
import {
  compileWikiPage as compileWikiPageImpl,
  fileAnswerToWiki as fileAnswerToWikiImpl,
  lintWiki as lintWikiImpl,
} from './wiki-compiler.js';
import { importRulesProvenance as importRulesProvenanceImpl } from './rules-provenance.js';
import {
  resolveOpenFilesSource as resolveOpenFilesSourceImpl,
  type SourceResolveOptions,
  type SourceResolveResult,
} from './source-resolver.js';
import type {
  ManifestIngestOptions,
  ManifestIngestResult,
  ManifestItemsIngestOptions,
} from './manifest-ingest.js';
import type { SourceIngestOptions, SourceIngestResult } from './source-ingest.js';
import type { OutboxConsumeOptions, OutboxConsumeResult } from './outbox-consume.js';
import {
  enqueueMissingEmbeddings as enqueueMissingEmbeddingsImpl,
  refreshEmbeddingIndex as refreshEmbeddingIndexImpl,
  reindexHealth as reindexHealthImpl,
} from './reindex.js';

function guarded<T extends (...args: any[]) => any>(
  implementation: T,
  configPathForArgs?: (args: Parameters<T>) => string | undefined,
  beforeArgumentValidation?: (args: Parameters<T>) => void,
): T {
  const invoke = (receiver: unknown, args: Parameters<T>) => {
    // This first call intentionally precedes even positional path derivation.
    assertPublicInvocation();
    beforeArgumentValidation?.(args);
    assertPublicInvocation(args, { explicitConfigPath: configPathForArgs?.(args) });
    return Reflect.apply(implementation, receiver, args);
  };
  let wrapper: (...args: Parameters<T>) => ReturnType<T>;
  try {
    Reflect.construct(String, [], implementation);
    wrapper = function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
      return invoke(this, args);
    };
  } catch {
    wrapper = (...args: Parameters<T>): ReturnType<T> => invoke(undefined, args);
  }
  Object.defineProperties(wrapper, {
    name: { value: implementation.name, configurable: true },
    length: { value: implementation.length, configurable: true },
  });
  return wrapper as T;
}

function guardedGlobalRead<T extends (options: any, ...rest: any[]) => any>(implementation: T): T {
  const wrapped = guarded(implementation, undefined, ([options]) => {
    const scope = options && typeof options === 'object'
      ? safePublicProperty(options, 'scope', 'public-api')
      : undefined;
    if (scope === 'global') {
      explicitOwnGlobalReadAuthority('global', options);
    }
  });
  Object.defineProperties(wrapped, {
    name: { value: implementation.name, configurable: true },
    length: { value: implementation.length, configurable: true },
  });
  return wrapped;
}

function configBesideDb(path: unknown): string | undefined {
  return typeof path === 'string' ? join(dirname(path), 'config.json') : undefined;
}

export const buildKnowledgeAgentContextPack = guardedGlobalRead(buildKnowledgeAgentContextPackImpl);
export const assertAppWikiWriteAllowed = guarded(assertAppWikiWriteAllowedImpl);
export const initAppWikiScope = guarded(initAppWikiScopeImpl);
export const writeAppWikiNote = guarded(writeAppWikiNoteImpl);
export const listAppWikiNotes = guarded(listAppWikiNotesImpl);
export const getAppWikiNote = guarded(getAppWikiNoteImpl);
export async function ingestAppWikiSourceRef(
  options: AppWikiSourceRefInput,
): Promise<SourceIngestResult> {
  assertPublicInvocation();
  assertPublicInvocation([options]);
  assertContainedSourceGraph(options);
  assertClassifiedSourceReference(safePublicProperty(options, 'sourceRef'));
  return ingestAppWikiSourceRefImpl(options);
}
export const proposeKnowledgeSyncConflictResolutionWithAi = guarded(proposeKnowledgeSyncConflictResolutionWithAiImpl);

export const discoverKnowledgeMachineTopology = guarded(discoverKnowledgeMachineTopologyImpl);
export const resolveKnowledgeMachineRoute = guarded(resolveKnowledgeMachineRouteImpl);
export const resolveKnowledgeMachineWorkspace = guarded(resolveKnowledgeMachineWorkspaceImpl);
export const preflightKnowledgeMachine = guarded(preflightKnowledgeMachineImpl);

export function createKnowledgeMachinesAdapter(
  defaults: KnowledgeMachinesAdapterDefaults = {},
): KnowledgeMachinesAdapter {
  assertPublicInvocation([defaults]);
  const adapter = createKnowledgeMachinesAdapterImpl(defaults);
  const guardedAdapter: KnowledgeMachinesAdapter = {
    mode: adapter.mode,
    status() {
      assertPublicInvocation();
      return adapter.status();
    },
    topology(options) {
      assertPublicInvocation([options]);
      return adapter.topology(options);
    },
    route(options) {
      assertPublicInvocation([options]);
      return adapter.route(options);
    },
    workspace(options) {
      assertPublicInvocation([options]);
      return adapter.workspace(options);
    },
    preflight(options) {
      assertPublicInvocation([options]);
      return adapter.preflight(options);
    },
  };
  return guardedAdapter;
}

export const applyKnowledgeSyncBundle = guarded(applyKnowledgeSyncBundleImpl);
export const createKnowledgeSyncBundle = guarded(createKnowledgeSyncBundleImpl);
export const createKnowledgeSyncSnapshot = guarded(createKnowledgeSyncSnapshotImpl);
export const getKnowledgeSyncStatus = guarded(getKnowledgeSyncStatusImpl);
export const listKnowledgeMachines = guarded(listKnowledgeMachinesImpl, ([path]) => configBesideDb(path));
export const listKnowledgeSyncConflicts = guarded(listKnowledgeSyncConflictsImpl, ([path]) => configBesideDb(path));
export const recordKnowledgeSyncConflict = guarded(recordKnowledgeSyncConflictImpl, ([path]) => configBesideDb(path));
export const refreshMachineRegistryFromTopology = guarded(refreshMachineRegistryFromTopologyImpl);
export const upsertKnowledgeMachine = guarded(upsertKnowledgeMachineImpl);

export const ensureKnowledgeWorkspace = guarded(
  ensureKnowledgeWorkspaceImpl,
  ([home]) => typeof home === 'string' ? join(home, 'config.json') : undefined,
);
export const readKnowledgeConfig = guarded(
  readKnowledgeConfigImpl,
  ([path]) => typeof path === 'string' ? path : undefined,
);
export const writeKnowledgeConfig = guarded(
  writeKnowledgeConfigImpl,
  ([path]) => typeof path === 'string' ? path : undefined,
);

export function createArtifactStore(
  config: Parameters<typeof createArtifactStoreImpl>[0],
  workspace: Parameters<typeof createArtifactStoreImpl>[1],
): ReturnType<typeof createArtifactStoreImpl> {
  assertPublicInvocation([config, workspace]);
  return createArtifactStoreImpl(config, workspace);
}

export const hybridSearch = guardedGlobalRead(hybridSearchImpl);
export const retrieveKnowledgeContext = guardedGlobalRead(retrieveKnowledgeContextImpl);
export const runKnowledgePrompt = guardedGlobalRead(runKnowledgePromptImpl);
export const embedTexts = guarded(embedTextsImpl);
export const embeddingIndexStatus = guarded(embeddingIndexStatusImpl, ([path]) => configBesideDb(path));
export const indexKnowledgeEmbeddings = guarded(indexKnowledgeEmbeddingsImpl);
export const searchVectorIndex = guarded(searchVectorIndexImpl);
// Web search is more restrictive than the ambient local facade: it is an
// unconditional pre-argument Stage-A boundary on every public surface.
export const runProviderWebSearch = runProviderWebSearchImpl;

export const compileWikiPage = guarded(compileWikiPageImpl);
export const fileAnswerToWiki = guarded(fileAnswerToWikiImpl);
export const lintWiki = guarded(lintWikiImpl);

function assertLocalInputPath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) assertClassifiedSourceReference(value);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) assertClassifiedSourceReference(value);
}

export async function ingestOpenFilesManifest(
  options: ManifestIngestOptions,
): Promise<ManifestIngestResult> {
  assertPublicInvocation();
  assertPublicInvocation([options]);
  assertLocalInputPath(safePublicProperty(options, 'input'));
  const implementation = await import('./manifest-ingest.js');
  return implementation.ingestOpenFilesManifest(options);
}

export async function ingestOpenFilesManifestItems(
  options: ManifestItemsIngestOptions,
): Promise<ManifestIngestResult> {
  assertPublicInvocation();
  assertContainedSourceDataGraph(safePublicProperty(options, 'items'));
  assertPublicInvocation([options]);
  const implementation = await import('./manifest-ingest.js');
  return implementation.ingestOpenFilesManifestItems(options);
}

export async function ingestSourceRef(
  options: SourceIngestOptions,
): Promise<SourceIngestResult> {
  assertPublicInvocation();
  assertPublicInvocation([options]);
  assertContainedSourceGraph(options);
  assertClassifiedSourceReference(safePublicProperty(options, 'sourceRef'));
  const implementation = await import('./source-ingest.js');
  return implementation.ingestSourceRef(options);
}
export const importRulesProvenance = guarded(importRulesProvenanceImpl);
export async function resolveOpenFilesSource(
  options: SourceResolveOptions,
): Promise<SourceResolveResult> {
  assertPublicInvocation();
  assertPublicInvocation([options]);
  assertContainedSourceGraph(options);
  assertClassifiedSourceReference(safePublicProperty(options, 'sourceRef'), { allowStored: true });
  return resolveOpenFilesSourceImpl(options);
}
export async function consumeOpenFilesOutbox(
  options: OutboxConsumeOptions,
): Promise<OutboxConsumeResult> {
  assertPublicInvocation();
  assertPublicInvocation([options]);
  assertLocalInputPath(safePublicProperty(options, 'input'));
  const implementation = await import('./outbox-consume.js');
  return implementation.consumeOpenFilesOutbox(options);
}
export const enqueueMissingEmbeddings = guarded(enqueueMissingEmbeddingsImpl);
export const refreshEmbeddingIndex = guarded(refreshEmbeddingIndexImpl);
export const reindexHealth = guarded(reindexHealthImpl);

// Public root auth compatibility is deliberately zero-read and zero-I/O.
export function getKnowledgeAuth(_env: unknown = undefined): never { return denyPublicAuth(); }
export function saveKnowledgeAuth(_auth: unknown, _env: unknown = undefined): never { return denyPublicAuth(); }
export function clearKnowledgeAuth(_env: unknown = undefined): never { return denyPublicAuth(); }
export function getKnowledgeApiKey(_env: unknown = undefined): never { return denyPublicAuth(); }
export function knowledgeAuthStatus(_config: unknown, _env: unknown = undefined): never { return denyPublicAuth(); }

// Bun may suffix a bundled declaration when the contained implementation has
// the same local name. Public reflection is a compatibility contract, so pin
// the names explicitly without exposing or invoking those implementations.
for (const [callable, name] of [
  [createKnowledgeMachinesAdapter, 'createKnowledgeMachinesAdapter'],
  [createArtifactStore, 'createArtifactStore'],
  [ingestAppWikiSourceRef, 'ingestAppWikiSourceRef'],
  [ingestOpenFilesManifest, 'ingestOpenFilesManifest'],
  [ingestOpenFilesManifestItems, 'ingestOpenFilesManifestItems'],
  [ingestSourceRef, 'ingestSourceRef'],
  [resolveOpenFilesSource, 'resolveOpenFilesSource'],
  [consumeOpenFilesOutbox, 'consumeOpenFilesOutbox'],
  [getKnowledgeAuth, 'getKnowledgeAuth'],
  [saveKnowledgeAuth, 'saveKnowledgeAuth'],
  [clearKnowledgeAuth, 'clearKnowledgeAuth'],
  [getKnowledgeApiKey, 'getKnowledgeApiKey'],
  [knowledgeAuthStatus, 'knowledgeAuthStatus'],
] as const) {
  Object.defineProperty(callable, 'name', { value: name, configurable: true });
}
