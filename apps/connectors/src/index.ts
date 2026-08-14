/**
 * @hasna/connectors - Open source connector library
 *
 * Install API connectors with a single command:
 *   npx @hasna/connectors install figma stripe github
 *
 * Or use the interactive CLI:
 *   npx @hasna/connectors
 */

export {
  CONNECTORS,
  CATEGORIES,
  getConnector,
  getConnectorsByCategory,
  searchConnectors,
  loadConnectorVersions,
  type ConnectorMeta,
  type Category,
  type ScoredResult,
  type SearchContext,
} from "./lib/registry.js";

export {
  installConnector,
  installConnectors,
  getInstalledConnectors,
  removeConnector,
  connectorExists,
  getConnectorPath,
  getConnectorDocs,
  type InstallResult,
  type InstallOptions,
  type ConnectorDocs,
} from "./lib/installer.js";

export {
  runConnectorCommand,
  runConnectorOperation,
  buildConnectorOperationArgs,
  getConnectorOperations,
  getConnectorCommandHelp,
  getConnectorCliPath,
  hasConnectorCommandSurface,
  getConnectorsWithCli,
  type RunResult,
  type RunConnectorOperationArgs,
  type ConnectorOperationResult,
} from "./lib/runner.js";

export {
  defineConnector,
  executeConnectorOperation,
  getConnectorOperation,
  listConnectorOperations,
  ConnectorDefinitionError,
  ConnectorOperationNotFoundError,
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
} from "./core/index.js";

export {
  getConnectorCapability,
  getConnectorCapabilityManifest,
  type ConnectorCapability,
  type ConnectorCapabilityAuth,
  type ConnectorCapabilityDocs,
  type ConnectorCapabilityManifest,
  type ConnectorCapabilityManifestOptions,
  type ConnectorCapabilityOptions,
  type ConnectorCapabilityRuntime,
} from "./lib/manifest.js";
