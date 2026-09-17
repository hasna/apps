import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { detectChatGPTApp } from "../src/desktop-apps";
import { prepareChatGPTLaunch } from "../src/chatgpt-launch";
import { childEnvironment } from "../src/harness-environment";

// Exercise the installed app-managed REPL through the generated wrapper. This
// makes no provider calls or UI actions and changes no installed plugin config.
const configPath=process.env.SWITCHER_TEST_CUA_CONFIG;
if(!configPath)throw new Error("Set SWITCHER_TEST_CUA_CONFIG to the installed unified-computer-use .mcp.json.");
const spec=JSON.parse(await readFile(configPath,"utf8")).mcpServers.cua_repl;
const app=await detectChatGPTApp();
const state=await mkdtemp(join(tmpdir(),"switcher-native-cua-"));
let prepared:Awaited<ReturnType<typeof prepareChatGPTLaunch>>|undefined;
const client=new Client({name:"switcher_native_cua_probe",version:"1.0.0"});
try {
  prepared=await prepareChatGPTLaunch({executable:app.codexExecutable,args:["-c",'model="fixture-model"'],env:{SWITCHER_HARNESS_API_KEY:"fixture-loopback-token"},configPaths:[],warnings:[]},app,state,join(state,"profile"));
  await client.connect(new StdioClientTransport({command:spec.command,args:spec.args,cwd:dirname(configPath),env:{...childEnvironment(),...spec.env,CODEX_CLI_PATH:prepared.env.CODEX_CLI_PATH,CODEX_HOME:prepared.env.CODEX_HOME},stderr:"ignore"}));
  const result=await client.callTool({name:"js",arguments:{code:"nodeRepl.write(17 + 25);"}});
  const passed=!result.isError&&Array.isArray(result.content)&&result.content.some(item=>item.type==="text"&&item.text==="42");
  if(!passed)throw new Error("Installed browser/computer tool kernel failed through the Switcher wrapper.");
  console.log(JSON.stringify({passed,appVersion:app.version,check:"native-cua-sandbox-kernel",result:42}));
}finally{
  await client.close();await prepared?.cleanup?.();await rm(state,{recursive:true,force:true});
}
