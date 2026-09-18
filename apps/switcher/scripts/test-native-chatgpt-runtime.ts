import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectChatGPTApp } from "../src/desktop-apps";
import { prepareChatGPTLaunch } from "../src/chatgpt-launch";
import { prepareHarnessLaunch } from "../src/harnesses";
import { inspectCodexNative } from "../src/codex-native";
import { resolveNativeState } from "../src/native-state";
import { settleHarnessGroup, HarnessSettlementError } from "../src/harness-process";
import { childEnvironment } from "../src/harness-environment";
import { CredentialResolver, deliverVaultCredential } from "../src/credentials";
import { openCliRuntime, switcherHome, privateDirectory } from "../src/runtime";
import { resolveLaunchProvider, ensureLaunchProfile } from "../src/direct-launch";
import { harnessEligible, validateHarnessProvider } from "../src/domain";
import { reasoningEffortSchema } from "../src/reasoning";

// Explicit live acceptance of the verified desktop helper, separate from GUI
// acceptance. All native state belongs to this disposable check, never the user's corpus.
if(process.argv[2]==="__credential-delivery") {await deliverVaultCredential();process.exit(0);}
const providerId=process.env.SWITCHER_NATIVE_CHATGPT_PROVIDER;
const model=process.env.SWITCHER_NATIVE_CHATGPT_MODEL;
const reasoning=process.env.SWITCHER_NATIVE_CHATGPT_REASONING?reasoningEffortSchema.parse(process.env.SWITCHER_NATIVE_CHATGPT_REASONING):undefined;
const fullAccess=process.env.SWITCHER_NATIVE_CHATGPT_FULL_ACCESS==="1";
if(!providerId||!model)throw new Error("Set SWITCHER_NATIVE_CHATGPT_PROVIDER and SWITCHER_NATIVE_CHATGPT_MODEL for this live check.");
const app=await detectChatGPTApp();
const installation=await inspectCodexNative();
const credentials=new CredentialResolver();
const runtime=await openCliRuntime(process.env,provider=>credentials.resolve(provider));
let prepared:Awaited<ReturnType<typeof prepareChatGPTLaunch>>|undefined;
let child:ReturnType<typeof spawn>|undefined;
let reader:ReturnType<typeof createInterface>|undefined;
let closed:Promise<void>|undefined;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const cancellation=new AbortController();
const cancel=()=>{if(cancellation.signal.aborted)return;cancellation.abort(new Error("Native provider check interrupted or its helper stopped."));for(const item of pending.values()){clearTimeout(item.timer);item.reject(cancellation.signal.reason);}pending.clear();child?.stdin?.end();};
for(const signal of ["SIGINT","SIGTERM","SIGHUP"] as const)process.on(signal,cancel);
const root=join(switcherHome(),"native-chatgpt-checks");
let state:string;
const events:unknown[]=[];
try {
  await privateDirectory(root);
  state=await realpath(await mkdtemp(join(root,"check-")));
  const corpus=join(state,"corpus");await mkdir(corpus,{mode:0o700});
  await writeFile(join(corpus,"config.toml"),'web_search="disabled"\n[analytics]\nenabled=false\n[features]\nplugins=false\napps=false\nshell_tool=false\nunified_exec=false\nmulti_agent=false\nmemory_tool=false\n',{mode:0o600,flag:"wx"});
  const canonical=await resolveNativeState("codex",{HASNA_CODEX_STATE_HOME:corpus},{create:false});
  await installation.guard();
  const provider=await resolveLaunchProvider(runtime.client,providerId,{harness:"codex"});
  validateHarnessProvider("codex",provider);
  const catalog=await runtime.client.refreshModels(provider.id);
  await ensureLaunchProfile(runtime.client,provider,"codex",model);
  const native=await prepareHarnessLaunch({harness:"codex",baseUrl:provider.baseUrl,protocol:provider.protocol,authStyle:provider.authStyle,model,
    models:catalog.models.filter(m=>harnessEligible(m,"codex")),providerId:provider.id,credential:await credentials.resolve(provider),
    executable:installation.executable,version:"0.154.0",stateDir:state,cwd:state,args:[],reasoning,dangerouslyBypassApprovalsAndSandbox:fullAccess,onRoutingEvent:event=>events.push(event)});
  try {prepared=await prepareChatGPTLaunch(native,app,state,join(state,"profile"),canonical);}
  catch(error){await native.cleanup?.();throw error;}
  await prepared.beforeLaunch?.();
  cancellation.signal.throwIfAborted();
  child=spawn(prepared.env.CODEX_CLI_PATH,["-c","features.code_mode_host=true","app-server","--analytics-default-enabled"],{cwd:state,env:{...childEnvironment(),...prepared.env},stdio:["pipe","pipe","ignore"],detached:true});
  closed=new Promise(resolve=>child!.once("close",()=>{cancel();resolve();}));
  child.on("error",cancel);child.stdin!.on("error",cancel);child.stdout!.on("error",cancel);
  let id=0,completion:(value:any)=>void=()=>{};
  let answer="";
  reader=createInterface({input:child.stdout!});
  reader.on("error",cancel);
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
    cancellation.signal.throwIfAborted();
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
  console.log(JSON.stringify({stage:"configured",appVersion:app.version,runtime:"0.154.0",model:configuration.config.model,provider:configuration.config.model_provider,reasoning:configuration.config.model_reasoning_effort,efforts:models.data.find((m:any)=>m.model===model)?.supportedReasoningEfforts,approvalPolicy:configuration.config.approval_policy,sandboxMode:configuration.config.sandbox_mode,accountType:account.account?.type,state},null,2));
  if(configuration.config.model!==model||configuration.config.model_provider!=="switcher")throw new Error("The installed desktop runtime did not load the selected route.");
  if(reasoning&&configuration.config.model_reasoning_effort!==reasoning)throw new Error("The installed runtime did not load the selected reasoning effort.");
  if(fullAccess&&(configuration.config.approval_policy!=="never"||configuration.config.sandbox_mode!=="danger-full-access"))throw new Error("The installed runtime did not load full access.");
  async function checkTurn(stage:string,params:Record<string,unknown>,expected:string[]){
    answer="";const firstEvent=events.length;
    const completed=new Promise<any>(resolve=>completion=resolve);
    await request("turn/start",params);
    let timer:ReturnType<typeof setTimeout>|undefined;
    let aborted:()=>void=()=>{};
    const cancelled=new Promise<never>((_,reject)=>{aborted=()=>reject(cancellation.signal.reason);cancellation.signal.addEventListener("abort",aborted,{once:true});if(cancellation.signal.aborted)aborted();});
    const result=await Promise.race([completed,cancelled,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Native provider turn timed out.")),120_000);})]).finally(()=>{if(timer)clearTimeout(timer);cancellation.signal.removeEventListener("abort",aborted);});
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
  for(const item of pending.values())clearTimeout(item.timer);pending.clear();
  reader?.close();child?.stdin?.end();
  try {
    if(child&&closed){
      const waitClosed=async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([closed!.then(()=>true),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),8000);})]);}finally{if(timer)clearTimeout(timer);}};
      await waitClosed();
      await settleHarnessGroup({exists:()=>{if(!child!.pid)return false;try{process.kill(-child!.pid,0);return true;}catch(error){return(error as NodeJS.ErrnoException).code!=="ESRCH";}},signal:signal=>{if(child!.pid)try{process.kill(-child!.pid,signal);}catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")throw error;}}},1000);
      if(!await waitClosed())throw new HarnessSettlementError();
    }
    await prepared?.cleanup?.();
  }finally{
    child?.stdin?.destroy();child?.stdout?.destroy();
    try{try{await prepared?.closeTransport?.();}finally{await runtime.close();}}
    finally{for(const signal of ["SIGINT","SIGTERM","SIGHUP"] as const)process.off(signal,cancel);}
  }
}
