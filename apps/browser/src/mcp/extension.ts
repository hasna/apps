import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool, z, json, err } from "./helpers.js";
import { createExtensionPairing, getExtensionBridgeStatus, revokeExtensionToken } from "../lib/extension-bridge.js";

export function register(server: McpServer) {
  registerTool(server,
    "browser_extension_pair",
    "Create a short-lived Chrome extension pairing code. Load extension/dist as an unpacked extension, then enter this code in the popup.",
    {
      ttl_ms: z.number().optional().default(300000),
    },
    async ({ ttl_ms }) => {
      try {
        return json(createExtensionPairing(ttl_ms));
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_extension_status",
    "Show paired and connected Chrome extension bridge status.",
    {},
    async () => {
      try {
        return json(getExtensionBridgeStatus());
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_extension_unpair",
    "Revoke a paired Chrome extension token. If token_id is omitted, all extension tokens are revoked.",
    {
      token_id: z.string().optional(),
    },
    async ({ token_id }) => {
      try {
        return json(revokeExtensionToken(token_id));
      } catch (e) { return err(e); }
    },
  );
}
