import { expect,test } from "bun:test";
import { mkdtemp,mkdir,readFile,writeFile,rm,stat,symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareChatGPTLaunch } from "../src/chatgpt-launch";
import type { PreparedLaunch } from "../src/harness-types";

test("desktop profiles pin the runtime/provider, isolate state, protect credentials and retain sessions across relaunch",async()=>{
  const root=await mkdtemp(join(tmpdir(),"switcher-chatgpt-")),state=join(root,"launch"),session=join(root,"session");
  await mkdir(state,{mode:0o700});
  const nativePath=join(root,"native-codex");
  await writeFile(nativePath,`#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),home:process.env.CODEX_HOME,ambientKey:process.env.OPENAI_API_KEY}));\n`,{mode:0o700});
  const app={path:"/Applications/ChatGPT.app",executable:"/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",codexExecutable:nativePath,bundleId:"com.openai.codex",version:"26.901.51231"};
  const native:PreparedLaunch={executable:nativePath,args:["-c",'model="provider/model"',"-c",'model_provider="switcher"',"-c",'model_providers.switcher={name="Switcher",base_url="http://127.0.0.1:9876/v1",env_key="SWITCHER_HARNESS_API_KEY",wire_api="responses",requires_openai_auth=false}'],env:{SWITCHER_HARNESS_API_KEY:"fixture-loopback-token"},configPaths:[],warnings:[]};
  let prepared:PreparedLaunch|undefined;
  try {
    prepared=await prepareChatGPTLaunch(native,app,state,session);
    expect(prepared.executable).toBe(app.executable);
    expect(prepared.env.CODEX_HOME).toBe(join(session,"codex"));
    expect(prepared.env.CODEX_ELECTRON_USER_DATA_PATH).toBe(join(session,"electron"));
    expect(prepared.args).toEqual([`--user-data-dir=${join(session,"electron")}`]);
    const config=Bun.TOML.parse(await readFile(join(session,"codex/config.toml"),"utf8"));
    expect(config).toMatchObject({model:"provider/model",model_provider:"switcher",forced_login_method:"api",cli_auth_credentials_store:"file",approval_policy:"on-request",sandbox_mode:"workspace-write"});
    const script=await readFile(prepared.env.CODEX_CLI_PATH,"utf8");expect(script).not.toContain(native.env.SWITCHER_HARNESS_API_KEY);
    const child=Bun.spawn([prepared.env.CODEX_CLI_PATH,"app-server","-c",'model="wrong"'],{env:{PATH:process.env.PATH,OPENAI_API_KEY:"unrelated-fixture-key",...prepared.env},stdout:"pipe",stderr:"pipe"});
    const output=JSON.parse(await new Response(child.stdout).text());expect(await child.exited).toBe(0);
    expect(output.args.indexOf('model="wrong"')).toBeLessThan(output.args.indexOf('model="provider/model"'));
    expect(output.home).toBe(join(session,"codex"));
    expect(output.ambientKey).toBeUndefined();
    const sandboxArgs=["sandbox","-c",'default_permissions="node_repl"',"-c",'permissions.node_repl={filesystem={":root"="read"},network={enabled=false}}',"--","/path with spaces/node","--experimental-vm-modules","/path with spaces/kernel.js","--session-id","fixture-session"];
    const helper=Bun.spawn([prepared.env.CODEX_CLI_PATH,...sandboxArgs],{env:{PATH:process.env.PATH,OPENAI_API_KEY:"unrelated-fixture-key",...prepared.env},stdout:"pipe",stderr:"pipe"});
    const helperOutput=JSON.parse(await new Response(helper.stdout).text());expect(await helper.exited).toBe(0);
    expect(helperOutput.args).toEqual(sandboxArgs);
    expect(helperOutput.home).toBe(join(session,"codex"));
    expect(helperOutput.ambientKey).toBeUndefined();
    await expect(prepareChatGPTLaunch(native,app,state,session)).rejects.toMatchObject({code:"desktop_busy"});
    const saved=join(session,"codex/saved-conversation");await writeFile(saved,"keep");
    expect((await stat(join(session,"codex/auth.json"))).mode&0o777).toBe(0o600);
    await prepared.cleanup?.();prepared=undefined;
    expect(await Bun.file(join(session,"codex/auth.json")).exists()).toBe(false);
    expect(await readFile(saved,"utf8")).toBe("keep");
    const state2=join(root,"launch2");await mkdir(state2,{mode:0o700});
    prepared=await prepareChatGPTLaunch(native,app,state2,session);
    expect(await readFile(saved,"utf8")).toBe("keep");
    const auth=join(session,"codex/auth.json");
    await writeFile(auth,"manually-changed-auth");
    await prepared.cleanup?.();prepared=undefined;
    expect(await readFile(auth,"utf8")).toBe("manually-changed-auth");
    await expect(prepareChatGPTLaunch(native,app,state2,session)).rejects.toMatchObject({code:"desktop_auth_changed"});
    await rm(auth);await symlink(saved,auth);
    await expect(prepareChatGPTLaunch(native,app,state2,session)).rejects.toMatchObject({code:"desktop_state_permissions"});
    expect(await readFile(saved,"utf8")).toBe("keep");
  }finally{await prepared?.cleanup?.();await rm(root,{recursive:true,force:true});}
});

