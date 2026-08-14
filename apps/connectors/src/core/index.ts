export {
  ConnectorDefinitionError,
  ConnectorOperationNotFoundError,
} from "./errors.js";

export {
  defineConnector,
  executeConnectorOperation,
  getConnectorOperation,
  listConnectorOperations,
  type ConnectorAuthDefinition,
  type ConnectorAuthField,
  type ConnectorAuthType,
  type ConnectorCommandDescriptor,
  type ConnectorCommandResult,
  type ConnectorCommandRuntime,
  type ConnectorContextFactoryArgs,
  type ConnectorDefinition,
  type ConnectorMetadata,
  type ConnectorOperationContext,
  type ConnectorOperationDefinition,
  type ConnectorOperationMap,
  type ExecuteConnectorOperationArgs,
  type InternalConnectorDefinition,
  type InternalConnectorOperationDefinition,
} from "./connector.js";

export {
  INTERNAL_CONNECTOR_DEFINITIONS,
  INTERNAL_CONNECTOR_REGISTRY,
  getInternalConnectorDefinition,
  hasInternalConnectorDefinition,
  listInternalConnectorCatalogEntries,
  listInternalConnectorDefinitions,
} from "./builtins.js";

export {
  createConnectorDefinitionRegistry,
  getConnectorDefinition,
  hasConnectorDefinition,
  listConnectorCatalogEntries,
  listConnectorDefinitions,
  toConnectorCatalogEntry,
  type ConnectorCatalogEntry,
  type ConnectorDefinitionRegistry,
} from "./registry.js";
