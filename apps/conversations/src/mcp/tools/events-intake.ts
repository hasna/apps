import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { getStore } from "../../lib/store/index.js";
import { registerMcpTool } from "../tool-compat.js";

export function registerEventsIntakeTools(server: McpServer): void {
  registerMcpTool(server,"events_drain",{
    description:"Advance up to 100 corpus-bound PostgreSQL intents to authenticated Events intake. Requires conversations:events-drain; accepted means durable intake, not downstream delivery.",
    inputSchema:{limit:z.number().int().min(1).max(100).optional()},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
  },async args=>({content:[{type:"text",text:JSON.stringify(await getStore().drainEventOutbox({limit:args.limit}))}]}));
  registerMcpTool(server,"events_receipt",{
    description:"Inspect one frozen event intent's metadata, durable receipt identity and downstream reconciliation requirement. Does not return event content.",
    inputSchema:{event_id:z.string().min(1).max(512)},
    annotations:{readOnlyHint:true,destructiveHint:false},
  },async args=>({content:[{type:"text",text:JSON.stringify(await getStore().getEventDelivery(args.event_id))}]}));
}