test.skipIf(process.platform!=="darwin")("exact desktop CLI selects an arbitrary Responses provider and records app exit without leaking GUI output",async()=>{
  const root=await mkdtemp(join(tmpdir(),"switcher-desktop-cli-"));
  const app=join(root,"Installed ChatGPT.app"),contents=join(app,"Contents");
  await mkdir(join(contents,"MacOS"),{recursive:true});await mkdir(join(contents,"Resources"));
  await writeFile(join(contents,"Info.plist"),`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.openai.codex</string><key>CFBundleExecutable</key><string>ChatGPT</string><key>CFBundleShortVersionString</key><string>26.901.51231</string></dict></plist>`);
  await writeFile(join(contents,"Resources/codex"),"#!/bin/sh\necho 'codex-cli 0.153.4'\n",{mode:0o700});
  await writeFile(join(contents,"MacOS/ChatGPT"),`#!${process.execPath}\nconst config=Bun.TOML.parse(await Bun.file(process.env.CODEX_HOME+"/config.toml").text());await Bun.write(${JSON.stringify(join(root,"receipt.json"))},JSON.stringify({model:config.model,provider:config.model_provider,home:process.env.CODEX_HOME,reasoning:config.model_reasoning_effort,approval:config.approval_policy,sandbox:config.sandbox_mode}));console.log("private-gui-output");process.exit(7);\n`,{mode:0o700});
  const run=async(args:string[])=>{
    const child=Bun.spawn([process.execPath,join(import.meta.dir,"../src/cli.ts"),...args],{cwd:root,env:{PATH:process.env.PATH,HOME:root,HASNA_STATION:"desktop-cli-fixture",HASNA_SWITCHER_LOCAL:"1",HASNA_SWITCHER_HOME:join(root,"data")},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
    const timer=setTimeout(()=>child.kill("SIGKILL"),15000);
    try{const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);return {code,stdout,stderr};}finally{clearTimeout(timer);}
  };
  try {
    const created=await run(["providers","add","arbitrary","--url","http://127.0.0.1:9997/v1","--protocol","openai-responses","--catalog-format","none","--model","vendor/model"]);
    expect(created.code,created.stderr).toBe(0);
    const command=["launch","chatgpt","--provider","arbitrary","--model","vendor/model","--app-path",app,"--reasoning","max","--dangerously-bypass-approvals-and-sandbox"];
    const plan=await run([...command,"--dry-run"]);expect(plan.code,plan.stderr).toBe(0);
    expect(JSON.parse(plan.stdout)).toMatchObject({profile:{harness:"codex",model:"vendor/model"},desktop:{path:app,mode:"isolated-provider"}});
    expect(await Bun.file(join(root,"receipt.json")).exists()).toBe(false);
    for(const extra of [["--backend","direct"],["--","exec"]])expect((await run([...command,...extra])).code).toBe(1);
    const launched=await run(command);expect(launched.code,launched.stderr).toBe(7);
    expect(launched.stdout).toBe("");expect(launched.stderr).not.toContain("private-gui-output");
    const receipt=await Bun.file(join(root,"receipt.json")).json();expect(receipt).toMatchObject({model:"vendor/model",provider:"switcher",reasoning:"max",approval:"never",sandbox:"danger-full-access"});
    expect(await Bun.file(join(receipt.home,"auth.json")).exists()).toBe(false);
    const normal=await run(command.slice(0,-3));expect(normal.code,normal.stderr).toBe(7);
    expect(await Bun.file(join(root,"receipt.json")).json()).toMatchObject({approval:"on-request",sandbox:"workspace-write"});
    const runs=await run(["runs","list"]);expect(runs.code,runs.stderr).toBe(0);
    expect(JSON.parse(runs.stdout).data[0]).toMatchObject({status:"failed",exitCode:7});
  }finally{await rm(root,{recursive:true,force:true});}
},30000);
