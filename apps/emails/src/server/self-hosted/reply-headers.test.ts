import {expect, test} from "bun:test";
import {projectSelfHostedErrorBody,parseSelfHostedErrorJson} from "../../lib/self-hosted-wire.js";
import {mintApiKey, verifyApiKey} from "@hasna/contracts/auth";
import {handleSelfHostedRequest, type SelfHostedServiceDeps} from "./service.js";
import {selfScopedStore,testAuthDeps} from "./auth/test-support.js";
import type {TypedQueryClient} from "../../storage-kit/index.js";
const secret=crypto.randomUUID();
function fixture() {
 const client={query:async()=>({rows:[],rowCount:0}),many:async()=>[],get:async()=>null,one:async()=>({}),execute:async()=>{}} as TypedQueryClient;
 const store=selfScopedStore(client); const reserved:any[]=[],queued:any[]=[],sent:any[]=[];
 let parent:any={id:"parent",direction:"inbound",from_addr:"external@example.com",to_addrs:["me@example.com"],cc_addrs:[],subject:"Topic",message_id:"<parent@example.net>",in_reply_to:null,headers:{References:"<root@example.net>"}};
 let record:any;
 Object.assign(store,{getMessage:async(id:string)=>id==="parent"?parent:null,reserveSendIntent:async(input:any)=>{reserved.push(input);record={...input,id:"reply",status:"pending",send_state:"pending",headers:input.headers??{},attachments:[]};return {record,created:true};},claimSendIntent:async()=>({...record,send_state:"sending"}),completeSendIntent:async()=>({...record,send_state:"sent",status:"sent",provider_message_id:"opaque"}),evaluateOutboundPolicy:async()=>({allowed:true}),getAddressByEmail:async()=>({display_name:"Sender Name"}),enqueueScheduled:async(input:any)=>{queued.push(input);return{id:"job",status:"pending",scheduled_at:input.scheduledAt,created:true};}});
 const sender={provider:"ses",send:async(input:any)=>{sent.push(input);return "opaque";}};
 const deps={client,store,sender,verifier:verifyApiKey({app:"emails",signingSecret:secret,keyStatus:async()=>"active"}),migrations:[],version:"fixture",...testAuthDeps(client,secret)} as SelfHostedServiceDeps;
 async function send(extra:any={},enqueue=false) {return (await handleSelfHostedRequest(deps,new Request(`http://fixture/v1/${enqueue?"scheduled/enqueue":"messages/send"}`,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":mintApiKey({app:"emails",scopes:["emails:*"],signingSecret:secret}).token},body:JSON.stringify({from:"me@example.com",to:["external@example.com"],subject:"Re: Topic",text:"Reply",idempotency_key:crypto.randomUUID(),reply_to_message_id:"parent",...(enqueue?{scheduled_at:new Date(Date.now()+3600000).toISOString()}:{}),...extra})})))!;}
 return {deps,store,sender,reserved,queued,sent,send,setParent:(value:any)=>parent=value,parent:()=>parent};
}
test("API derives RFC headers before provider delivery and preserves configured From and explicit Reply-To",async()=>{
 const f=fixture(),response=await f.send({reply_to:'"Reply, Desk" <desk@example.com>',headers:{"X-Campaign":"fixture"}});
 expect(response.status).toBe(202);
 expect(f.sent).toHaveLength(1);
 expect(f.sent[0]).toMatchObject({from:'"Sender Name" <me@example.com>',reply_to:'"Reply, Desk" <desk@example.com>',headers:{"x-campaign":"fixture","In-Reply-To":"<parent@example.net>",References:"<root@example.net> <parent@example.net>"}});
 expect(f.reserved[0]).toMatchObject({from_addr:"me@example.com",in_reply_to:"<parent@example.net>"});
});
test("all parent failures refuse before intent, queue or provider effects",async()=>{
 for(const enqueue of [false,true]) for(const [patch,parentPatch,status] of [[{reply_to_message_id:"foreign"},null,404],[{from:"stranger@example.com"},null,403],[{subject:"Different"},null,400],[{}, {message_id:null},409],[{reply_to:"bad\r\nBcc: hidden@example.com"},null,400],[{headers:{"In-Reply-To":"<forged@example.com>"}},null,400]] as const) {
 const f=fixture();if(parentPatch)f.setParent({...f.parent(),...parentPatch});
 const response=await f.send(patch,enqueue);expect(response.status).toBe(status);expect(f.reserved).toHaveLength(0);expect(f.queued).toHaveLength(0);expect(f.sent).toHaveLength(0);
 }
});
test("scheduled reply persists typed parent and recalculates trusted headers at execution",async()=>{
 const f=fixture(),response=await f.send({},true);
 expect(response.status).toBe(201);expect(f.queued[0].payload.reply_to_message_id).toBe("parent");expect(f.queued[0].payload.headers).toBeUndefined();expect(f.sent).toHaveLength(0);
 const {runScheduledBatch}=await import("./scheduler.js");
 let body:any;
 await runScheduledBatch({claimDueScheduled:async()=>[{id:"job",execution_lease:"lease",from_address:"me@example.com",to_addresses:["external@example.com"],subject:"Re: Topic",text_body:"Reply",send_options:{reply_to_message_id:"parent"}}],getScheduledTemplate:async()=>null,finishScheduled:async()=>true},async(payload)=>{body=payload;return new Response(JSON.stringify({sent:true,message:{id:"reply",send_state:"sent"}}),{status:202});});
 expect(body.reply_to_message_id).toBe("parent");
});

test("sent-parent replies resolve the parent's provider identity once and preserve its provenance",async()=>{
 const f=fixture();let reads=0;const observations:any[]=[];
 f.setParent({...f.parent(),direction:"outbound",from_addr:"me@example.com",to_addrs:["external@example.com"],message_id:null,provider_id:"self-hosted-ses",provider_message_id:"opaque-parent",send_state:"sent"});
 Object.assign(f.sender,{readMessageIdentity:async(id:string)=>{reads++;expect(id).toBe("opaque-parent");return{messageId:"<actual@example.net>",provenance:{source:"resend-retrieval"}};}});
 Object.assign(f.store,{recordProviderMessageIdentity:async(id:string,providerId:string,senderProviderId:string,identity:any)=>{observations.push({id,providerId,senderProviderId,identity});return{...f.parent(),message_id:identity.messageId,headers:{...f.parent().headers,"message-id":identity.messageId}};}});
 expect((await f.send()).status).toBe(202);expect(reads).toBe(1);expect(observations).toHaveLength(1);expect(f.sent[0].headers["In-Reply-To"]).toBe("<actual@example.net>");
});
test("wrong provider binding, refused provider identity and concurrent parent drift cannot send",async()=>{
 for(const kind of ["wrong-provider","unavailable","concurrent"]){
 const f=fixture();let reads=0;f.setParent({...f.parent(),direction:"outbound",from_addr:"me@example.com",to_addrs:["external@example.com"],message_id:null,provider_id:kind==="wrong-provider"?"other-provider":"self-hosted-ses",provider_message_id:"opaque-parent",send_state:"sent"});
 Object.assign(f.sender,{readMessageIdentity:async()=>{reads++;return kind==="unavailable"?null:{messageId:"<actual@example.net>",provenance:{source:"resend-retrieval"}};}});
 Object.assign(f.store,{recordProviderMessageIdentity:async()=>({...f.parent(),message_id:"<concurrent@example.net>"})});
 expect((await f.send()).status).toBe(409);expect(f.sent).toHaveLength(0);expect(f.reserved).toHaveLength(0);expect(reads).toBe(kind==="wrong-provider"?0:1);
 }
});

test("parent refusals satisfy the typed SDK error contract without write effects",async()=>{
 for(const enqueue of [false,true]) for(const missing of [true,false]) {
  const f=fixture();if(!missing)f.setParent({...f.parent(),message_id:null});
  const response=await f.send(missing?{reply_to_message_id:"missing"}:{},enqueue);
  const path=enqueue?"/v1/scheduled/enqueue":"/v1/messages/send", status=response.status;
  expect(status).toBe(missing?404:409);
  const body=parseSelfHostedErrorJson(await response.text(),{method:"POST",path,status});
  expect(() => projectSelfHostedErrorBody("POST",path,status,body)).not.toThrow();
  expect(body).toMatchObject({sent:false,retry_safe:true});
  expect(f.reserved).toHaveLength(0);expect(f.queued).toHaveLength(0);expect(f.sent).toHaveLength(0);
 }
});
