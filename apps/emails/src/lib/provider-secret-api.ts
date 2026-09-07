import {resolveEmailsHostedTransport} from "./emails-credentials.js";
import {loadEmailsClientEnvSecret} from "./client-env.js";
export interface ProviderSecretStatus {
  source:string; complete:true; checked:boolean; activeKeyId:string|null; availableKeyIds:string[]; referencedKeyIds:string[]; managed_envelopes:number;
  capabilities:{status:boolean;rewrap:boolean;rotate_root:boolean;revoke_root:boolean}; lifecycle_requirement:string;
  default_sender:{type:string;credential_source:string;externally_managed:boolean}|null;
  providers:Array<{provider_id:string;name:string;type:string;active:boolean;configured:boolean;credential_source:string;externally_managed:boolean}>;
}
export type ProviderSecretOperation="rewrap"|"rotate-root"|"revoke-root";
export async function providerSecretApi(path:string,body?:unknown,options:{baseUrl?:string;credentials?:string[];fetchImpl?:typeof fetch}={}):Promise<Record<string,unknown>> {
  let {baseUrl,credentials}=options;
  if(!baseUrl||!credentials){loadEmailsClientEnvSecret(process.env);const transport=resolveEmailsHostedTransport(process.env);baseUrl=transport.baseUrl;credentials=[transport.credential,...(transport.credentialFallbacks??[]).map(x=>x.value)];}
  for(let index=0;index<credentials.length;index++){
    const response=await (options.fetchImpl??fetch)(`${baseUrl}/providers/secrets/${path}`,{method:body===undefined?"GET":"POST",headers:{Authorization:`Bearer ${credentials[index]}`,"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(15000),...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===401&&index<credentials.length-1){await response.body?.cancel().catch(()=>{});continue;}
    if(response.status===404||response.status===405){await response.body?.cancel().catch(()=>{});throw new Error("The Emails API needs an update to support server provider-secret management.");}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error(`Provider-secret API request failed (HTTP ${response.status}).`);}
    return await response.json() as Record<string,unknown>;
  }
  throw new Error("No Emails API credential is configured.");
}
export async function fetchProviderSecretStatus(options:Parameters<typeof providerSecretApi>[2]={}):Promise<ProviderSecretStatus>{
  const value=await providerSecretApi("status",undefined,options) as unknown as ProviderSecretStatus;
  if(value.complete!==true||value.checked!==false||typeof value.source!=="string"||!Array.isArray(value.providers)||!Array.isArray(value.availableKeyIds)||!Array.isArray(value.referencedKeyIds)||!value.capabilities||value.capabilities.status!==true||typeof value.managed_envelopes!=="number"||typeof value.lifecycle_requirement!=="string") throw new Error("The Emails API returned an invalid provider-secret status.");
  return value;
}
export function requireProviderSecretOperation(status:ProviderSecretStatus,operation:ProviderSecretOperation):void{
  const key=operation.replaceAll("-","_") as "rewrap"|"rotate_root"|"revoke_root";
  if(status.capabilities[key]!==true) throw new Error(status.lifecycle_requirement);
}
