import { test, expect } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { prepareHarnessLaunch } from "../src/harnesses";

test("Claude always injects current policy and denies catalog models not authorized for this launch", async () => {
  const requests: any[] = [];
  const provider = Bun.serve({hostname:"127.0.0.1", port:0, fetch: async r => { requests.push(await r.json()); return Response.json({model:"deepseek-v4-flash"}); }});
  const root = join(homedir(),"Workspace","scratch","switcher-tests"); await mkdir(root,{recursive:true});
  const stateDir = await mkdtemp(join(root,"policy-launch-"));
  let prepared;
  try {
    prepared = await prepareHarnessLaunch({harness:"claude", baseUrl:provider.url.href+"v1", protocol:"anthropic-messages", authStyle:"x-api-key", model:"deepseek-v4-flash", models:[{id:"deepseek-v4-flash",name:"Flash"},{id:"opus",name:"Unassigned model"}], credential:"fixture-credential", stateDir,cwd:stateDir,version:"2.1.263"});
    const send = (model:string) => fetch(prepared!.env.ANTHROPIC_BASE_URL+"/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":prepared!.env.ANTHROPIC_API_KEY},body:JSON.stringify({model,system:"Native instructions",messages:[{role:"user",content:"Hello"}],max_tokens:10})});
    expect((await send("opus")).status).toBe(403);
    expect(requests).toHaveLength(0);
    expect((await send("deepseek-v4-flash")).status).toBe(200);
    expect(JSON.stringify(requests[0].system)).toContain("Switcher model policy");
    expect(JSON.stringify(requests[0].system)).toContain("Native instructions");
    expect(prepared.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE).toBe("1");
    expect(prepared.env.ANTHROPIC_API_KEY).not.toBe("fixture-credential");
  } finally {await prepared?.cleanup?.(); await provider.stop(true); await rm(stateDir,{recursive:true,force:true});}
});
