import { expect,test } from "bun:test";
import { mkdtemp,mkdir,readFile,writeFile,rm,realpath,readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareChatGPTLaunch } from "../src/chatgpt-launch";
import { resolveNativeState } from "../src/native-state";
import { HarnessSettlementError } from "../src/harness-process";
import { desktopAdmissionFixture,desktopHelperFixture,desktopInspectorPreload } from "./fixtures/codex-desktop";
import type { PreparedLaunch } from "../src/harness-types";

test("desktop protocol binds canonical state and private auth, dispatches actual app argv, and refuses drift before spawn",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"switcher-chatgpt-"))),launch=join(root,"launch"),session=join(root,"session");
  await mkdir(launch,{mode:0o700});
  const state=await resolveNativeState("codex",{HOME:root});
  const canonicalConfig='developer_instructions="shared fixture"\n';
  await writeFile(join(state.home,"config.toml"),canonicalConfig,{mode:0o600});
  await writeFile(join(state.home,"auth.json"),"canonical account fixture",{mode:0o600});
  const nativePath=join(root,"native-codex"),receiptPath=join(root,"called.json");
  const nativeText=`#!${process.execPath}\nimport{createInterface}from'node:readline';const receipt={args:process.argv.slice(2),home:process.env.CODEX_HOME,ambientKey:process.env.OPENAI_API_KEY,gatewayKey:process.env.SWITCHER_HARNESS_API_KEY,socket:process.env.CODEX_APP_TOOLS_PIPE_PATH,endpoint:process.env.CODEX_API_ENDPOINT,accessToken:process.env.CODEX_ACCESS_TOKEN};await Bun.write(${JSON.stringify(receiptPath)},JSON.stringify(receipt));if(receipt.args.includes('sandbox')||receipt.args.includes('--version')||receipt.args.includes('--help'))console.log(JSON.stringify(receipt));else createInterface({input:process.stdin}).on('line',line=>console.log(line));\n`;
  await writeFile(nativePath,nativeText,{mode:0o700});
  const app={path:"/Applications/ChatGPT.app",executable:"/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",codexExecutable:"/untrusted/bundled-native",bundleId:"com.openai.codex",version:"26.908.40834"};
  const native:PreparedLaunch={executable:nativePath,args:["-c",'model="provider/model"',"-c",'model_provider="switcher"',"-c",'model_providers.switcher={name="Switcher",base_url="http://127.0.0.1:9876/v1",env_key="SWITCHER_HARNESS_API_KEY",wire_api="responses",requires_openai_auth=false}',"-c",`model_catalog_json=${JSON.stringify(join(launch,"models.json"))}`],env:{SWITCHER_HARNESS_API_KEY:"fixture-loopback-token"},configPaths:[],warnings:[]};
  let prepared:PreparedLaunch|undefined;
  try {
    prepared=await prepareChatGPTLaunch(native,app,launch,session,state,await desktopAdmissionFixture(nativePath,session,state));
    await prepared.beforeLaunch?.();
    expect(prepared.executable).toBe(app.executable);
    expect(prepared.env.CODEX_HOME).toBe(state.home);
    expect(prepared.args).toEqual([`--user-data-dir=${join(session,"electron")}`]);
    const script=await readFile(prepared.env.CODEX_CLI_PATH,"utf8");
    expect(script).not.toContain(native.env.SWITCHER_HARNESS_API_KEY);expect(script).not.toContain('${1-}');
    const binding=await Bun.file(join(launch,"desktop-binding.json")).json();
    expect(binding).toMatchObject({nativeExecutable:nativePath,authHome:join(launch,"auth")});
    const env={PATH:process.env.PATH,OPENAI_API_KEY:"ambient-fixture-key",CODEX_APP_TOOLS_PIPE_PATH:"/fixture/kernel.sock",CODEX_API_ENDPOINT:"localhost",CODEX_ACCESS_TOKEN:"ambient-fixture-codex-token",...prepared.env};
    const runCommand=async(command:string[],input?:object)=>{
      const child=Bun.spawn(command,{env,stdin:"pipe",stdout:"pipe",stderr:"pipe"});
      if(input)child.stdin.write(JSON.stringify(input)+"\n");child.stdin.end();
      const timer=setTimeout(()=>child.kill("SIGKILL"),10000);
      try{const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);return {code,stdout,stderr};}finally{clearTimeout(timer);}
    };
    const run=async(args:string[],input?:object)=>runCommand(await desktopHelperFixture(prepared!,nativePath,args),input);
    const appArgs=["-c","features.code_mode_host=true","app-server","--analytics-default-enabled"];
    const result=await run(appArgs,{id:1,method:"thread/start",params:{model:"old",modelProvider:"old"}});
    expect(result.code,result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).params).toMatchObject({model:"provider/model",modelProvider:"switcher"});
    const receipt=await Bun.file(receiptPath).json();
    expect(receipt.args.slice(0,4)).toEqual(["--auth-home",join(launch,"auth"),"-c",'cli_auth_credentials_store="file"']);
    expect(receipt.args.slice(4,8)).toEqual(appArgs);
    expect(receipt).toMatchObject({home:state.home,gatewayKey:"fixture-loopback-token"});
    expect(receipt.ambientKey).toBeUndefined();expect(receipt.endpoint).toBeUndefined();expect(receipt.accessToken).toBeUndefined();expect(receipt.socket).toBe("/fixture/kernel.sock");
    const sandboxArgs=["sandbox","-c",'default_permissions="node_repl"',"-c",'permissions.node_repl={filesystem={":root"="read"},network={enabled=false}}',"--","/path with spaces/node","--experimental-vm-modules","/path with spaces/kernel.js","--session-id","fixture-session"];
    const helper=await run(sandboxArgs);expect(helper.code,helper.stderr).toBe(0);
    expect(JSON.parse(helper.stdout)).toMatchObject({args:sandboxArgs,home:state.home,socket:"/fixture/kernel.sock",gatewayKey:"switcher-metadata-no-auth"});
    expect(JSON.parse(helper.stdout).ambientKey).toBeUndefined();expect(JSON.parse(helper.stdout).endpoint).toBeUndefined();expect(JSON.parse(helper.stdout).accessToken).toBeUndefined();
    const version=await run(["--version"]);expect(version.code,version.stderr).toBe(0);
    expect(JSON.parse(version.stdout)).toMatchObject({args:["--version"],gatewayKey:"switcher-metadata-no-auth"});
    const help=await run(["app-server","--help"]);expect(help.code,help.stderr).toBe(0);
    expect(JSON.parse(help.stdout)).toMatchObject({args:["app-server","--help"],gatewayKey:"switcher-metadata-no-auth"});
    expect(JSON.parse(help.stdout).socket).toBeUndefined();
    const lastInvocation=await readFile(receiptPath,"utf8");
    for(const args of [["exec","unsafe"],["app-server","proxy"],["--auth-home","/other","app-server"],["app-server","--listen","tcp://127.0.0.1:7777"],["--help","exec"]]) {
      expect((await run(args)).code).toBe(1);expect(await readFile(receiptPath,"utf8")).toBe(lastInvocation);
    }
    const staleNativeCommand=await desktopHelperFixture(prepared,nativePath,appArgs);
    await writeFile(nativePath,nativeText+"\n// changed native\n");
    expect((await runCommand(staleNativeCommand)).code).toBe(1);expect(await readFile(receiptPath,"utf8")).toBe(lastInvocation);
    await writeFile(nativePath,nativeText);
    await writeFile(join(state.home,"config.toml"),canonicalConfig+'model="changed"\n');
    expect((await run(appArgs)).code).toBe(1);expect(await readFile(receiptPath,"utf8")).toBe(lastInvocation);
    await writeFile(join(state.home,"config.toml"),canonicalConfig);
    const staleBindingCommand=await desktopHelperFixture(prepared,nativePath,appArgs),bindingText=await readFile(join(launch,"desktop-binding.json"),"utf8");
    await writeFile(join(launch,"desktop-binding.json"),bindingText+" ");
    expect((await runCommand(staleBindingCommand)).code).toBe(1);expect(await readFile(receiptPath,"utf8")).toBe(lastInvocation);
    await writeFile(join(launch,"desktop-binding.json"),bindingText);
    await writeFile(join(launch,"auth/auth.json"),"manually-changed-auth");
    expect((await run(appArgs)).code).toBe(1);expect(await readFile(receiptPath,"utf8")).toBe(lastInvocation);
    await expect(prepared.cleanup!()).rejects.toBeInstanceOf(HarnessSettlementError);
    expect(await readFile(join(launch,"auth/auth.json"),"utf8")).toBe("manually-changed-auth");
    expect((await readdir(join(session,"codex-bridges"))).length).toBe(1);
    await expect(desktopAdmissionFixture(nativePath,session,state)).rejects.toBeInstanceOf(HarnessSettlementError);
    expect(await readFile(join(state.home,"auth.json"),"utf8")).toBe("canonical account fixture");
    expect(await readFile(join(state.home,"config.toml"),"utf8")).toBe(canonicalConfig);
  }finally{await prepared?.cleanup?.().catch(()=>{});await rm(root,{recursive:true,force:true});}
},30000);

