// Durable claim/replay/redaction behavior runs against real PostgreSQL and HTTP
// in events-intake-delivery.pg.test.ts, registered in the required no-skip gate.
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { drainServerEventOutbox } from "./events-outbox-pg.js";
import { resolveEventsIntake } from "./events-intake-client.js";

const source={tenant_id:randomUUID(),corpus_id:`cor_${randomUUID().replaceAll("-","")}`,authority_id:"authority:fixture.v1"};
test("invalid worker bounds reject before any authorization or database work",async()=>{
  let called=false;
  for(const limit of [0,-1,1.2,101,NaN,Infinity])
    await expect(drainServerEventOutbox({} as never,limit,{signal:new AbortController().signal,
      authorizeSource:async()=>{called=true;return source;}})).rejects.toThrow("invalid_events_drain_limit");
  expect(called).toBe(false);
});
test("an already stopped worker performs no authorization, database or intake work",async()=>{
  let called=false;
  await expect(drainServerEventOutbox({} as never,1,{signal:AbortSignal.abort(),
    authorizeSource:async()=>{called=true;return source;}})).rejects.toThrow();
  expect(called).toBe(false);
});
test("source identity incompatibility and missing binding return value-free configuration errors",()=>{
  const privateValue=`synthetic-${randomUUID()}`;
  expect(()=>resolveEventsIntake({...source,corpus_id:"invalid/identity"},{})).toThrow("events_source_identity_incompatible");
  try {
    resolveEventsIntake(source,{HASNA_CONVERSATIONS_EVENTS_SINK_ID:privateValue});
    throw new Error("unexpected configuration acceptance");
  }catch(error){
    expect(String(error)).toContain("events_intake_not_configured");
    expect(String(error)).not.toContain(privateValue);
  }
});
