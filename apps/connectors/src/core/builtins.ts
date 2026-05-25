import type { InternalConnectorDefinition } from "./connector.js";
import {
  createConnectorDefinitionRegistry,
  getConnectorDefinition,
  hasConnectorDefinition,
  listConnectorCatalogEntries,
  listConnectorDefinitions,
} from "./registry.js";
import { githubConnector } from "./connectors/github.js";
import { googleDriveConnector } from "./connectors/googledrive.js";
import { imessageConnector } from "./connectors/imessage.js";
import { stripeConnector } from "./connectors/stripe.js";

/**
 * Source of truth for migrated internal connectors.
 * The registry coexists with the legacy metadata catalog while execution
 * gradually moves from standalone connector CLIs to one internal product
 * surface.
 */
export const INTERNAL_CONNECTOR_DEFINITIONS: InternalConnectorDefinition<any>[] = [
  githubConnector,
  googleDriveConnector,
  imessageConnector,
  stripeConnector,
];

export const INTERNAL_CONNECTOR_REGISTRY = createConnectorDefinitionRegistry(
  INTERNAL_CONNECTOR_DEFINITIONS
);

export function listInternalConnectorDefinitions() {
  return listConnectorDefinitions(INTERNAL_CONNECTOR_REGISTRY);
}

export function listInternalConnectorCatalogEntries() {
  return listConnectorCatalogEntries(INTERNAL_CONNECTOR_REGISTRY);
}

export function getInternalConnectorDefinition(name: string) {
  return getConnectorDefinition(INTERNAL_CONNECTOR_REGISTRY, name);
}

export function hasInternalConnectorDefinition(name: string) {
  return hasConnectorDefinition(INTERNAL_CONNECTOR_REGISTRY, name);
}
