import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { signSkillsAwsV4Request } from "./native-storage";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
// Public AWS documentation example credentials, never a live account.
// https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
const credentials = { accessKeyId: "example-access-key", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
const now = new Date("2013-05-24T00:00:00.000Z");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
// Independent oracle encodes UTF-8 bytes directly and uses bytewise ordering.
function awsBytes(value: string): string {
  return [...Buffer.from(value)].map(byte =>
    (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || (byte >= 48 && byte <= 57) || [45,46,95,126].includes(byte)
      ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2,"0")}`).join("");
}
function independent(url: URL, entries: Array<[string,string]>) {
  const pairs = entries.map(([key,value]) => [awsBytes(key),awsBytes(value)] as const);
  pairs.sort((a,b) => Buffer.compare(Buffer.from(a[0]),Buffer.from(b[0])) || Buffer.compare(Buffer.from(a[1]),Buffer.from(b[1])));
  const query = pairs.map(pair=>pair.join("=")).join("&"), payload = sha("");
  const canonical = ["GET", "/", query, `host:${url.host}\nx-amz-content-sha256:${payload}\nx-amz-date:20130524T000000Z\n`, "host;x-amz-content-sha256;x-amz-date",payload].join("\n");
  let key: Buffer = Buffer.from(`AWS4${credentials.secretAccessKey}`);
  for (const part of ["20130524","us-east-1","s3","aws4_request"]) key = createHmac("sha256",key).update(part).digest();
  const signature = createHmac("sha256",key).update(["AWS4-HMAC-SHA256","20130524T000000Z","20130524/us-east-1/s3/aws4_request",sha(canonical)].join("\n")).digest("hex");
  return { query, canonical, signature };
}
const sign = (url: string) => signSkillsAwsV4Request({ method:"GET",url,region:"us-east-1",service:"s3",credentials,now });
describe("AWS query canonicalization",()=>{
  test("matches AWS published ListObjects and empty-subresource signatures",()=>{
    expect(sign("https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2").headers.authorization).toEndWith("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
    expect(sign("https://examplebucket.s3.amazonaws.com/?lifecycle").headers.authorization).toEndWith("Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
  });
  for (const [name,entries] of [
    ["version listing accepts Unicode and AWS-reserved filename punctuation", [["versions",""],["encoding-type","url"],["max-keys","20"],["prefix","organizations/owned/runs/owned/inputs/café !'()*.txt"]]],
    ["sorts encoded keys by bytes instead of raw locale order", [["z","z"],["é","unicode"],["a","lower"],["Z","upper"],["!","reserved"],["_","underscore"],["~","tilde"]]],
    ["preserves duplicate keys and values while sorting encoded values", [["key","z"],["key","é"],["key","Z"],["key","!"],["key",""],["key","Z"],["","value"]]],
    ["distinguishes literal plus percent and ampersand from separators", [["prefix","space + % & = / 🧪"],["versionId","+/=!()'*"],["a+b","%2F"]]],
  ] as Array<[string,Array<[string,string]>]>) {
    test(name,()=>{
      const url=new URL("https://owned-fixture.s3.us-east-1.amazonaws.com/");for(const [key,value] of entries)url.searchParams.append(key,value);
      const expected=independent(url,entries), actual=sign(url.href);
      expect(actual.canonicalRequest).toBe(expected.canonical);
      expect(actual.canonicalRequest.split("\n")[2]).toBe(expected.query);
      expect(actual.headers.authorization).toEndWith(`Signature=${expected.signature}`);
      const reversed=new URL(url.origin);for(const [key,value] of [...entries].reverse())reversed.searchParams.append(key,value);
      expect(sign(reversed.href).headers.authorization).toBe(actual.headers.authorization);
      if(entries.some(([key])=>key==="key"))expect(expected.query.match(/key=Z/g)).toHaveLength(2);
    });
  }
  test("preserves empty values and distinguishes plus from encoded plus",()=>{
    expect(sign("https://owned-fixture.invalid/?prefix=a+b").headers.authorization).toBe(sign("https://owned-fixture.invalid/?prefix=a%20b").headers.authorization);
    expect(sign("https://owned-fixture.invalid/?prefix=a%2Bb").headers.authorization).not.toBe(sign("https://owned-fixture.invalid/?prefix=a+b").headers.authorization);
    expect(sign("https://owned-fixture.invalid/?acl&acl=").canonicalRequest.split("\n")[2]).toBe("acl=&acl=");
  });
});
