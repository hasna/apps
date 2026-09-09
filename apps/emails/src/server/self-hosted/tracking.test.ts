import {describe,it,expect} from "bun:test";
import {randomBytes} from "node:crypto";
import {readTrackingConfig,resolveTracking,renderTracking,openTrackingToken,serveTracking,type TrackingConfig} from "./tracking.js";
const tenant="00000000-0000-4000-8000-000000000001";
const config:TrackingConfig={activeKey:"one",keys:{one:randomBytes(32)},tenants:{[tenant]:["https://track.example"]},ttlSeconds:3600};
const options={track_opens:true,track_clicks:true,tracking_url:"https://track.example"};
describe("first-party tracking",()=>{
 it("handles HTML quoting/entities and preserves non-web/unsubscribe links",()=>{
  const original=`<body><a href='https://example.com/?a=1&amp;b=2'>one</a><a href=https://example.org/two>two</a><a href='mailto:a@example.com'>mail</a><a href='https://example.com/unsub'>leave</a><a rel=unsubscribe href=https://example.net/out>out</a></body>`;
  const doc=renderTracking(config,options,tenant,"message",{html:original,unsubscribe:"https://example.com/unsub"});
  expect(Object.values(doc.links)).toHaveLength(3);
  expect(Object.values(doc.links).map(x=>x.target)).toContain("https://example.com/?a=1&b=2");
  expect(doc.html).toContain("mailto:a@example.com"); expect(doc.html).toContain("https://example.com/unsub");
  expect(doc.html).not.toContain("href='https://example.com/?"); expect(doc.html).toContain('width="1"'); expect(original).not.toContain("/v1/tracking/");
 });
 it("keeps normalized unsubscribe destinations and enforces the link cap",()=>{
  const doc=renderTracking(config,options,tenant,"message",{html:'<a href="https://example.com/">leave</a>',unsubscribe:"https://example.com"});
  expect(Object.values(doc.links)).toHaveLength(1);
  expect(()=>renderTracking(config,options,tenant,"message",{html:'<a href="https://example.com">go</a>'.repeat(501)})).toThrow("500 links");
 });
 it("adds escaped HTML alternative for plain text and tracks HTTP links",()=>{
  const doc=renderTracking(config,options,tenant,"message",{text:'<script>alert(1)</script> https://example.com/path'});
  expect(doc.html).toContain("&lt;script&gt;");expect(Object.values(doc.links)).toHaveLength(2);
 });
 it("opaque capabilities reject tampering, unknown keys, wrong keys and expiry",()=>{
  const doc=renderTracking(config,options,tenant,"message",{html:"body"},10000), token=Object.values(doc.links)[0]!.token;
  expect(token).not.toContain(tenant);expect(openTrackingToken(config,token,11000)?.message).toBe("message");
  expect(openTrackingToken(config,token,doc.expires)).toBeNull();
  expect(openTrackingToken(config,token.slice(0,-3)+"abc",11000)).toBeNull();
  expect(openTrackingToken({...config,keys:{one:randomBytes(32)}},token,11000)).toBeNull();
  expect(openTrackingToken({...config,keys:{}},token,11000)).toBeNull();
  expect(openTrackingToken({...config,activeKey:"two",keys:{...config.keys,two:randomBytes(32)}},token,11000)?.tenant).toBe(tenant);
 });
 it("requires explicit configuration and rejects arbitrary custom bases and types",()=>{
  expect(resolveTracking({},tenant)).toBeUndefined();
  for(const body of [{track_opens:"true"},{track_clicks:null},{tracking_url:""},{tracking_url:"https://track.example"},{track_opens:true,tracking_url:"https://other.example"},{track_opens:true,tracking_url:"https://x:y@track.example"}]) expect(()=>resolveTracking(body,tenant,config)).toThrow();
  expect(()=>resolveTracking({track_opens:true},tenant)).toThrow("not configured");
  expect(resolveTracking({track_clicks:true},tenant,config)).toEqual({...options,track_opens:false});
  expect(()=>readTrackingConfig({EMAILS_TRACKING_CONFIG:'bad-sensitive-value'})).toThrow("EMAILS_TRACKING_CONFIG is invalid");
 });
 it("dispatches only to authenticated token tenant and emits no-referrer/no-store",async()=>{
  const doc=renderTracking(config,options,tenant,"message",{html:'<a href="https://example.com">go</a>'});
  const token=Object.values(doc.links).find(x=>x.kind==="clicked")!.token;
  let received="";
  const response=await serveTracking(config,token,t=>{received=t;return {observeTracking:async()=>({kind:"clicked",target:"https://example.com/"})} as any;});
  expect(received).toBe(tenant);expect(response.status).toBe(302);expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect((await serveTracking(config,"invalid",()=>{throw Error("must not query");})).status).toBe(404);
 });
});

it("public tracking route matches its binary and bodyless response contracts",async()=>{
 const {handleSelfHostedRequest}=await import("./service.js");
 const doc=renderTracking(config,options,tenant,"message",{html:"body"});
 const token=Object.values(doc.links)[0]!.token;
 const deps={tracking:config,store:{forTenant:()=>({observeTracking:async()=>({kind:"opened",target:null})})}} as any;
 const get=(value:string)=>handleSelfHostedRequest(deps,new Request(`https://track.example/v1/tracking/${value}`));
 const pixel=(await get(token))!;expect(pixel.status).toBe(200);expect(pixel.headers.get("Content-Type")).toBe("image/gif");expect(Buffer.from(await pixel.arrayBuffer()).subarray(0,6).toString()).toBe("GIF89a");
 const missing=(await get("invalid"))!;expect(missing.status).toBe(404);expect(await missing.text()).toBe("");expect(missing.headers.get("Content-Type")).toBeNull();
 deps.store.forTenant=()=>{throw new Error("private database detail");};
 const unavailable=(await get(token))!;expect(unavailable.status).toBe(503);expect(await unavailable.text()).toBe("");expect(unavailable.headers.get("Content-Type")).toBeNull();
});
