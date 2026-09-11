import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { detectChatGPTApp } from "../src/desktop-apps";
import { prepareChatGPTLaunch } from "../src/chatgpt-launch";
import { prepareHarnessLaunch, detectHarness } from "../src/harnesses";
import { childEnvironment } from "../src/harness-environment";
import { CredentialResolver, deliverVaultCredential } from "../src/credentials";
import { openCliRuntime, switcherHome } from "../src/runtime";
import { resolveLaunchProvider, ensureLaunchProfile } from "../src/direct-launch";
import { harnessEligible, validateHarnessProvider } from "../src/domain";
import { reasoningEffortSchema } from "../src/reasoning";

// Explicit live acceptance of the installed desktop runtime, separate from UI
// acceptance. No primary ChatGPT state is read, copied, changed or automated.
if(process.argv[2]==="__credential-delivery") {await deliverVaultCredential();process.exit(0);}
const providerId=process.env.SWITCHER_NATIVE_CHATGPT_PROVIDER;
const model=process.env.SWITCHER_NATIVE_CHATGPT_MODEL;
const reasoning=process.env.SWITCHER_NATIVE_CHATGPT_REASONING?reasoningEffortSchema.parse(process.env.SWITCHER_NATIVE_CHATGPT_REASONING):undefined;
const fullAccess=process.env.SWITCHER_NATIVE_CHATGPT_FULL_ACCESS==="1";
if(!providerId||!model)throw new Error("Set SWITCHER_NATIVE_CHATGPT_PROVIDER and SWITCHER_NATIVE_CHATGPT_MODEL for this live check.");
const credentials=new CredentialResolver();
const runtime=await openCliRuntime(process.env,provider=>credentials.resolve(provider));
let prepared:Awaited<ReturnType<typeof prepareChatGPTLaunch>>|undefined;
let child:ReturnType<typeof spawn>|undefined;
let reader:ReturnType<typeof createInterface>|undefined;
const root=join(switcherHome(),"native-chatgpt-checks");await mkdir(root,{recursive:true,mode:0o700});
const state=await mkdtemp(join(root,"check-"));
const events:unknown[]=[];
try {
  const app=await detectChatGPTApp();
  const detection=await detectHarness("codex",app.codexExecutable);
  const provider=await resolveLaunchProvider(runtime.client,providerId,{harness:"codex"});
  validateHarnessProvider("codex",provider);
  const catalog=await runtime.client.refreshModels(provider.id);
  await ensureLaunchProfile(runtime.client,provider,"codex",model);
  const native=await prepareHarnessLaunch({harness:"codex",baseUrl:provider.baseUrl,protocol:provider.protocol,authStyle:provider.authStyle,model,
    models:catalog.models.filter(m=>harnessEligible(m,"codex")),providerId:provider.id,credential:await credentials.resolve(provider),
    executable:app.codexExecutable,version:detection.version,stateDir:state,cwd:state,args:[],reasoning,dangerouslyBypassApprovalsAndSandbox:fullAccess,onRoutingEvent:event=>events.push(event)});
  try {prepared=await prepareChatGPTLaunch(native,app,state,join(state,"profile"));}
  catch(error){await native.cleanup?.();throw error;}
  child=spawn(prepared.env.CODEX_CLI_PATH,["app-server","--stdio"],{cwd:state,env:{...childEnvironment(),...prepared.env},stdio:["pipe","pipe","ignore"]});
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  let id=0,completion:(value:any)=>void=()=>{};
  let answer="";
  reader=createInterface({input:child.stdout!});
  reader.on("line",line=>{
    let message:any;try{message=JSON.parse(line);}catch{return;}
    if(message.id!==undefined&&pending.has(message.id)){
      const item=pending.get(message.id)!;pending.delete(message.id);clearTimeout(item.timer);
      if(message.error)item.reject(new Error(`Native RPC rejected request (${message.error.code}).`));else item.resolve(message.result);
    }else if(message.id!==undefined&&message.method){child!.stdin!.write(JSON.stringify({id:message.id,error:{code:-32601,message:"No interactive tools are enabled in this check."}})+"\n");}
    if(message.method==="item/agentMessage/delta")answer+=message.params.delta;
    if(message.method==="turn/completed")completion(message.params);
  });
  function request(method:string,params:unknown):Promise<any>{
    const requestId=++id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(`Native RPC timed out: ${method}`));},60_000);
      pending.set(requestId,{resolve,reject,timer});child!.stdin!.write(JSON.stringify({id:requestId,method,params})+"\n");
    });
  }
  await request("initialize",{clientInfo:{name:"switcher_native_probe",version:"0.1.9"},capabilities:{experimentalApi:true}});
  child.stdin!.write(JSON.stringify({method:"initialized"})+"\n");
  const account=await request("account/read",{refreshToken:false});
  const configuration=await request("config/read",{includeLayers:false});
  const models=await request("model/list",{});
  console.log(JSON.stringify({stage:"configured",appVersion:app.version,runtime:detection.version,model:configuration.config.model,provider:configuration.config.model_provider,reasoning:configuration.config.model_reasoning_effort,efforts:models.data.find((m:any)=>m.model===model)?.supportedReasoningEfforts,approvalPolicy:configuration.config.approval_policy,sandboxMode:configuration.config.sandbox_mode,accountType:account.account?.type,state},null,2));
  if(configuration.config.model!==model||configuration.config.model_provider!=="switcher")throw new Error("The installed desktop runtime did not load the selected route.");
  if(reasoning&&configuration.config.model_reasoning_effort!==reasoning)throw new Error("The installed runtime did not load the selected reasoning effort.");
  if(fullAccess&&(configuration.config.approval_policy!=="never"||configuration.config.sandbox_mode!=="danger-full-access"))throw new Error("The installed runtime did not load full access.");
  async function checkTurn(stage:string,params:Record<string,unknown>,expected:string[]){
    answer="";const firstEvent=events.length;
    const completed=new Promise<any>(resolve=>completion=resolve);
    await request("turn/start",params);
    let timer:ReturnType<typeof setTimeout>|undefined;
    const result=await Promise.race([completed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Native provider turn timed out.")),120_000);})]).finally(()=>{if(timer)clearTimeout(timer);});
    const turnEvents=events.slice(firstEvent);
    if((result as any).turn.status!=="completed"||!expected.every(text=>answer.includes(text))||!turnEvents.some((event:any)=>event.resolvedModel===model&&event.upstreamStatus===200))throw new Error(`Native provider acceptance failed: ${stage}.`);
    if(reasoning&&!turnEvents.some((event:any)=>event.reasoningEffort===reasoning))throw new Error("The selected reasoning effort did not reach the provider gateway.");
    console.log(JSON.stringify({stage,provider:provider.id,model,threadId:params.threadId,answer,routingEvents:turnEvents},null,2));
  }
  const thread=await request("thread/start",{cwd:state,approvalPolicy:null,sandbox:null,model:null,modelProvider:null,experimentalRawEvents:false,persistExtendedHistory:false});
  await checkTurn("direct",{threadId:thread.thread.id,input:[{type:"text",text:"Reply exactly SWITCHER_CHATGPT_PROVIDER_OK. Do not use tools.",text_elements:[]}]},["SWITCHER_CHATGPT_PROVIDER_OK"]);
  const delegated=await request("thread/start",{cwd:state,experimentalRawEvents:false,persistExtendedHistory:false});
  const token=crypto.randomUUID();
  // Mirrors the installed desktop's create_thread/send_message turnToolOutput
  // transport. The follow-up must recover a token present only in the first
  // delegated message, proving both delivery and history replay.
  const toolOutput=(name:string,text:string)=>({name,namespace:"codex_app",output:`<codex_delegation>\n  <source_thread_id>${thread.thread.id}</source_thread_id>\n  <input>${text}</input>\n</codex_delegation>`});
  await checkTurn("create_thread",{threadId:delegated.thread.id,input:[],toolOutput:toolOutput("create_thread",`Remember verification token ${token}. Reply exactly SWITCHER_CHATGPT_CREATE_OK. Do not use tools.`)},["SWITCHER_CHATGPT_CREATE_OK"]);
  await checkTurn("send_message",{threadId:delegated.thread.id,input:[],toolOutput:toolOutput("send_message","Reply with the verification token from the earlier task message, followed by SWITCHER_CHATGPT_MESSAGE_OK. Do not use tools.")},[token,"SWITCHER_CHATGPT_MESSAGE_OK"]);
  await checkTurn("replay",{threadId:delegated.thread.id,input:[{type:"text",text:"Reply exactly SWITCHER_CHATGPT_REPLAY_OK. Do not use tools.",text_elements:[]}]},["SWITCHER_CHATGPT_REPLAY_OK"]);
  console.log(JSON.stringify({stage:"passed",checks:["direct","create_thread","send_message","replay"]}));
}finally{
  reader?.close();child?.kill("SIGTERM");
  if(child)await new Promise<void>(resolve=>{if(child!.exitCode!==null)return resolve();child!.once("exit",()=>resolve());});
  await prepared?.cleanup?.();await runtime.close();
}
