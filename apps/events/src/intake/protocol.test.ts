import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { canonicalJson, envelopeHash, prepareIntake, validateEnvelope, validateRequest, validateReceipt } from "./protocol.js";
import type { EventEnvelope } from "../types.js";

const binding={sink_id:randomUUID(),producer_id:randomUUID(),corpus_id:randomUUID(),source_authority_id:randomUUID()};
const envelope=():EventEnvelope=>({id:"event:1",dedupeKey:"key:1",source:"conversations",type:"conversations.message.created",time:"2026-09-08T00:00:00.000Z",severity:"info",schemaVersion:"1.0",data:{preview:"synthetic\nmessage"},metadata:{app_event:{action:"created"}}});

test("canonical bytes sort object keys recursively, preserve arrays and support existing app_event metadata",()=>{
  expect(canonicalJson({z:[{z:1,a:2},3],a:"é"})).toBe('{"a":"é","z":[{"a":2,"z":1},3]}');
  const r=prepareIntake(binding,envelope());expect(validateRequest(r)).toEqual(r);expect(validateEnvelope(r.envelope_json)).toEqual(envelope());
  expect(r.envelope_sha256).toBe(envelopeHash(r.envelope_json));
});
test("duplicate keys and noncanonical whitespace/numbers cannot masquerade as an exact byte proof",()=>{
  const good=prepareIntake(binding,envelope());
  for(const text of [` ${good.envelope_json}`,good.envelope_json.replace('"data":','"data":{},"data":'),good.envelope_json.replace('"data":{','"data":{"n":1.0,')])expect(()=>validateEnvelope(text)).toThrow("noncanonical");
  expect(()=>validateRequest({...good,event_id:"other"})).toThrow("identity");
  expect(()=>validateRequest({...good,envelope_sha256:"0".repeat(64)})).toThrow("hash");
});
test("cyclic, non-JSON, invalid Unicode, deep, oversized and accessor values fail without evaluating accessors",()=>{
  const cycle:Record<string,unknown>={};cycle.self=cycle;
  const getter=Object.defineProperty({},"secret",{enumerable:true,get(){throw new Error("getter must never run");}});
  const array=Object.defineProperty([1],"0",{get(){throw new Error("getter must never run");}});
  for(const value of [cycle,undefined,NaN,Infinity,1n,new Date(),{value:undefined},"\ud800",getter,array,Array(2),{x:"x".repeat(262145)}])expect(()=>canonicalJson(value)).toThrow();
  let deep:unknown=null;for(let i=0;i<40;i++)deep={deep};expect(()=>canonicalJson(deep)).toThrow("complexity");
});
test("sensitive fields are refused, never silently rewritten after a hash has been frozen",()=>{
  for(const data of [{password:"synthetic"},{nested:{api_key:"synthetic"}},{authorization:"synthetic"}])expect(()=>prepareIntake(binding,{...envelope(),data})).toThrow("sensitive");
  const safe=prepareIntake(binding,{...envelope(),data:{password:"[REDACTED]"}});expect(validateEnvelope(safe.envelope_json).data).toEqual({password:"[REDACTED]"});
});
test("a receipt must prove every frozen identity and durable completion, with no payload fields",()=>{
  const request=prepareIntake(binding,envelope());const {envelope_json:_,encoding:__,...proof}=request;
  const receipt={...proof,tenant_id:"tenant-a",receipt_id:randomUUID(),accepted_at:"2026-09-08T00:00:00.000Z",status:"accepted_durable" as const};
  expect(validateReceipt(receipt,request,"tenant-a")).toEqual(receipt);
  for(const patch of [{status:"queued"},{tenant_id:"tenant-b"},{event_id:"other"},{dedupe_key:"other"},{sink_id:randomUUID()},{envelope_sha256:"0".repeat(64)},{envelope_json:"payload"}])expect(()=>validateReceipt({...receipt,...patch},request,"tenant-a")).toThrow();
});
