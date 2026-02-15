import { join } from "path";
import { homedir } from "os";

export const MCPS_DIR = join(homedir(), ".mcps");
export const DB_PATH = join(MCPS_DIR, "registry.db");
export const REGISTRY_API_URL = "https://registry.modelcontextprotocol.io/v0/servers";
export const TOOL_PREFIX_SEPARATOR = "__";
