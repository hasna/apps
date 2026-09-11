import { expect,test } from "bun:test";
import { mkdtemp,mkdir,readFile,writeFile,rm,stat,symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareClaudeDesktopLaunch } from "../src/claude-desktop-launch";
import { detectClaudeDesktopApp } from "../src/desktop-apps";
import type { HarnessLaunchInput,PreparedLaunch } from "../src/harness-types";
import type { RoutingEvent } from "../src/inference-gateway";

const app={path:"/Applications/Claude.app",executable:"/Applications/Claude.app/Contents/MacOS/Claude",bundleId:"com.anthropic.claudefordesktop",version:"1.52386.0"};
test("Claude desktop routes arbitrary Messages models, scopes credentials, leases the shared profile and restores prior selection",async()=>{
  const root=await mkdtemp(join(tmpdir(),"switcher-claude-desktop-")),userData=join(root,"desktop"),state=join(root,"launch");
  await mkdir(state,{mode:0o700});await mkdir(join(userData,"configLibrary"),{recursive:true,mode:0o700});
  const previous=JSON.stringify({appliedId:"previous",entries:[{id:"previous",name:"Existing gateway"}],extra:"preserve"});
  const metaPath=join(userData,"configLibrary/_meta.json");await writeFile(metaPath,previous);
  const events:RoutingEvent[]=[],requests:{model:string;authorization:string|null}[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){const body=await request.json() as {model:string};requests.push({model:body.model,authorization:request.headers.get("authorization")});return Response.json({id:"msg_test",type:"message",role:"assistant",model:body.model,content:[{type:"text",text:"DESKTOP_OK"}],stop_reason:"end_turn",usage:{input_tokens:2,output_tokens:3}});}});
  const system={userData,assertAvailable:async()=>{}};
  const input:HarnessLaunchInput={harness:"claude",baseUrl:upstream.url.href,protocol:"anthropic-messages",model:"vendor/main",models:[{id:"vendor/main",name:"Main"},{id:"vendor/fast",name:"Fast"}],modelPolicy:{version:1,roles:{fast:"vendor/fast"}},credential:"upstream-fixture-credential",stateDir:state,cwd:root,onRoutingEvent:event=>events.push(event)};
  let prepared:PreparedLaunch|undefined;
  try {
    prepared=await prepareClaudeDesktopLaunch(input,app,join(root,"engine"),system);
    expect(prepared.env).toEqual({CLAUDE_CONFIG_DIR:join(root,"engine")});
    expect(prepared.executable).toBe(app.executable);expect(prepared.args).toEqual([]);
    const meta=JSON.parse(await readFile(metaPath,"utf8"));expect(meta.entries).toHaveLength(2);
    const configPath=join(userData,"configLibrary",meta.appliedId+".json");
    const raw=await readFile(configPath,"utf8"),config=JSON.parse(raw);
    expect(raw).not.toContain(input.credential!);expect((await stat(configPath)).mode&0o777).toBe(0o600);
    expect(config.inferenceModels[0]).toMatchObject({name:"switcher/sonnet",labelOverride:"vendor/main",anthropicFamilyTier:"sonnet"});
    const invoke=async(model:string,key=config.inferenceGatewayApiKey)=>fetch(config.inferenceGatewayBaseUrl+"/v1/messages",{method:"POST",headers:{authorization:"Bearer "+key,"content-type":"application/json"},body:JSON.stringify({model,max_tokens:32,messages:[{role:"user",content:"Reply DESKTOP_OK"}]})});
    expect((await invoke("switcher/sonnet","wrong-fixture-token")).status).toBe(401);
    expect((await invoke("switcher/sonnet")).status).toBe(200);
    expect((await invoke("switcher/haiku")).status).toBe(200);
    expect((await invoke("unlisted/model")).status).toBe(403);
    expect(requests.map(r=>r.model)).toEqual(["vendor/main","vendor/fast"]);
    expect(requests.every(r=>r.authorization==="Bearer upstream-fixture-credential")).toBe(true);
    expect(events.filter(e=>e.upstreamStatus===200).map(e=>e.resolvedModel)).toEqual(["vendor/main","vendor/fast"]);
    await expect(prepareClaudeDesktopLaunch(input,app,join(root,"engine"),system)).rejects.toMatchObject({code:"desktop_busy"});
    await writeFile(join(userData,"saved-chat"),"keep");
    await prepared.cleanup?.();prepared=undefined;
    expect(await readFile(metaPath,"utf8")).toBe(previous);
    expect(await Bun.file(configPath).exists()).toBe(false);
    expect(await readFile(join(userData,"saved-chat"),"utf8")).toBe("keep");
    const crashState=join(root,"crash");await mkdir(crashState,{mode:0o700});
    const crashInput={...input,stateDir:crashState};
    const crashCode=`import {prepareClaudeDesktopLaunch} from ${JSON.stringify(join(import.meta.dir,"../src/claude-desktop-launch.ts"))}; await prepareClaudeDesktopLaunch(${JSON.stringify(crashInput)},${JSON.stringify(app)},${JSON.stringify(join(root,"engine"))},{userData:${JSON.stringify(userData)},assertAvailable:async()=>{}}); process.exit(0);`;
    const crashed=Bun.spawn([process.execPath,"-e",crashCode],{stdout:"pipe",stderr:"pipe"});expect(await crashed.exited).toBe(0);
    const crashMeta=JSON.parse(await readFile(metaPath,"utf8"));expect(crashMeta.appliedId).not.toBe("previous");
    const recoveredState=join(root,"recovered");await mkdir(recoveredState,{mode:0o700});
    prepared=await prepareClaudeDesktopLaunch({...input,stateDir:recoveredState},app,join(root,"engine"),system);
    expect(await Bun.file(join(userData,"configLibrary",crashMeta.appliedId+".json")).exists()).toBe(false);
    await prepared.cleanup?.();prepared=undefined;
    expect(await readFile(metaPath,"utf8")).toBe(previous);
    await expect(prepareClaudeDesktopLaunch({...input,protocol:"openai-responses"},app,join(root,"engine"),system)).rejects.toThrow();
    await expect(prepareClaudeDesktopLaunch(input,{...app,version:"1.100.0"},join(root,"engine"),system)).rejects.toMatchObject({code:"desktop_version"});
    await rm(metaPath);await symlink(join(userData,"saved-chat"),metaPath);
    await expect(prepareClaudeDesktopLaunch({...input,stateDir:root},app,join(root,"engine"),system)).rejects.toMatchObject({code:"desktop_state_permissions"});
  }finally{await prepared?.cleanup?.();await upstream.stop(true);await rm(root,{recursive:true,force:true});}
});

