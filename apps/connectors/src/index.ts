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
} from "./lib/registry.js";

export {
  installConnector,
  installConnectors,
  getInstalledConnectors,
  removeConnector,
  connectorExists,
  getConnectorPath,
  type InstallResult,
  type InstallOptions,
} from "./lib/installer.js";
