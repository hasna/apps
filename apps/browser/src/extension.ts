export {
  ExtensionPage,
  createExtensionPage,
  getExtensionStatuses,
  getPairedExtensionOrThrow,
  isExtensionPage,
} from "./engines/extension.js";
export {
  attachExtensionSocket,
  consumeExtensionPairingCode,
  createExtensionPairing,
  detachExtensionSocket,
  dispatchExtensionJob,
  getConnectedExtension,
  getExtensionBridgeStatus,
  handleExtensionSocketMessage,
  hasConnectedExtension,
  prepareExtensionSocketUpgrade,
  resetExtensionBridgeForTests,
  revokeExtensionToken,
  validateExtensionDispatchJob,
  validateExtensionToken,
} from "./lib/extension-bridge.js";
export type {
  ConnectedExtensionStatus,
  ExtBridgeMessage,
  ExtExtractFormat,
  ExtJob,
  ExtensionBridgeStatus,
  ExtensionPairing,
  ExtResult,
} from "./types/index.js";
export type {
  ConnectedExtension,
  ExtensionSocketData,
} from "./lib/extension-bridge.js";
