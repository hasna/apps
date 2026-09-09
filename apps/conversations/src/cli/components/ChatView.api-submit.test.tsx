import {expect,test} from "bun:test";
import {mkdtempSync,writeFileSync,rmSync,readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";

async function scenario(mode: "send" | "failure-draft" | "failure-restore" | "read" | "detail" | "mark-zero" | "new-dm") {
  const root=mkdtempSync(join(tmpdir(),"conversations-chat-submit-"));
  try {
    const script=join(root,"scenario.ts");
    writeFileSync(script,`
      import React from ${JSON.stringify(import.meta.resolve("react"))};
      import {render} from ${JSON.stringify(import.meta.resolve("ink"))};
      import {PassThrough} from 'node:stream';
      import {ChatView} from ${JSON.stringify(join(import.meta.dir,"ChatView.tsx"))};
      const mode=${JSON.stringify(mode)};
      const posts=[],rows=[];let marks=0,details=0,screen='',recoverReads=false;
      const row=(body,id)=>({id,uuid:body.uuid,from_agent:body.from,to_agent:body.to,channel:body.channel,session_id:body.session_id||'fixture-dm-session',content:body.content,priority:'normal',created_at:new Date().toISOString(),read_at:null,metadata:null});
      if(mode==='detail'||mode==='read'||mode==='mark-zero')rows.push(row({uuid:crypto.randomUUID(),from:'other',to:'room',channel:'room',session_id:'channel:room',content:'fixture preview'},1));
      const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
        const url=new URL(req.url);
        if(url.pathname==='/v1/messages'&&req.method==='POST') {
          const body=await req.json();posts.push(body);const count=posts.length;
          if(!mode.startsWith('failure')||count>1)rows.push(row(body,count));
          await Bun.sleep(650);
          if(mode.startsWith('failure')&&count===1)return Response.json({error:'private-error-body-must-not-appear'},{status:403});
          return Response.json({message:row(body,count)},{status:201});
        }
        if(url.pathname==='/v1/messages/read'){marks++;if(mode==='mark-zero')return Response.json({marked:0});return Response.json({error:'private-error-body-must-not-appear'},{status:403});}
        if(/^\\/v1\\/messages\\/\\d+$/.test(url.pathname)){details++;return Response.json({error:'private-error-body-must-not-appear'},{status:403});}
        if(url.pathname==='/v1/messages') {
          if(mode==='read'&&!recoverReads)return Response.json({error:'private-error-body-must-not-appear'},{status:403});
          const since=Number(url.searchParams.get('since_id')||0);
          return Response.json({messages:rows.filter(r=>r.id>since).map(r=>({...r,preview:r.content,unread:true})),has_more:false,next_cursor:null});
        }
        return Response.json({error:'fixture missing'},{status:404});
      }});
      process.env.HASNA_CONVERSATIONS_API_URL=server.url.origin;
      process.env.HASNA_CONVERSATIONS_API_KEY_OVERRIDE=crypto.randomUUID();
      const stdin=Object.assign(new PassThrough(),{isTTY:true,setRawMode:()=>{},ref:()=>{},unref:()=>{}});
      const stdout=Object.assign(new PassThrough(),{isTTY:true,columns:120,rows:35});stdout.on('data',c=>screen+=c.toString());
      const ui=render(React.createElement(ChatView,{agent:'fixture-sender',...(mode==='new-dm'?{recipient:'fixture-other'}:{channelName:'room'}),onBack:()=>{}}),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});
      const wait=async(check)=>{const end=Date.now()+4000;while(!check()){if(Date.now()>end)throw new Error('fixture condition timed out');await Bun.sleep(20);}};
      try {
        await Bun.sleep(100);
        if(mode==='read'){await wait(()=>screen.includes('Unable to'));recoverReads=true;await wait(()=>screen.includes('fixture preview'));}
        else if(mode==='detail'||mode==='mark-zero') {
          await wait(()=>screen.includes('fixture preview'));stdin.write('v');await wait(()=>screen.includes('Unable to load message detail'));
          stdin.write('\\x7f');await Bun.sleep(80);stdin.write('m');await wait(()=>screen.includes(mode==='mark-zero'?'Read acknowledgement was not confirmed':'Unable to mark message read'));
        } else {
          stdin.write('first draft');await Bun.sleep(80);stdin.write('\\r');await Bun.sleep(10);stdin.write('\\r');
          await wait(()=>posts.length>=1);await Bun.sleep(80);
          const pendingPosts=posts.length;
          if(mode!=='failure-restore')stdin.write('next draft');
          await Bun.sleep(900);
          const beforeRetry=posts.length;stdin.write('\\r');await wait(()=>posts.length>beforeRetry);await Bun.sleep(750);
          console.log(JSON.stringify({pendingPosts,beforeRetry,contents:posts.map(p=>p.content),sessions:posts.map(p=>p.session_id??null),screen}));
        }
        if(mode==='read'||mode==='detail'||mode==='mark-zero')console.log(JSON.stringify({marks,details,screen}));
      } finally {ui.unmount();stdin.destroy();stdout.destroy();server.stop(true)}
      process.exit(0);
    `);
    const env=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&!/^(HASNA_|CONVERSATIONS_|DATABASE_URL$|PG|XDG_)/.test(key))) as Record<string,string>;
    Object.assign(env,{HOME:root,HASNA_HOME:root,HASNA_CONFIG_HOME:root,HASNA_STATION:`fixture-${randomUUID()}`});
    // These children model an interactive terminal; Ink otherwise defers CI frames until unmount.
    env.CI = "false";
    env.CONTINUOUS_INTEGRATION = "false";
    const child=Bun.spawn([process.execPath,script],{cwd:root,env,stdout:"pipe",stderr:"pipe"});
    const timer=setTimeout(()=>child.kill(),9000);
    try {
      const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      expect(code,stderr).toBe(0);expect(stderr).not.toContain("Unhandled");expect(stdout+stderr).not.toContain("private-error-body-must-not-appear");
      expect(readdirSync(root,{recursive:true}).map(String).filter(p=>/\.(db|sqlite|sqlite3)(-wal|-shm)?$/.test(p))).toEqual([]);
      return JSON.parse(stdout.split("\n").find(line=>line.startsWith('{'))!);
    } finally {clearTimeout(timer);}
  } finally {rmSync(root,{recursive:true,force:true});}
}
for(const mode of ["send","failure-draft","failure-restore"] as const)test(`actual slow API ${mode}: single Enter flight and preserved draft`,async()=>{
  const result=await scenario(mode);expect(result.pendingPosts).toBe(1);expect(result.beforeRetry).toBe(1);expect(result.contents).toEqual(["first draft",mode==="failure-restore"?"first draft":"next draft"]);
  if(mode.startsWith("failure"))expect(result.screen).toContain("Check the conversation before retrying");
},12000);
test("read failures render an error without raw bodies or a false empty conversation",async()=>{
  const result=await scenario("read");expect(result.screen).toContain("Unable to");expect(result.screen).not.toContain("No messages yet");expect(result.screen).toContain("fixture preview");
},12000);
test("exact-detail and mark-read failures stay handled in the actual input path",async()=>{
  const result=await scenario("detail");expect(result.details).toBe(1);expect(result.marks).toBe(1);expect(result.screen).toContain("Unable to mark message read");
},12000);

test("an empty mark-read receipt does not claim the message was acknowledged",async()=>{
  const result=await scenario("mark-zero");expect(result.marks).toBe(1);expect(result.screen).toContain("Read acknowledgement was not confirmed");
},12000);

test("a draft sent after the first DM response uses its confirmed session",async()=>{
  const result=await scenario("new-dm");expect(result.contents).toEqual(["first draft","next draft"]);expect(result.sessions).toEqual([null,"fixture-dm-session"]);
},12000);
