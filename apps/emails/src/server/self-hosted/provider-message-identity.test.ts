import {expect,test} from "bun:test";
import {sesMessageIdentityResolver,readResendMessageIdentity} from "./provider-message-identity.js";
const evidence={domain:"mail.example.com",evidence_sha256:"a".repeat(64),verified_at:"2026-09-14T00:00:00Z"};
test("SES never guesses a domain; explicit mapping binds exact region and evidence",()=>{
 expect(sesMessageIdentityResolver({},"us-east-1")("opaque-id")).toBeNull();
 const env={EMAILS_SES_MESSAGE_ID_DOMAINS:JSON.stringify({"us-east-1":evidence})};
 expect(sesMessageIdentityResolver(env,"us-east-2")("opaque-id")).toBeNull();
 expect(sesMessageIdentityResolver(env,null)("opaque-id")).toBeNull();
 expect(sesMessageIdentityResolver(env,"us-east-1")("opaque-id")).toMatchObject({messageId:"<opaque-id@mail.example.com>",provenance:{source:"configured-ses-region-domain",region:"us-east-1",evidenceSha256:"a".repeat(64)}});
 for(const id of ["<a@b>","a\r\nBcc: x@y","a".repeat(256)])expect(sesMessageIdentityResolver(env,"us-east-1")(id)).toBeNull();
});
test("malformed/unsupported configured mappings fail at startup",()=>{
 for(const value of ["", "null", "[]", "x".repeat(8193),JSON.stringify({"us-east-1":"mail.example.com"}),JSON.stringify({"us-east-1":{...evidence,evidence_sha256:""}}),JSON.stringify({"us-east-1":{...evidence,domain:"a\r\nBcc:b"}}),JSON.stringify({"us-east-1":{...evidence,extra:true}})])expect(()=>sesMessageIdentityResolver({EMAILS_SES_MESSAGE_ID_DOMAINS:value},"us-east-1")).toThrow("EMAILS_SES_MESSAGE_ID_DOMAINS");
});
test("Resend reads actual RFC identity with no send; mismatches and opaque values are not identities",async()=>{
 const calls:any[]=[];
 for(const [payload,expected] of [[{id:"provider-id",message_id:"<actual@example.com>"},"<actual@example.com>"],[{id:"other",message_id:"<actual@example.com>"},null],[{id:"provider-id",message_id:"opaque"},null]] as const){
 const result=await readResendMessageIdentity("provider-id","fixture",AbortSignal.timeout(1000),(async(url,init)=>{calls.push({url,method:init?.method??"GET",redirect:init?.redirect});return new Response(JSON.stringify(payload));}) as typeof fetch);
 expect(result?.messageId??null).toBe(expected);
 }
 expect(calls.every(c=>c.method==="GET"&&c.redirect==="error"&&c.url==="https://api.resend.com/emails/provider-id")).toBe(true);
 await expect(readResendMessageIdentity("provider-id","fixture",AbortSignal.timeout(1000),(async()=>new Response("x".repeat(1024*1024+1))) as typeof fetch)).rejects.toThrow("bound");
});
