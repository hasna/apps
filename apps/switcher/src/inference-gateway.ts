import { proxyProviderStream } from "./provider-stream";
import { createProviderRequest, type ProviderRequestTiming } from "./provider-request";
import { isContextOverflow } from "./provider-error";
import { createHash, timingSafeEqual } from "node:crypto";
import { authHeader } from "./auth";
import { endpoint, Fault, modelExpired } from "./domain";
import type { HarnessLaunchInput } from "./harness-types";
import { injectModelGuidance, renderModelGuidance, resolvePolicyModel, type CompiledModelPolicy } from "./model-policy";

export type RoutingEvent = {at:string;requestId:string;requestedModel:string;resolvedModel?:string;reportedModel?:string;decision:"allow"|"alias"|"reject"|"fallback";reason?:string;upstreamStatus?:number};
type GatewayInput = HarnessLaunchInput & {compiledPolicy:CompiledModelPolicy;catalogPath:string;onRoutingEvent?:(event:RoutingEvent)=>void};
const routingFields = ["models", "fallbacks", "model_list", "deployment_id", "deployment", "router", "route", "extra_body", "plugins"];

/** A per-launch credential boundary: the native client never receives the provider key. */
export function createInferenceGateway(input: GatewayInput, timing: ProviderRequestTiming = {}) {
  const token=crypto.randomUUID()+crypto.randomUUID();
  const digest=(value:string)=>createHash("sha256").update(value).digest();
  const expected=digest(token), policy=input.compiledPolicy;
  const known=new Set(input.models.map(m=>m.id));
  const safeModel=(value:unknown)=>typeof value==="string" && value!==input.credential && (known.has(value)||Object.hasOwn(policy.aliases,value)) ? value : "<unrecognized>";
  const fail=(status:number,code:string)=>Response.json({error:{type:"switcher_model_policy",code,message:code==="model_not_allowed"?"This model is outside the launch policy. Select it with switcher launch --model or explicitly assign an allowed role model.":`Switcher inference gateway: ${code}.`}},{status});
  let closing=false,stopped:Promise<void>|undefined;
  const active=new Set<{abort:AbortController;done:Promise<void>;cancel?:()=>Promise<void>}>();
  const server=Bun.serve({hostname:"127.0.0.1",port:0,maxRequestBodySize:4*1024*1024,idleTimeout:255,async fetch(request, server) {
    if(closing)return fail(503,"closing");
    const credential=request.headers.get("x-goog-api-key")??request.headers.get("x-api-key")??request.headers.get("authorization")?.replace(/^Bearer /,"")??"";
    if(!timingSafeEqual(expected,digest(credential)))return fail(401,"unauthorized");
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/v1/models"&&!url.search)return Response.json({object:"list",data:input.models.filter(m=>!modelExpired(m)).map(m=>({...m,object:"model"}))});
    const gemini=input.protocol==="gemini-generate-content";
    const match=gemini?/^\/v1beta\/models\/([^/]+):(generateContent|streamGenerateContent|countTokens)$/.exec(url.pathname):null;
    const prefix=input.protocol==="anthropic-messages"?"/messages":input.protocol==="openai-responses"?"/responses":"/chat/completions";
    const suffix=url.pathname.slice(3);
    const supported=gemini?!!match:url.pathname.startsWith("/v1/")&&(url.pathname===`/v1${prefix}`||input.protocol==="anthropic-messages"&&suffix==="/messages/count_tokens"||input.protocol==="openai-responses"&&suffix==="/responses/compact");
    if(request.method!=="POST"||!supported)return fail(404,"unsupported_route");
    const betaQuery=input.protocol==="anthropic-messages" && [...url.searchParams.keys()].every(k=>k==="beta") && url.searchParams.getAll("beta").length===1 && url.searchParams.get("beta")==="true";
    if(gemini?([...url.searchParams.keys()].some(k=>k!=="alt")||url.searchParams.getAll("alt").length>1||url.searchParams.has("alt")&&url.searchParams.get("alt")!=="sse"):!!url.search&&!betaQuery)return fail(400,"unsupported_query");
    let body:any;
    try{body=await request.json();}catch{return fail(400,"invalid_json");}
    if(!body||typeof body!=="object"||Array.isArray(body))return fail(400,"invalid_request");
    let requested:unknown=body.model;
    if(gemini)try{requested=decodeURIComponent(match![1]);}catch{return fail(400,"invalid_model_path");}
    const requestId=crypto.randomUUID();
    const event:RoutingEvent={at:new Date().toISOString(),requestId,requestedModel:safeModel(requested),decision:"reject"};
    const emit=()=>input.onRoutingEvent?.(event);
    let resolved:string;
    try {
      for(const part of [body,...(gemini&&body.generateContentRequest?[body.generateContentRequest]:[])])if(routingFields.some(k=>Object.hasOwn(part,k)))throw new Fault(403,"routing_override","Unmanaged model routing is disabled.");
      if(typeof requested!=="string")throw new Fault(400,"model_required","A model is required.");
      resolved=resolvePolicyModel(policy,requested);
      if(input.models.some(model=>model.id===resolved&&modelExpired(model)))throw new Fault(422,"model_expired","Selected model has expired.");
      if(gemini)for(const declared of [body.model,body.generateContentRequest?.model])if(declared!==undefined&&declared!==requested&&declared!==`models/${requested}`)throw new Fault(403,"conflicting_model","Conflicting model identity.");
    } catch(error) {event.reason=error instanceof Fault?error.code:"invalid_model";emit();return fail(error instanceof Fault?error.status:400,event.reason);}
    event.resolvedModel=resolved;event.decision=resolved===requested?"allow":"alias";
    let current=event,response:Response|undefined;
    const emitted=new Set<RoutingEvent>();
    const flush=()=>{if(!emitted.has(current)){emitted.add(current);input.onRoutingEvent?.({...current});}};
    const abort=new AbortController();let complete!:()=>void;
    const record:{abort:AbortController;done:Promise<void>;cancel?:()=>Promise<void>}={abort,done:new Promise<void>(r=>complete=r)};
    const activity=createProviderRequest(request.signal,abort.signal,timing);
    const release=()=>{activity.finish();flush();active.delete(record);complete();};active.add(record);
    const signal=activity.fetchOptions.signal;
    server.timeout(request,0); // Authenticated inference is bounded by upstream activity.
    const headers:Record<string,string>={"content-type":"application/json"};
    if(input.credential){const [name,value]=gemini?["x-goog-api-key",input.credential]:authHeader(input.authStyle??"bearer",input.credential);headers[name]=value;}
    if(input.protocol==="anthropic-messages") {headers["anthropic-version"]=request.headers.get("anthropic-version")??"2023-06-01";if(request.headers.has("anthropic-beta"))headers["anthropic-beta"]=request.headers.get("anthropic-beta")!;}
    const candidates=[resolved,...(policy.fallbacks[resolved]??[])];
    try {
      if(candidates.some(model=>!known.has(model)||!policy.allowedModels.includes(model)))throw new Error("invalid_fallback_policy");
      for(let attempt=0;attempt<candidates.length;attempt++) {
        if(signal.aborted)throw new Error("aborted");
        const model=candidates[attempt];
        if(input.models.some(entry=>entry.id===model&&modelExpired(entry)))throw new Fault(422,"model_expired","Selected model has expired.");
        if(attempt){flush();current={at:new Date().toISOString(),requestId,requestedModel:safeModel(requested),resolvedModel:model,decision:"fallback",reason:"explicit_transient_fallback"};}
        const payload=structuredClone(body);
        if(gemini) {if(payload.model!==undefined)payload.model=`models/${model}`;if(payload.generateContentRequest?.model!==undefined)payload.generateContentRequest.model=`models/${model}`;}
        else payload.model=model;
        const guidance=renderModelGuidance({harness:input.harness,providerId:input.providerId,baseUrl:input.baseUrl,model,compiled:policy,catalogPath:input.catalogPath});
        const outgoing=injectModelGuidance(input.protocol,payload,guidance,match?.[2]);
        const path=gemini?`/models/${encodeURIComponent(model)}:${match![2]}${url.search}`:suffix+(betaQuery?"?beta=true":"");
        try {response=await activity.run(()=>fetch(endpoint(input.baseUrl)+path,{method:"POST",headers,body:JSON.stringify(outgoing),redirect:"manual",...activity.fetchOptions}));}
        catch {current.reason=activity.timedOut()?"provider_idle_timeout":signal.aborted?"request_cancelled":"network_error";if(!signal.aborted&&attempt+1<candidates.length)continue;throw new Error("provider_request_failed");}
        current.upstreamStatus=response.status;
        if((response.status===429||response.status>=500)&&attempt+1<candidates.length){void response.body?.cancel().catch(() => undefined);response=undefined;continue;}
        break;
      }
      if(!response)throw new Error("provider_request_failed");
      if(!response.ok){
        const overflow=await isContextOverflow(response);
        if(overflow)current.reason="context_length_exceeded";
        release();
        if(overflow)return Response.json({type:"error",error:{type:"invalid_request_error",code:"context_length_exceeded",message:"prompt is too long: the provider context window was exceeded. Compact the conversation or start a new session."}},{status:400});
        return fail(response.status>=300&&response.status<400?502:response.status,`upstream_http_${response.status}`);
      }
      if(!response.body){release();return new Response(null,{status:response.status});}
      const decoder=new TextDecoder();
      const sse=response.headers.get("content-type")?.includes("text/event-stream");
      let buffer="";
      const observe=(text:string)=>{try{const value=JSON.parse(text);const reported=value.model??value.message?.model??value.response?.model??value.modelVersion;if(typeof reported==="string"){current.reportedModel=safeModel(reported);if(reported!==current.resolvedModel)current.reason="provider_reported_different_model";}}catch{}};
      const inspect=(chunk:Uint8Array,done=false)=>{
        buffer+=decoder.decode(chunk,{stream:!done});
        if(sse){let end=buffer.indexOf("\n");while(end>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(line.startsWith("data:"))observe(line.slice(5).trim());end=buffer.indexOf("\n");}if(buffer.length>131072)buffer="";}
        else if(buffer.length>131072)buffer="";
        if(done&&buffer)observe(buffer);
      };
      const {stream,cancel}=proxyProviderStream({response,protocol:input.protocol,requestSignal:request.signal,abort,closing:()=>closing,release,activity,inspect,interrupted:reason=>{current.reason=reason;}});
      record.cancel=cancel;
      return new Response(stream,{status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/json","cache-control":"no-store"}});
    }catch(error) {if(error instanceof Fault)current.reason=error.code;else if(activity.timedOut())current.reason="provider_idle_timeout";release();return fail(error instanceof Fault?error.status:activity.timedOut()?504:502,error instanceof Fault?error.code:activity.timedOut()?"provider_idle_timeout":"provider_request_failed");}
  }});
  return {baseUrl:new URL(input.protocol==="gemini-generate-content"?"v1beta":"v1",server.url).href,token,cleanup:()=>stopped??=(async()=>{closing=true;const pending=[...active];for(const request of pending)request.abort.abort();await Promise.allSettled(pending.map(async request=>{await request.cancel?.();await request.done;}));await server.stop(true);})()};
}
