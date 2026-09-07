import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

async function renderScenario(scenario: "slow" | "error" | "mixed") {
  const root = mkdtempSync(join(tmpdir(), "conversations-session-polling-"));
  try {
    const script = join(root, "render.ts");
    writeFileSync(script, `
      import React from ${JSON.stringify(import.meta.resolve("react"))};
      import {render} from ${JSON.stringify(import.meta.resolve("ink"))};
      import {PassThrough} from 'node:stream';
      import {SessionList} from ${JSON.stringify(join(import.meta.dir, "SessionList.tsx"))};
      let calls=0,active=0,maxActive=0,failed=${scenario !== "slow"};
      const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
        const path=new URL(req.url).pathname;
        if(path==='/v1/sessions') {
          calls++;active++;maxActive=Math.max(maxActive,active);
          if(${scenario !== "error"})await Bun.sleep(1400);
          active--;
        }
        if(failed)return Response.json({error:'synthetic unavailable'},{status:403});
        if(path==='/v1/sessions')return Response.json({sessions:[]});
        if(path==='/v1/channels')return Response.json({channels:[]});
        if(path==='/v1/messages/unread-counts')return Response.json({counts:[]});
        return Response.json({error:'fixture route missing'},{status:404});
      }});
      process.env.HASNA_CONVERSATIONS_API_URL=server.url.origin;
      process.env.HASNA_CONVERSATIONS_API_KEY_OVERRIDE=crypto.randomUUID();
      const stdin=Object.assign(new PassThrough(),{isTTY:true,setRawMode:()=>{},ref:()=>{},unref:()=>{}});
      const stdout=Object.assign(new PassThrough(),{isTTY:true,columns:90,rows:25});
      let screen='';stdout.on('data',c=>{screen+=c.toString()});
      const ui=render(React.createElement(SessionList,{agent:'synthetic-reader',onSelect:()=>{},onSelectChannel:()=>{},onNew:()=>{}}),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});
      try {
        if (${scenario !== "error"}) await Bun.sleep(1100);
        else {const deadline=Date.now()+2500;while(!screen.includes('Unable to load conversations')&&Date.now()<deadline)await Bun.sleep(20);}
        const first={calls,screen};failed=false;
        if (${scenario !== "error"}) await Bun.sleep(1450);
        else {const deadline=Date.now()+3000;while(!screen.includes('No conversations yet')&&Date.now()<deadline)await Bun.sleep(20);}
        console.log(JSON.stringify({first,calls,maxActive,screen}));
      } finally {ui.unmount();stdin.destroy();stdout.destroy();server.stop(true)}
      process.exit(0);
    `);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(HASNA_|CONVERSATIONS_|DATABASE_URL$|PG|XDG_)/.test(key))) as Record<string, string>;
    Object.assign(env, { HOME: root, HASNA_HOME: root, HASNA_CONFIG_HOME: root, HASNA_STATION: `fixture-${randomUUID()}` });
    const child = Bun.spawn([process.execPath, script], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(0);
    expect(stderr).not.toContain("The above error occurred");
    const line = stdout.split("\n").find(value => value.startsWith('{"first":'));
    expect(line).toBeDefined();
    expect(readdirSync(root, { recursive: true }).map(String).filter(path => /\.(?:db|sqlite|sqlite3)(?:-wal|-shm)?$/.test(path))).toEqual([]);
    return JSON.parse(line!);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("actual API-backed render polls without render loops or overlapping slow requests", async () => {
  const result = await renderScenario("slow");
  expect(result.first.calls).toBe(1);
  expect(result.calls).toBe(2);
  expect(result.maxActive).toBe(1);
  expect(result.screen).toContain("No conversations yet");
}, 10000);

test("actual API failure renders an error instead of an empty inbox and recovers on refresh", async () => {
  const result = await renderScenario("error");
  expect(result.first.screen).toContain("Unable to load conversations");
  expect(result.first.screen).not.toContain("No conversations yet");
  expect(result.calls).toBe(2);
  expect(result.screen).toContain("No conversations yet");
}, 10000);

test("a fast failed endpoint does not release the refresh gate while another request is pending", async () => {
  const result = await renderScenario("mixed");
  expect(result.first.calls).toBe(1);
  expect(result.calls).toBe(2);
  expect(result.maxActive).toBe(1);
  expect(result.screen).toContain("Unable to load conversations");
}, 10000);