test.skipIf(process.platform!=="darwin")("source desktop CLI protocol fixture selects Responses provider and records app exit without leaking GUI output",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"switcher-desktop-cli-")));
  const app=join(root,"Installed ChatGPT.app"),contents=join(app,"Contents"),nativePath=join(contents,"Resources/codex");
  await mkdir(join(contents,"MacOS"),{recursive:true});await mkdir(join(contents,"Resources"));
  await writeFile(join(contents,"Info.plist"),`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.openai.codex</string><key>CFBundleExecutable</key><string>ChatGPT</string><key>CFBundleShortVersionString</key><string>26.908.40834</string></dict></plist>`);
  await mkdir(join(root,".codex"),{mode:0o700});
  await writeFile(join(root,".codex/compact.md"),"canonical compact fixture",{mode:0o600});
  await writeFile(join(root,".codex/config.toml"),'experimental_compact_prompt_file="compact.md"\n',{mode:0o600});
  await writeFile(nativePath,`#!${process.execPath}\nif(process.argv.includes('--version')){console.log('codex-cli 0.154.0');process.exit(0)}\nimport{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',line=>console.log(line));\n`,{mode:0o700});
  const inspector=await desktopInspectorPreload(root,nativePath),bridgeSource=join(import.meta.dir,"../src/codex-state-bridge.ts");
  await writeFile(join(contents,"MacOS/ChatGPT"),`#!${process.execPath}\nimport{dirname,join}from'node:path';import{createHash}from'node:crypto';const canonical=Bun.TOML.parse(await Bun.file(process.env.CODEX_HOME+"/config.toml").text());const path=join(dirname(process.env.CODEX_CLI_PATH),'desktop-binding.json');const text=await Bun.file(path).text(),binding=JSON.parse(text);const config=Bun.TOML.parse(binding.args.filter((_,i)=>i%2===1).join('\\n'));const bridge=Bun.spawn([${JSON.stringify(process.execPath)},'--preload',${JSON.stringify(inspector)},${JSON.stringify(bridgeSource)},'--desktop',path,createHash('sha256').update(text).digest('hex'),'--','-c','features.code_mode_host=true','app-server','--analytics-default-enabled'],{env:process.env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});bridge.stdin.write(JSON.stringify({id:1,method:'thread/list',params:{modelProviders:['old'],useStateDbOnly:true}})+'\\n');bridge.stdin.end();const bridged=JSON.parse(await new Response(bridge.stdout).text());if(await bridge.exited)process.exit(8);const compact=join(process.env.CODEX_HOME,canonical.experimental_compact_prompt_file);await Bun.write(${JSON.stringify(join(root,"receipt.json"))},JSON.stringify({model:config.model,provider:config.model_provider,home:process.env.CODEX_HOME,authHome:binding.authHome,reasoning:config.model_reasoning_effort,approval:config.approval_policy,sandbox:config.sandbox_mode,compact,compactText:await Bun.file(compact).text(),bridged:bridged.params}));console.log("private-gui-output");process.exit(7);\n`,{mode:0o700});
  const run=async(args:string[])=>{
    const child=Bun.spawn([process.execPath,"--preload",inspector,join(import.meta.dir,"../src/cli.ts"),...args],{cwd:root,env:{PATH:process.env.PATH,HOME:root,HASNA_STATION:"desktop-cli-fixture",HASNA_SWITCHER_LOCAL:"1",HASNA_SWITCHER_HOME:join(root,"data")},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
    const timer=setTimeout(()=>child.kill("SIGKILL"),15000);
    try{const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);return {code,stdout,stderr};}finally{clearTimeout(timer);}
  };
  try {
    const created=await run(["providers","add","arbitrary","--url","http://127.0.0.1:9997/v1","--protocol","openai-responses","--catalog-format","none","--model","vendor/model"]);
    expect(created.code,created.stderr).toBe(0);
    const command=["launch","chatgpt","--provider","arbitrary","--model","vendor/model","--share-native-state","--app-path",app,"--reasoning","max","--dangerously-bypass-approvals-and-sandbox"];
    const plan=await run([...command,"--dry-run"]);expect(plan.code,plan.stderr).toBe(0);
    expect(JSON.parse(plan.stdout)).toMatchObject({profile:{harness:"codex",model:"vendor/model"},desktop:{path:app,mode:"shared-state-private-auth",sessionIdentity:"canonical-native-corpus"}});
    expect(await Bun.file(join(root,"receipt.json")).exists()).toBe(false);
    for(const extra of [["--backend","direct"],["--","exec"]])expect((await run([...command,...extra])).code).toBe(1);
    const launched=await run(command);expect(launched.code,launched.stderr).toBe(7);
    expect(launched.stdout).toBe("");expect(launched.stderr).not.toContain("private-gui-output");
    const receipt=await Bun.file(join(root,"receipt.json")).json();expect(receipt).toMatchObject({model:"vendor/model",provider:"switcher",home:join(root,".codex"),reasoning:"max",approval:"never",sandbox:"danger-full-access",compact:join(root,".codex/compact.md"),compactText:"canonical compact fixture",bridged:{modelProviders:[],useStateDbOnly:false}});
    expect(await Bun.file(join(receipt.authHome,"auth.json")).exists()).toBe(false);
    const normal=await run(command.slice(0,-3));expect(normal.code,normal.stderr).toBe(7);
    expect(await Bun.file(join(root,"receipt.json")).json()).toMatchObject({approval:"on-request",sandbox:"workspace-write"});
    const runs=await run(["runs","list"]);expect(runs.code,runs.stderr).toBe(0);
    expect(JSON.parse(runs.stdout).data[0]).toMatchObject({status:"failed",exitCode:7});
  }finally{await rm(root,{recursive:true,force:true});}
},30000);
