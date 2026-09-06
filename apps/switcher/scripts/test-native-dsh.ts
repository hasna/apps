// Opt-in, credential-free acceptance through the actual Switcher CLI and an
// installed official @deepseek-ai/dsh. No permission override or MCP is used.
import {mkdir,mkdtemp,writeFile,readFile,readdir,unlink} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";

const executable=process.env.SWITCHER_TEST_DSH_EXECUTABLE;
if(!executable) throw new Error("Set SWITCHER_TEST_DSH_EXECUTABLE to an installed official @deepseek-ai/dsh >=0.1.2-rc.1 executable.");
const protocol=process.env.SWITCHER_TEST_DSH_PROTOCOL??"openai-chat";
const authStyle=process.env.SWITCHER_TEST_DSH_AUTH??"bearer";
const mode=process.env.SWITCHER_TEST_DSH_MODE??"acp";
assert(["openai-chat","openai-responses","anthropic-messages"].includes(protocol));
assert(["bearer","x-api-key","none"].includes(authStyle));
assert(["acp","headless"].includes(mode));
const base=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace/scratch/switcher-native-tests");
await mkdir(base,{recursive:true,mode:0o700});const root=await mkdtemp(join(base,"dsh-"));
const cwd=join(root,"project");await mkdir(cwd,{mode:0o700});
const proof="DSH_READ_"+crypto.randomUUID();await writeFile(join(cwd,"proof.txt"),proof,{mode:0o600});
const model="fixture/namespaced-model";
const calls:any[]=[];let phase=0;
const fixtureKey="fixture-dsh-key";
const inferencePath={"openai-chat":"/chat/completions","openai-responses":"/responses","anthropic-messages":"/messages"}[protocol]!;
function responseStream(body:any,tool:boolean,text:string) {
  const input={file_path:"proof.txt"};
  let events:any[]=[];
  if(protocol==="anthropic-messages"){
    const content=tool?{type:"tool_use",id:"call_read_proof",name:"read",input}:{type:"text",text};
    events=[{type:"message_start",message:{id:"msg_fixture",type:"message",role:"assistant",model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},{type:"content_block_start",index:0,content_block:tool?{...content,input:{}}:{type:"text",text:""}},{type:"content_block_delta",index:0,delta:tool?{type:"input_json_delta",partial_json:JSON.stringify(input)}:{type:"text_delta",text}},{type:"content_block_stop",index:0},{type:"message_delta",delta:{stop_reason:tool?"tool_use":"end_turn",stop_sequence:null},usage:{output_tokens:5}},{type:"message_stop"}];
  } else if(protocol==="openai-responses"){
    const item=tool?{id:"fc_fixture",type:"function_call",call_id:"call_read_proof",name:"read",arguments:JSON.stringify(input),status:"completed"}:{id:"msg_fixture",type:"message",role:"assistant",content:[{type:"output_text",text,annotations:[]}],status:"completed"};
    const response={id:"resp_fixture",object:"response",created_at:1,model:body.model,status:"completed",output:[item],usage:{input_tokens:10,output_tokens:5,total_tokens:15,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
    events=[{type:"response.created",response:{...response,status:"in_progress",output:[]}},{type:"response.output_item.added",output_index:0,item:tool?{...item,arguments:"",status:"in_progress"}:{...item,content:[],status:"in_progress"}},...(tool?[{type:"response.function_call_arguments.delta",item_id:item.id,output_index:0,delta:JSON.stringify(input)},{type:"response.function_call_arguments.done",item_id:item.id,output_index:0,arguments:JSON.stringify(input)}]:[{type:"response.content_part.added",item_id:item.id,output_index:0,content_index:0,part:{type:"output_text",text:"",annotations:[]}},{type:"response.output_text.delta",item_id:item.id,output_index:0,content_index:0,delta:text},{type:"response.output_text.done",item_id:item.id,output_index:0,content_index:0,text}]),{type:"response.output_item.done",output_index:0,item},{type:"response.completed",response}];
  } else {
    const delta=tool?{role:"assistant",tool_calls:[{index:0,id:"call_read_proof",type:"function",function:{name:"read",arguments:JSON.stringify(input)}}]}:{role:"assistant",content:text};
    const event=(choices:any[])=>({id:"chatcmpl-fixture",object:"chat.completion.chunk",created:1,model:body.model,choices});
    events=[event([{index:0,delta,finish_reason:null}]),event([{index:0,delta:{},finish_reason:tool?"tool_calls":"stop"}])];
  }
  return new Response(events.map(data=>(data.type?`event: ${data.type}\n`:"")+`data: ${JSON.stringify(data)}\n\n`).join("")+(protocol==="openai-chat"?"data: [DONE]\n\n":""),{headers:{"content-type":"text/event-stream"}});
}
const upstream=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==="/prefix/v1/models") return Response.json({data:[{id:model,context_length:32768},{id:"other/catalog-model",context_length:32768}]});
  if(path!=="/prefix/v1"+inferencePath)return new Response(null,{status:404});
  const body=await request.json() as any;
  const messages=body.messages??body.input;
  const prior=JSON.stringify(messages.filter((m:any)=>m.role==="assistant")).includes("READ:"+proof);
  const toolProof=messages.some((m:any)=>(m.role==="tool"||m.type==="function_call_output"||m.content?.some?.((c:any)=>c.type==="tool_result"))&&JSON.stringify(m).includes(proof));
  const keyMatches=request.headers.get("authorization")===(authStyle==="bearer"?"Bearer "+fixtureKey:null)&&request.headers.get("x-api-key")===(authStyle==="x-api-key"?fixtureKey:null);
  const titleRequest=mode==="headless"&&!body.tools?.length;
  calls.push({phase,path,model:body.model,keyMatches,prior,toolProof,titleRequest,tools:body.tools?.map((t:any)=>t.function?.name??t.name)});
  assert(calls.length<=6,"bounded fixture request count");
  if(titleRequest)return responseStream(body,false,"Fixture title");
  if(phase===0&&!toolProof){
    assert(body.tools.some((t:any)=>(t.function?.name??t.name)==="read"),"native read tool must be advertised");
  } else {assert(toolProof,"native tool result must contain the file proof");if(phase===1)assert(prior,"resume must retain the prior assistant history");}
  return responseStream(body,phase===0&&!toolProof,(phase?"RESUMED:":"READ:")+proof);
}});
const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:join(root,"home"),USER:process.env.USER,LOGNAME:process.env.LOGNAME,HASNA_SWITCHER_HOME:join(root,"switcher"),SWITCHER_PROVIDER_FIXTURE:fixtureKey};
await mkdir(env.HOME!,{mode:0o700});
for(const kind of ["CONFIG","DATA","STATE","CACHE"]) {env[`XDG_${kind}_HOME`]=join(root,kind.toLowerCase());await mkdir(env[`XDG_${kind}_HOME`]!,{mode:0o700});}
const cli=fileURLToPath(new URL("../src/cli.ts",import.meta.url));
const results:any[]=[];let session:string|undefined;
try {
  for(phase=0;phase<(mode==="headless"?1:2);phase++){
    if(phase)await unlink(join(cwd,"proof.txt"));
    const child=Bun.spawn([process.execPath,cli,"launch","dsh","--provider",`generic-${protocol}`,"--url",upstream.url.origin+"/prefix/v1",...(authStyle==="none"?[]:["--credential-env","SWITCHER_PROVIDER_FIXTURE","--auth-style",authStyle]),"--model",model,"--executable",executable,"--timeout","45","--","--profile",mode,...(mode==="headless"?["Read proof.txt with the read tool and report its contents."]:[])],{cwd,env,stdin:"pipe",stdout:"pipe",stderr:"pipe",detached:true});
    let stdout="";let next=1;
    const pending=new Map<number,{resolve:(v:any)=>void,reject:(e:Error)=>void}>();
    const updates:any[]=[];
    const stderrPromise=new Response(child.stderr).text();
    const reader=(async()=>{let tail="";const decoder=new TextDecoder();for await(const chunk of child.stdout){const text=decoder.decode(chunk,{stream:true});if(mode==="headless"){stdout+=text;continue;}tail+=text;let pos;while((pos=tail.indexOf("\n"))>=0){const line=tail.slice(0,pos);tail=tail.slice(pos+1);stdout+=line+"\n";if(!line.trim())continue;const frame=JSON.parse(line);if(frame.method){
      updates.push(frame);
      if(frame.id!==undefined)child.stdin.write(JSON.stringify({jsonrpc:"2.0",id:frame.id,result:{outcome:{outcome:"cancelled"}}})+"\n");
    }else{const match=pending.get(frame.id);if(match){pending.delete(frame.id);frame.error?match.reject(new Error(JSON.stringify(frame.error))):match.resolve(frame.result);}}}}})();
    const request=(method:string,params:any)=>new Promise<any>((resolve,reject)=>{
      const id=next++;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`DSH ${method} timed out`));},20000);
      pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
      child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
    });
    const kill=()=>{try{process.kill(-child.pid,"SIGKILL");}catch{}};
    const deadline=setTimeout(kill,55000);
    try {
      if(mode==="headless"){
        const code=await child.exited;await reader;assert.equal(code,0);assert(stdout.includes("READ:"+proof));results.push({phase,code,proof:true});
      }else{
      const init=await request("initialize",{protocolVersion:1,clientCapabilities:{},clientInfo:{name:"switcher-fixture",version:"1"},provider:"outside",model:"outside"});
      assert.equal(init.protocolVersion,1);
      const opened=await request(phase?"session/resume":"session/new",{...(session?{sessionId:session}:{}),cwd,mcpServers:[]});
      session=opened.sessionId??session;assert(session);
      const option=opened.configOptions.find((o:any)=>o.id==="model");
      const choices=option.options.flatMap((o:any)=>o.options??[o]);
      assert.equal(choices.length,2);assert.equal(JSON.parse(option.currentValue)[1],model);
      await assert.rejects(request("session/set_config_option",{sessionId:session,configId:"model",value:JSON.stringify(["outside","outside"])}));
      await assert.rejects(request("session/set_config_option",{sessionId:session,configId:"model",value:JSON.stringify([JSON.parse(option.currentValue)[0],"outside"])}));
      const other=choices.find((choice:any)=>choice.value!==option.currentValue);assert(other);
      await request("session/set_config_option",{sessionId:session,configId:"model",value:other.value});
      await request("session/set_config_option",{sessionId:session,configId:"model",value:option.currentValue});
      const prompt=await request("session/prompt",{sessionId:session,prompt:[{type:"text",text:phase?"Recall the proof from the earlier conversation. Do not read the deleted file.":"Read proof.txt with the read tool and report its contents."}]});
      assert.equal(prompt.stopReason,"end_turn");
      const content=JSON.stringify(updates);
      assert(content.includes((phase?"RESUMED:":"READ:")+proof));
      if(!phase)assert(updates.some(u=>u.params?.update?.sessionUpdate==="tool_call"));
      assert(!updates.some(u=>u.method==="session/request_permission"),"fixture read must not need or receive blanket approval");
      await request("session/close",{sessionId:session});
      child.stdin.end();
      const code=await child.exited;await reader;
      assert.equal(code,0);results.push({phase,code,session,catalogSize:choices.length,selectedModel:JSON.parse(option.currentValue)[1],proof:true});
      }
    }finally{
      if(child.exitCode===null){try{process.kill(-child.pid,"SIGTERM");}catch{}await Promise.race([child.exited,Bun.sleep(3000)]);if(child.exitCode===null)kill();}
      await child.exited;clearTimeout(deadline);
      for(const request of pending.values())request.reject(new Error("Native DSH process exited"));pending.clear();
      await writeFile(join(root,`run-${phase}.stdout`),stdout,{mode:0o600});
      await writeFile(join(root,`run-${phase}.stderr`),await stderrPromise,{mode:0o600});
      await reader.catch(()=>{});
    }
  }
  assert.equal(calls.length,3);assert(calls.every(c=>c.keyMatches&&c.model===model));if(mode!=="headless")assert(calls.some(c=>c.phase===1&&c.prior&&c.toolProof));else assert.equal(calls.filter(c=>c.titleRequest).length,1);
  const entries=await readdir(root,{recursive:true,withFileTypes:true});const keyFiles:string[]=[];
  for(const entry of entries)if(entry.isFile()){const path=join(entry.parentPath,entry.name);const bytes=await readFile(path);if(bytes.includes(fixtureKey)||(path.endsWith(".zstd")&&Buffer.from(Bun.zstdDecompressSync(bytes)).includes(fixtureKey)))keyFiles.push(path);}
  assert.deepEqual(keyFiles,[]);assert(!(await readdir(join(root,"switcher","state"))).some(name=>name.startsWith("launch-")));
  await writeFile(join(root,"result.json"),JSON.stringify({passed:true,root,executable,protocol,authStyle,mode,results,calls,keyFiles},null,2)+"\n",{mode:0o600});
  console.log(JSON.stringify({passed:true,root,protocol,authStyle,mode,results,calls}));
}finally{await upstream.stop(true);}
