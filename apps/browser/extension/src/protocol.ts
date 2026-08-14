export type {
  ExtBridgeMessage,
  ExtExtractFormat,
  ExtJob,
  ExtResult,
} from "../../src/types/index.js";

export interface ExtensionStorageState {
  serverUrl?: string;
  token?: string;
  code?: string;
  name?: string;
  status?: "idle" | "pairing" | "connected" | "disconnected" | "error";
  lastError?: string;
  lastSeenAt?: string;
}
