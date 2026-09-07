// The actual DSH web profile: catalog, browser authentication and shutdown.
import {mkdir,mkdtemp,writeFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const executable=process.env.SWITCHER_TEST_DSH_EXECUTABLE;
if(!executable)throw new Error("Set SWITCHER_TEST_DSH_EXECUTABLE to the installed official DSH executable.");
const base=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace/scratch/switcher-native-tests");await mkdir(base,{recursive:true,mode:0o700});
const root=await mkdtemp(join(base,"dsh-web-"));const home=join(root,"home");await mkdir(home,{mode:0o700});
let inferenceCalls=0;
const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){if(new URL(request.url).pathname==="/v1/models")return Response.json({data:[{id:"fixture/selected"},{id:"fixture/other"}]});inferenceCalls++;return new Response(null,{status:500});}});
const cli=fileURLToPath(new URL("../src/cli.ts",import.meta.url));
const child=Bun.spawn([process.execPath,cli,"launch","dsh","--provider","generic-openai-chat","--url",upstream.url.origin+"/v1","--model","fixture/selected","--executable",executable,"--timeout","35","--","--no-open"],{cwd:root,env:{HOME:home,PATH:process.env.PATH,HASNA_SWITCHER_HOME:join(root,"switcher")},stdin:"ignore",stdout:"pipe",stderr:"pipe",detached:true});
let output="";let browserUrl:string|undefined;let outputReady!:()=>void;const ready=new Promise<void>(resolve=>{outputReady=resolve;});
const stdout=(async()=>{const decoder=new TextDecoder();for await(const chunk of child.stdout){output+=decoder.decode(chunk,{stream:true});const match=output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+[^\s]*)/);if(match){browserUrl=match[1];outputReady();}}})();
const stderr=new Response(child.stderr).text();
const kill=()=>{try{process.kill(-child.pid,"SIGKILL");}catch{}};
const deadline=setTimeout(kill,45000);let url:URL|undefined;
try {
  const timer=setTimeout(()=>outputReady(),20000);
  try{await Promise.race([ready,child.exited]);}finally{clearTimeout(timer);}
  assert(browserUrl,"native web URL must become ready");url=new URL(browserUrl);
  assert.equal(url.hostname,"127.0.0.1");assert(Number(url.port)>0);assert(url.searchParams.get("token"));
  assert(!output.includes("opening the default browser"));
  const method="session/modelCatalog";
  const request={method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:"client-request",rpcId:"fixture",method,payload:{args:{}}})};
  const api=url.origin+"/api/"+method;
  const unauth=await fetch(api,request);assert.equal(unauth.status,401);await unauth.body?.cancel();
  const exchange=await fetch(url,{redirect:"manual"});assert.equal(exchange.status,303);const cookie=exchange.headers.get("set-cookie");assert(cookie?.includes("HttpOnly"));assert(cookie?.includes("SameSite=Strict"));await exchange.body?.cancel();
  const headers={...request.headers,cookie:cookie!.split(";")[0]};
  const response=await fetch(api,{...request,headers});assert.equal(response.status,200);const catalog=await response.json() as any;
  assert.equal(catalog.result.ok,true);const value=catalog.result.value;
  assert.equal(value.default.model,"fixture/selected");assert.equal(value.groups.length,1);assert.deepEqual(value.groups[0].models.map((m:any)=>m.id),["fixture/selected","fixture/other"]);assert.equal(value.failures.length,0);
  for(const extra of [{origin:"https://untrusted.example"},{host:"untrusted.example"},{"sec-fetch-site":"cross-site"}]){const rejection=await fetch(api,{...request,headers:{...headers,...extra}});assert.equal(rejection.status,403);await rejection.body?.cancel();}
  assert.equal(inferenceCalls,0);
  // DSH handles SIGTERM with a graceful exit 0; Switcher preserves that code
  // and independently records the user interruption in its run metadata.
  process.kill(child.pid,"SIGTERM");assert.equal(await child.exited,0);await stdout;
  await assert.rejects(fetch(api,{...request,signal:AbortSignal.timeout(1000)}));
  assert(!(await readdir(join(root,"switcher","state"))).some(name=>name.startsWith("launch-")));
  const metadata=Bun.spawn([process.execPath,cli,"runs","list"],{cwd:root,env:{HOME:home,PATH:process.env.PATH,HASNA_SWITCHER_HOME:join(root,"switcher")},stdout:"pipe",stderr:"pipe",stdin:"ignore"});
  const metadataDeadline=setTimeout(()=>metadata.kill("SIGKILL"),10000);
  let runs:any;
  try{const [code,out,err]=await Promise.all([metadata.exited,new Response(metadata.stdout).text(),new Response(metadata.stderr).text()]);assert.equal(code,0,err);runs=JSON.parse(out);assert.equal(runs.data.length,1);assert.equal(runs.data[0].status,"interrupted");assert.equal(runs.data[0].exitCode,0);}finally{clearTimeout(metadataDeadline);}
  const result={passed:true,root,executable,host:url.hostname,port:Number(url.port),catalogSize:value.groups[0].models.length,selectedModel:value.default.model,unauthenticatedStatus:401,untrustedStatuses:[403,403,403],inferenceCalls,exitCode:child.exitCode,runStatus:runs.data[0].status};
  await writeFile(join(root,"result.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});console.log(JSON.stringify(result));
} finally {
  if(child.exitCode===null){try{process.kill(child.pid,"SIGTERM");}catch{}await Promise.race([child.exited,Bun.sleep(3000)]);if(child.exitCode===null)kill();}
  await child.exited;clearTimeout(deadline);await stdout;
  // The native one-time browser token is never recorded in evidence.
  await writeFile(join(root,"stdout.redacted"),output.replace(/([?&]token=)[^\s&]+/g,"$1[redacted]"),{mode:0o600});
  await writeFile(join(root,"stderr"),await stderr,{mode:0o600});await upstream.stop(true);
}
