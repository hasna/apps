import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
const harness=process.env.SWITCHER_TEST_NATIVE_HARNESS??'opencode2';
if(!['opencode2','grok'].includes(harness))throw new Error('This native resume check supports opencode2 or grok.');
const executable=process.env.SWITCHER_TEST_NATIVE_EXECUTABLE??process.env.SWITCHER_TEST_OPENCODE_EXECUTABLE;
if(!executable) throw new Error('Set SWITCHER_TEST_NATIVE_EXECUTABLE to the installed harness executable. This check uses local fixtures only.');
const base=process.env.SWITCHER_TEST_ROOT??join(homedir(),'Workspace/scratch/switcher-native-tests');await mkdir(base,{recursive:true,mode:0o700});const root=await mkdtemp(join(base,'run-'));
const source=fileURLToPath(new URL('../src/cli.ts',import.meta.url));
const switcherCommand=process.env.SWITCHER_TEST_SWITCHER_EXECUTABLE?[process.env.SWITCHER_TEST_SWITCHER_EXECUTABLE]:[process.execPath,source];
const calls:any[]=[];
let phase=0;
const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 const path=new URL(req.url).pathname;
 if(path==='/v1/models')return Response.json({data:[{id:'fixture-resume-model'}]});
 if(path!=='/v1/messages')return new Response(null,{status:404});
 const body=await req.json() as any;const keyMatches=req.headers.get('authorization')==='Bearer fixture-resume-key';
 const prior=JSON.stringify(body.messages.filter((m:any)=>m.role==='assistant')).includes('FIRST_TURN_PROOF');calls.push({phase,path,model:body.model,prior,keyMatches});
 const text=phase===1&&prior?'RESUMED_WITH_HISTORY':'FIRST_TURN_PROOF';
 const events=[['message_start',{type:'message_start',message:{id:'msg_'+crypto.randomUUID(),type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}}],['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text}}],['content_block_stop',{type:'content_block_stop',index:0}],['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:5}}],['message_stop',{type:'message_stop'}]];
 return new Response(events.map(([event,data])=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}});
const env:NodeJS.ProcessEnv={HOME:process.env.HOME,USER:process.env.USER,LOGNAME:process.env.LOGNAME,PATH:process.env.PATH,HASNA_SWITCHER_HOME:join(root,'switcher'),SWITCHER_PROVIDER_FIXTURE:'fixture-resume-key'};
env.GROK_HOME=join(root,'grok');
for(const [name,dir] of [['XDG_DATA_HOME','data'],['XDG_CONFIG_HOME','config'],['XDG_STATE_HOME','state'],['XDG_CACHE_HOME','cache']]){env[name]=join(root,dir);await mkdir(env[name]!,{recursive:true,mode:0o700});}
const results:any[]=[];
try {
 let session:string|undefined;
 for(let i=0;i<2;i++){
  phase=i;
  const prompt=i?'Continue the prior response. Do not use tools.':'Reply FIRST_TURN_PROOF. Do not use tools.';
  const native=harness==='opencode2'?['run','--format','json',...(session?['--session',session]:[]),prompt]:[...(session?['--resume',session]:[]),'-p',prompt,'--output-format','json','--no-auto-update','--no-memory'];
  const args=['launch',harness,'--provider','generic-anthropic-messages','--url',upstream.url.origin+'/v1','--credential-env','SWITCHER_PROVIDER_FIXTURE','--auth-style','bearer','--model','fixture-resume-model','--executable',executable,'--timeout','45','--',...native];
  const child=Bun.spawn([...switcherCommand,...args],{cwd:root,env,stdin:'ignore',stdout:'pipe',stderr:'pipe'});
  const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  await writeFile(join(root,`run-${i}.stdout`),stdout,{mode:0o600});await writeFile(join(root,`run-${i}.stderr`),stderr,{mode:0o600});
  const parse=(line:string)=>{try{return JSON.parse(line)}catch{return {unparsed:true}}};
  const events=harness==='grok'?[parse(stdout)]:stdout.split('\n').filter(Boolean).map(parse);
  session=events.find(e=>e.sessionID||e.sessionId)?.sessionID??events.find(e=>e.sessionId)?.sessionId??session;
  results.push({code,session,text:harness==='grok'?events.map(e=>e.text):events.filter(e=>e.type==='text').map(e=>e.part?.text),errors:events.filter(e=>e.type==='error')});
  if(code!==0||!session)break;
 }
 const report={root,harness,native:executable,switcher:switcherCommand,results,calls,passed:results.length===2&&results.every(r=>r.code===0)&&results[0].session===results[1].session&&results[0].text.includes('FIRST_TURN_PROOF')&&results[1].text.includes('RESUMED_WITH_HISTORY')&&calls.some(c=>c.phase===1&&c.prior)&&calls.some(c=>c.phase===0&&!c.prior)&&calls.every(c=>c.keyMatches&&c.model==='fixture-resume-model')};
 const {readdir}=await import('node:fs/promises');
 const entries=await readdir(root,{recursive:true,withFileTypes:true});const keyHits:string[]=[];
 for(const entry of entries) if(entry.isFile()) {const file=join(entry.parentPath,entry.name); if((await readFile(file)).includes(Buffer.from('fixture-resume-key'))) keyHits.push(file);}
 const settingsEmpty=(await readdir(join(root,'switcher/state'))).length===0;
 Object.assign(report,{providerKeyFileHits:keyHits,settingsEmpty});
 if(keyHits.length||!settingsEmpty)report.passed=false;
 await writeFile(join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));
 if(!report.passed)process.exitCode=1;
}finally{await upstream.stop(true);}
