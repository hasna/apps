import type {
  ConnectorAuthType,
  InternalConnectorDefinition,
} from "./connector.js";
import { ConnectorDefinitionError } from "./errors.js";
import { listConnectorOperations } from "./connector.js";

export interface ConnectorCatalogEntry {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version?: string;
  tags: string[];
  authType: ConnectorAuthType;
  supportsProfiles: boolean;
  operationCount: number;
}

export interface ConnectorDefinitionRegistry<TContext = unknown> {
  readonly all: InternalConnectorDefinition<TContext>[];
  readonly byName: ReadonlyMap<string, InternalConnectorDefinition<TContext>>;
}

export function createConnectorDefinitionRegistry<TContext = unknown>(
  definitions: InternalConnectorDefinition<TContext>[]
): ConnectorDefinitionRegistry<TContext> {
  const byName = new Map<string, InternalConnectorDefinition<TContext>>();

  for (const definition of definitions) {
    const existing = byName.get(definition.meta.name);
    if (existing) {
      throw new ConnectorDefinitionError(
        `Duplicate connector definition '${definition.meta.name}'`
      );
    }
    byName.set(definition.meta.name, definition);
  }

  return {
    all: [...definitions].sort((a, b) =>
      a.meta.name.localeCompare(b.meta.name)
    ),
    byName,
  };
}

export function listConnectorDefinitions<TContext = unknown>(
  registry: ConnectorDefinitionRegistry<TContext>
): InternalConnectorDefinition<TContext>[] {
  return [...registry.all];
}

export function getConnectorDefinition<TContext = unknown>(
  registry: ConnectorDefinitionRegistry<TContext>,
  name: string
): InternalConnectorDefinition<TContext> | undefined {
  return registry.byName.get(name);
}

export function hasConnectorDefinition<TContext = unknown>(
  registry: ConnectorDefinitionRegistry<TContext>,
  name: string
): boolean {
  return registry.byName.has(name);
}

export function toConnectorCatalogEntry<TContext = unknown>(
  definition: InternalConnectorDefinition<TContext>
): ConnectorCatalogEntry {
  return {
    name: definition.meta.name,
    displayName: definition.meta.displayName,
    description: definition.meta.description,
    category: definition.meta.category,
    version: definition.meta.version,
    tags: [...(definition.meta.tags ?? [])],
    authType: definition.auth.type,
    supportsProfiles: definition.auth.supportsProfiles ?? false,
    operationCount: listConnectorOperations(definition).length,
  };
}

export function listConnectorCatalogEntries<TContext = unknown>(
  registry: ConnectorDefinitionRegistry<TContext>
): ConnectorCatalogEntry[] {
  return registry.all.map(toConnectorCatalogEntry);
}
