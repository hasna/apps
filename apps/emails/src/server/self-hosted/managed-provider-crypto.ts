import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
export interface RootContext { app:"emails";tenant:string;root:string;purpose:"provider-root" }
export interface ProviderRootKms {
  generate(context:RootContext,signal:AbortSignal):Promise<{plaintext:Buffer;ciphertext:Buffer}>;
  decrypt(ciphertext:Buffer,context:RootContext,signal:AbortSignal):Promise<Buffer>;
}
export interface SealedBytes { ciphertext:string;iv:string;tag:string }
export interface ManagedProviderCredentials { type:"ses"|"resend"; api_key?:string; access_key?:string; secret_key?:string }
export function providerSecretAad(tenant:string,provider:string,revision:number,purpose:"payload"|"dek"):string {
 return JSON.stringify(["emails-provider-credentials",1,tenant,provider,revision,purpose]);
}
export function sealProviderBytes(value:Buffer,key:Buffer,aad:string):SealedBytes {
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(Buffer.from(aad));
 return{ciphertext:Buffer.concat([cipher.update(value),cipher.final()]).toString("base64"),iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64")};
}
export function openProviderBytes(value:SealedBytes,key:Buffer,aad:string):Buffer {
 const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(value.iv,"base64"));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(value.tag,"base64"));
 return Buffer.concat([decipher.update(Buffer.from(value.ciphertext,"base64")),decipher.final()]);
}
export function validateManagedProviderCredentials(input:unknown):ManagedProviderCredentials {
 if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Invalid provider credential payload");
 const value=input as Record<string,unknown>;const fields=value.type==="ses"?["type","access_key","secret_key"]:value.type==="resend"?["type","api_key"]:[];
 if(!fields.length||Object.keys(value).some(key=>!fields.includes(key))||fields.some(key=>typeof value[key]!=="string"||!String(value[key]).trim()||String(value[key]).length>16384||/[\x00-\x1f\x7f]/.test(String(value[key])))) throw new Error("Invalid provider credential fields");
 return Object.fromEntries(fields.map(key=>[key,String(value[key]).trim()])) as unknown as ManagedProviderCredentials;
}
