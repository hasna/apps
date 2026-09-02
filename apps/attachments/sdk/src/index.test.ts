import { describe, expect, test } from "bun:test";
import { AttachmentsApiClient, ApiError } from "./index";
const baseUrl = "https://attachments.example.test";
const actions: Array<[string, string, (c: AttachmentsApiClient) => Promise<unknown>]> = [
  ["GET", "/health", c => c.getHealth()],
  ["GET", "/ready", c => c.getReady()],
  ["GET", "/version", c => c.getVersion()],
  ["GET", "/v1/attachments?limit=4&tag=task%3Ax&expired=true", c => c.listAttachments({ limit: 4, tag: "task:x", expired: true })],
  ["POST", "/v1/attachments", c => c.createAttachment({ filename: "test.txt", content_base64: "dGVzdA==" })],
  ["GET", "/v1/attachments/a%2Fb", c => c.getAttachment("a/b")],
  ["DELETE", "/v1/attachments/a%2Fb", c => c.deleteAttachment("a/b")],
  ["GET", "/v1/attachments/a%2Fb/link", c => c.getAttachmentLink("a/b")],
  ["POST", "/v1/attachments/a%2Fb/link", c => c.regenerateAttachmentLink("a/b", { expiry: "1h" })],
  ["POST", "/v1/attachments/presign-upload", c => c.presignAttachmentUpload({ filename: "test.txt" })],
  ["POST", "/v1/attachments/a%2Fb/presign-upload/complete", c => c.completePresignedAttachmentUpload("a/b", { expiry: "1h" })],
  ["GET", "/v1/slugs/a%2Fb", c => c.getFriendlySlugAvailability("a/b")],
];
describe("Generated /v1 SDK replaces retired /api client", () => {
  for (const [method, path, action] of actions) test(method + " " + path, async () => {
    let calls = 0;
    const client = new AttachmentsApiClient({ baseUrl, apiKey: "fixture-key", fetch: (async (url, init) => {
      calls++; expect(String(url)).toBe(baseUrl + path); expect(init?.method).toBe(method);
      expect(new Headers(init?.headers).get("x-api-key")).toBe("fixture-key"); expect(init?.redirect).toBe("error");
      if (method === "POST") expect(init?.body).toBeDefined();
      return Response.json({ ok: true });
    }) as typeof fetch });
    expect(await action(client)).toEqual({ ok: true }); expect(calls).toBe(1);
  });
  for (const status of [301, 302, 303, 307, 308, 400, 401, 403, 500]) test("HTTP " + status + " never replays or exposes response secrets", async () => {
    let calls = 0, reads = 0;
    const client = new AttachmentsApiClient({ baseUrl, apiKey: "fixture-key", fetch: (async () => {
      calls++; const response = new Response("fixture-key", { status }); response.text = async () => { reads++; return "fixture-key"; }; return response;
    }) as typeof fetch });
    const error = await client.createAttachment({ filename: "a", content_base64: "" }).catch(e => e);
    expect(error).toBeInstanceOf(ApiError); expect(String(error)).not.toContain("fixture-key"); expect(error.body).toBeUndefined(); expect(calls).toBe(1); expect(reads).toBe(0);
  });
  for (const url of ["", "http://localhost:3", "https://user:pass@example.test", "https://example.test?secret=1", "https://example.test#x"]) test("invalid base URL fails before dispatch: " + url, () => {
    expect(() => new AttachmentsApiClient({ baseUrl: url, apiKey: "fixture-key" })).toThrow();
  });
  for (const key of ["", " ", "one two", "\nkey"]) test("invalid API key fails closed", () => {
    expect(() => new AttachmentsApiClient({ baseUrl, apiKey: key })).toThrow();
  });
  test("same-authority key rotation works; changed authority fails without dispatch", async () => {
    const keys: string[] = [];
    const options = { baseUrl, apiKey: "first", fetch: (async (_url, init) => { keys.push(new Headers(init?.headers).get("x-api-key")!); return Response.json([]); }) as typeof fetch };
    const client = new AttachmentsApiClient(options);
    await client.listAttachments(); options.apiKey = "second"; await client.listAttachments();
    options.baseUrl = "https://other.example.test"; await expect(client.listAttachments()).rejects.toThrow("authority");
    expect(keys).toEqual(["first", "second"]); expect(JSON.stringify(client)).not.toContain("second");
  });
  test("authorization overrides reject and cannot disable redirect protection", async () => {
    const client = new AttachmentsApiClient({ baseUrl, apiKey: "fixture-key", fetch: (async (_url, init) => { expect(init?.redirect).toBe("error"); return Response.json([]); }) as typeof fetch });
    await expect(client.listAttachments(undefined, { headers: { Authorization: "override" } })).rejects.toThrow("overrides");
    await client.listAttachments(undefined, { redirect: "follow" });
  });
});