test("Claude desktop installation requires its actual bundle and macOS",async()=>{
  const system={platform:"darwin",home:"/fixture",isDirectory:async()=>true,executable:async()=>true,run:async(_command:string,args:string[])=>args[1]==="CFBundleIdentifier"?app.bundleId:args[1]==="CFBundleExecutable"?"Claude":app.version};
  expect(await detectClaudeDesktopApp(app.path,system)).toEqual(app);
  await expect(detectClaudeDesktopApp(app.path,{...system,platform:"linux"})).rejects.toMatchObject({code:"unsupported_platform"});
  await expect(detectClaudeDesktopApp(app.path,{...system,run:async()=>"unrelated.bundle"})).rejects.toMatchObject({code:"app_not_installed"});
});

test.skipIf(process.platform!=="darwin")("exact Claude desktop CLI launches without a global Claude CLI and removes its gateway credential on exit",async()=>{
  const root=await mkdtemp(join(tmpdir(),"switcher-claude-cli-")),bundle=join(root,"Claude.app"),contents=join(bundle,"Contents");
  await mkdir(join(contents,"MacOS"),{recursive:true});
  await writeFile(join(contents,"Info.plist"),`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${app.bundleId}</string><key>CFBundleExecutable</key><string>Claude</string><key>CFBundleShortVersionString</key><string>${app.version}</string></dict></plist>`);
  await writeFile(join(contents,"MacOS/Claude"),`#!${process.execPath}\nconst dir=process.env.HOME+"/Library/Application Support/Claude-3p/configLibrary/";const meta=await Bun.file(dir+"_meta.json").json();const config=await Bun.file(dir+meta.appliedId+".json").json();await Bun.write(${JSON.stringify(join(root,"receipt.json"))},JSON.stringify({model:config.inferenceModels[0].labelOverride,configPath:dir+meta.appliedId+".json",home:process.env.CLAUDE_CONFIG_DIR,override:process.env.CLAUDE_USER_DATA_DIR}));console.log("private-gui-output");\n`,{mode:0o700});
  const run=async(args:string[])=>{
    const child=Bun.spawn([process.execPath,join(import.meta.dir,"../src/cli.ts"),...args],{cwd:root,env:{PATH:"/usr/bin:/bin",HOME:root,HASNA_STATION:"desktop-cli-fixture",HASNA_SWITCHER_HOME:join(root,"data")},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
    const timer=setTimeout(()=>child.kill("SIGKILL"),15000);
    try {const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);return{code,stdout,stderr};}finally{clearTimeout(timer);}
  };
  try {
    const added=await run(["providers","add","arbitrary","--url","http://127.0.0.1:9997","--protocol","anthropic-messages","--catalog-format","none","--model","vendor/model"]);expect(added.code,added.stderr).toBe(0);
    const command=["launch","claude-desktop","--provider","arbitrary","--model","vendor/model","--app-path",bundle];
    const plan=await run([...command,"--dry-run"]);expect(plan.code,plan.stderr).toBe(0);expect(JSON.parse(plan.stdout).desktop.mode).toBe("claude-3p-gateway");
    for(const extra of [["--reasoning","max"],["--dangerously-bypass-approvals-and-sandbox"],["--","--print"]])expect((await run([...command,...extra])).code).toBe(1);
    const result=await run(command);expect(result.code,result.stderr).toBe(0);expect(result.stdout).toBe("");expect(result.stderr).not.toContain("private-gui-output");
    const receipt=await Bun.file(join(root,"receipt.json")).json();expect(receipt.model).toBe("vendor/model");expect(receipt.override).toBeUndefined();expect(await Bun.file(receipt.configPath).exists()).toBe(false);
    expect((await run(command)).code).toBe(0);
  }finally{await rm(root,{recursive:true,force:true});}
},30000);
