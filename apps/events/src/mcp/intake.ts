#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createIntakeClient, validateBinding, validateRequest, object, boundedText, SOURCE_ID_PATTERN } from "../intake/client.js";
import pkg from "../../package.json";

/** Intake-only MCP. Legacy local channel/spool operations are not exposed. */
export function createIntakeMcpServer(env:Record<string,string|undefined>=process.env){
  const server=new McpServer({name:"events",version:pkg.version});
  const common={tenant_id:z.string().min(1).max(256),sink_id:z.string().uuid(),producer_id:z.string().uuid(),corpus_id:z.string().regex(SOURCE_ID_PATTERN),source_authority_id:z.string().regex(SOURCE_ID_PATTERN)};
  for(const operation of ["capability","accept","receipt"] as const){
    server.registerTool(`events_intake_${operation}`,{
      description:operation==="accept"?"Submit an already-frozen event request to the authenticated durable sink. Only a verified accepted_durable receipt acknowledges delivery.":operation==="receipt"?"Read and verify the durable receipt for an already-frozen request.":"Verify the authenticated sink and producer binding without submitting an event.",
      inputSchema:operation==="capability"?common:{...common,request:z.record(z.unknown())},
    },async (raw: unknown)=>{
      try{
        const input=object(raw);
        const binding=validateBinding(input);
        const client=createIntakeClient({env,binding,tenantId:boundedText(input.tenant_id,256)});
        const result=operation==="capability"?(await client.capability(),{status:"authorized_capability"})
          :operation==="accept"?await client.accept(validateRequest(input.request))
          :await client.receipt(validateRequest(input.request));
        return {content:[{type:"text" as const,text:JSON.stringify(result)}]};
      }catch{return {isError:true,content:[{type:"text" as const,text:JSON.stringify({status:"unconfirmed",error:"intake_operation_unconfirmed"})}]};}
    });
  }
  return server;
}
export async function main(args=process.argv.slice(2)){
  if(args.length===1&&["--help","-h"].includes(args[0]!)){console.log("events-mcp: authenticated durable intake only (capability, accept, receipt), over stdio. Uses saved Events API credentials; no local fallback.");return;}
  if(args.length)throw new Error("unsupported_mcp_arguments");
  const server=createIntakeMcpServer();await server.connect(new StdioServerTransport());
}
if(import.meta.main)void main().catch(()=>{console.error("events_intake_mcp_failed");process.exitCode=1;});
