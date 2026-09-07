import { afterEach, expect, test } from "bun:test";
import { readDomainConnection } from "./domain-connect-provider.js";
import type { Provider } from "../../types/index.js";
import { ResendAdapter } from "../../providers/resend.js";

test("Resend registration forwards cancellation to the actual adapter HTTP request", async () => {
  const controller = new AbortController();
  let observed: AbortSignal | undefined;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    options?: RequestInit,
  ) => {
    expect(String(input)).toBe("https://api.resend.com/domains");
    expect(options?.method).toBe("POST");
    expect(options?.redirect).toBe("error");
    expect(JSON.parse(String(options?.body))).toEqual({ name: "example.test" });
    observed = options?.signal ?? undefined;
    return await new Promise<Response>((_resolve, reject) => {
      if (observed?.aborted) reject(new Error("cancelled fixture"));
      else
        observed?.addEventListener(
          "abort",
          () => reject(new Error("cancelled fixture")),
          { once: true },
        );
    });
  }) as typeof fetch;
  const registration = new ResendAdapter(provider).addDomain(
    "example.test",
    controller.signal,
  );
  controller.abort();
  await expect(registration).rejects.toThrow("cancelled fixture");
  expect(observed).toBe(controller.signal);
});
const actualFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = actualFetch;
});
const provider = {
  type: "resend",
  api_key: "fixture-not-a-real-key",
} as Provider;
test("Resend discovery paginates, preserves MX priority and excludes inbound/tracking records", async () => {
  const paths: string[] = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    options?: RequestInit,
  ) => {
    expect(options?.redirect).toBe("error");
    const url = new URL(String(input));
    paths.push(url.pathname + url.search);
    if (url.pathname === "/domains")
      return Response.json(
        url.searchParams.has("after")
          ? { data: [{ id: "target", name: "example.test" }], has_more: false }
          : { data: [{ id: "first", name: "other.test" }], has_more: true },
      );
    return Response.json({
      id: "target",
      name: "example.test",
      status: "pending",
      records: [
        {
          record: "DKIM",
          type: "TXT",
          name: "selector._domainkey",
          value: "public-dkim-value",
          status: "pending",
        },
        {
          record: "SPF",
          type: "MX",
          name: "send",
          value: "feedback.example.test",
          priority: 10,
          status: "pending",
        },
        {
          record: "Receiving",
          type: "MX",
          name: "@",
          value: "inbound.example.test",
          priority: 10,
          status: "pending",
        },
        {
          record: "Tracking",
          type: "CNAME",
          name: "click",
          value: "tracking.example.test",
          status: "verified",
        },
      ],
    });
  }) as typeof fetch;
  const result = await readDomainConnection(
    provider,
    "example.test",
    AbortSignal.timeout(1000),
  );
  expect(result).toMatchObject({
    registered: true,
    verified_for_sending: false,
  });
  expect(result.dns_tasks).toHaveLength(2);
  expect(result.dns_tasks[1]).toMatchObject({
    name: "send.example.test",
    priority: 10,
  });
  expect(paths).toEqual([
    "/domains?limit=100",
    "/domains?limit=100&after=first",
    "/domains/target",
  ]);
});
test("provider errors and nonadvancing pagination never become a missing-domain signal", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { error: "PRIVATE_PROVIDER_DETAIL" },
      { status: 403 },
    )) as typeof fetch;
  await expect(
    readDomainConnection(provider, "example.test", AbortSignal.timeout(1000)),
  ).rejects.toThrow("read failed");
  globalThis.fetch = (async () =>
    Response.json({
      data: [{ id: "same", name: "other.test" }],
      has_more: true,
    })) as typeof fetch;
  await expect(
    readDomainConnection(provider, "example.test", AbortSignal.timeout(1000)),
  ).rejects.toThrow("did not advance");
});
test("SES domain reads use the actual binding helper and only authoritative not-found permits registration", async () => {
  const script = `import {mock} from "bun:test";let answer;const calls=[];const sdk=await import("@aws-sdk/client-sesv2");mock.module("@aws-sdk/client-sesv2",()=>({...sdk,SESv2Client:class{config={region:async()=>"eu-west-1"};async send(command,options){calls.push(options);if(answer instanceof Error)throw answer;return answer;}destroy(){}},GetEmailIdentityCommand:class{constructor(input){this.input=input;}}}));const {readDomainConnection}=await import(${JSON.stringify(new URL("./domain-connect-provider.ts", import.meta.url).pathname)});const provider={type:"ses"};const results=[];answer={IdentityType:"DOMAIN",VerifiedForSendingStatus:false,DkimAttributes:{Status:"PENDING",Tokens:["fixture"]},MailFromAttributes:{MailFromDomain:"send.example.test",MailFromDomainStatus:"PENDING"}};results.push(await readDomainConnection(provider,"example.test",AbortSignal.timeout(1000)));answer=Object.assign(new Error("missing"),{name:"NotFoundException"});results.push(await readDomainConnection(provider,"example.test",AbortSignal.timeout(1000)));answer=Object.assign(new Error("denied"),{name:"AccessDeniedException"});try{await readDomainConnection(provider,"example.test",AbortSignal.timeout(1000));results.push("unexpected");}catch{results.push("refused");}answer={};const {SESAdapter}=await import(${JSON.stringify(new URL("../../providers/ses.ts", import.meta.url).pathname)});const signal=AbortSignal.timeout(1000);await new SESAdapter(provider).addDomain("example.test",signal);results.push(calls.at(-1)?.abortSignal===signal);console.log(JSON.stringify(results));`;
  const child = Bun.spawnSync(
    [process.execPath, "--no-env-file", "-e", script],
    {
      cwd: new URL("../../../", import.meta.url).pathname,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(child.stderr.toString()).toBe("");
  expect(child.exitCode).toBe(0);
  const results = JSON.parse(child.stdout.toString());
  expect(results[0]).toMatchObject({
    registered: true,
    verified_for_sending: false,
  });
  expect(results[0].dns_tasks).toHaveLength(3);
  expect(results[0].dns_tasks[1]).toMatchObject({
    type: "MX",
    priority: 10,
    name: "send.example.test",
    value: "feedback-smtp.eu-west-1.amazonses.com",
  });
  expect(results[1]).toEqual({
    registered: false,
    verified_for_sending: false,
    dns_tasks: [],
  });
  expect(results[2]).toBe("refused");
  expect(results[3]).toBe(true);
});
