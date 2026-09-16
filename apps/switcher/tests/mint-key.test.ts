import { expect, test } from "bun:test";
import { mintSwitcherFleetKey } from "../src/mint-key";
const env={HASNA_SWITCHER_DATABASE_URL:"postgresql://fixture.invalid/switcher",HASNA_SWITCHER_API_SIGNING_KEY:"fixture-signing-secret-not-production-000",MINT_SECRET_ID:"hasna/oss/switcher/api-key"};
test("prebuilt fleet mint sends the token only to the bounded secret writer and logs metadata only",async()=>{
  const lines:string[]=[];let delivered="";
  const result=await mintSwitcherFleetKey({env,issueKey:async()=>({ok:true,stored:true,token:"fixture-client-token-never-log",kid:"kid-fixture",agent:"fleet",scopes:["switcher:read","switcher:write"],expiresAt:null}),putSecret:async request=>{delivered=request.token;},write:line=>lines.push(line)});
  expect(result).toEqual({kid:"kid-fixture",secretId:"hasna/oss/switcher/api-key"});expect(delivered).toBe("fixture-client-token-never-log");
  expect(lines).toHaveLength(1);expect(lines[0]).not.toContain(delivered);expect(JSON.parse(lines[0])).toMatchObject({event:"fleet-key-minted",kid:"kid-fixture"});
});
test("delivery failure revokes the exact issued key and never changes destination or scopes",async()=>{
  let revoked="",wrote=false;
  await expect(mintSwitcherFleetKey({env,issueKey:async request=>{expect(request.scopes).toBe("switcher:read,switcher:write");return {ok:true,stored:true,token:"fixture-undelivered-token",kid:"kid-undelivered"};},putSecret:async()=>{throw new Error("ambiguous network failure");},revoke:async request=>{revoked=request.kid;},write:()=>{wrote=true;}})).rejects.toThrow("Credential delivery failed; the issued key was revoked");
  expect(revoked).toBe("kid-undelivered");expect(wrote).toBe(false);
  await expect(mintSwitcherFleetKey({env:{...env,MINT_SECRET_ID:"hasna/oss/other/api-key"},issueKey:async()=>{throw new Error("must not issue");}})).rejects.toThrow("non-Switcher");
});
