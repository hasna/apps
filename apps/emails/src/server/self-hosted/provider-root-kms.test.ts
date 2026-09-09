import {expect,test} from "bun:test";
import {randomBytes} from "node:crypto";
import {buildProviderRootKms} from "./provider-root-kms.js";
import {openProviderBytes,sealProviderBytes,providerSecretAad} from "./managed-provider-crypto.js";
test("KMS uses deployment key and exact opaque tenant context; clears response key buffers and closes clients",async()=>{
 const calls:any[]=[];let closed=0;const retained=randomBytes(32),copy=Buffer.from(retained);
 const kms=buildProviderRootKms({EMAILS_PROVIDER_KMS_KEY_ID:"alias/provider-fixture",EMAILS_PROVIDER_KMS_REGION:"us-east-1"},()=>({send:async command=>{calls.push(command.input);return{Plaintext:retained,CiphertextBlob:Buffer.from("encrypted-fixture")};},destroy:()=>{closed++;}}))!;
 const context={app:"emails" as const,tenant:"tenant-fixture",root:"root-fixture",purpose:"provider-root" as const};
 const generated=await kms.generate(context,AbortSignal.timeout(1000));expect(generated.plaintext).toEqual(copy);expect(retained.every(byte=>byte===0)).toBe(true);expect(closed).toBe(1);
 expect(calls[0]).toEqual({KeyId:"alias/provider-fixture",KeySpec:"AES_256",EncryptionContext:context});
 await kms.decrypt(generated.ciphertext,context,AbortSignal.timeout(1000));expect(calls[1]).toMatchObject({KeyId:"alias/provider-fixture",EncryptionAlgorithm:"SYMMETRIC_DEFAULT",EncryptionContext:context});expect(closed).toBe(2);
});
test("KMS failures expose no raw exception and configuration cannot silently fall back",async()=>{
 expect(buildProviderRootKms({})).toBeUndefined();expect(()=>buildProviderRootKms({EMAILS_PROVIDER_KMS_KEY_ID:"alias/fixture"})).toThrow("together");let closed=0;
 const kms=buildProviderRootKms({EMAILS_PROVIDER_KMS_KEY_ID:"alias/fixture",EMAILS_PROVIDER_KMS_REGION:"us-east-1"},()=>({send:async()=>{throw Error("private exception material");},destroy:()=>{closed++;}}))!;
 await expect(kms.generate({app:"emails",tenant:"t",root:"r",purpose:"provider-root"},AbortSignal.timeout(1000))).rejects.toThrow("KMS generation failed");expect(closed).toBe(1);
});
test("AEAD rejects tenant/provider/revision/purpose substitution and altered ciphertext",()=>{
 const key=randomBytes(32),aad=providerSecretAad("tenant","provider",1,"payload"),value=sealProviderBytes(Buffer.from("fixture"),key,aad);
 expect(openProviderBytes(value,key,aad).toString()).toBe("fixture");
 for(const wrong of [providerSecretAad("other","provider",1,"payload"),providerSecretAad("tenant","other",1,"payload"),providerSecretAad("tenant","provider",2,"payload"),providerSecretAad("tenant","provider",1,"dek")])expect(()=>openProviderBytes(value,key,wrong)).toThrow();
 expect(()=>openProviderBytes({...value,ciphertext:Buffer.from("changed").toString("base64")},key,aad)).toThrow();
});
test("malformed lifecycle identity and revision fail before any database or KMS action",async()=>{
 const {ManagedProviderSecrets}=await import("./managed-provider-secrets.js");let calls=0;
 const backend=new ManagedProviderSecrets({transaction:async()=>{calls++;throw Error("must not touch database");}} as any,"tenant",{} as any);
 await expect(backend.begin("rotate-root","-".repeat(36),"fixture")).rejects.toThrow("UUID");
 await expect(backend.install("provider",{type:"resend",api_key:"synthetic"},-1,"fixture")).rejects.toThrow("revision");
 await expect(backend.begin("rotate-root",crypto.randomUUID(),"\nprivate")).rejects.toThrow("actor");expect(calls).toBe(0);
});
