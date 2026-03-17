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
  getConnectorOperations,
  getConnectorCommandHelp,
  getConnectorCliPath,
  getConnectorsWithCli,
  type RunResult,
} from "./lib/runner.js";
