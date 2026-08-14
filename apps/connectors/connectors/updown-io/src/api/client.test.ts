import { afterEach, describe, expect, mock, test } from "bun:test";
import { UpdownIo } from "./index";
import { UpdownIoClient, encodePathToken } from "./client";

const realFetch = globalThis.fetch;

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("UpdownIoClient", () => {
  test("throws when apiKey is missing", () => {
    expect(() => new UpdownIoClient({ apiKey: "" })).toThrow("updown.io apiKey is required");
  });

  test("sends X-API-KEY header on authenticated requests", async () => {
    globalThis.fetch = mock(() => Promise.resolve(mockJsonResponse([])));
    const client = new UpdownIoClient({ apiKey: "secret-key" });
    await client.request("/checks");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("secret-key");
  });

  test("returns empty object for 204 responses", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 204,
        statusText: "No Content",
        headers: new Headers(),
        json: () => Promise.reject(new Error("no body")),
        text: () => Promise.resolve(""),
      } as Response),
    );
    const client = new UpdownIoClient({ apiKey: "key" });
    const result = await client.request<Record<string, never>>("/checks/token", { method: "DELETE" });
    expect(result).toEqual({});
  });

  test("omits empty optional query params", async () => {
    globalThis.fetch = mock(() => Promise.resolve(mockJsonResponse({ uptime: 100 })));
    const client = new UpdownIoClient({ apiKey: "key" });
    await client.request("/checks/tok/metrics", { params: { from: undefined, to: "", group: "time" } });
    const [url] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string];
    expect(url).toBe("https://updown.io/api/checks/tok/metrics?group=time");
  });

  test("encodePathToken encodes slashes and special characters", () => {
    expect(encodePathToken("a/b")).toBe("a%2Fb");
    expect(encodePathToken("tok+1")).toBe("tok%2B1");
  });
});

describe("UpdownIo API methods", () => {
  test("listChecks hits GET /checks", async () => {
    globalThis.fetch = mock(() => Promise.resolve(mockJsonResponse([{ token: "abc" }])));
    const api = new UpdownIo({ apiKey: "key" });
    const checks = await api.listChecks();
    expect(checks).toEqual([{ token: "abc" }]);
    const [url, init] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://updown.io/api/checks");
    expect(init.method).toBe("GET");
  });

  test("getCheck requires token and encodes path", async () => {
    const api = new UpdownIo({ apiKey: "key" });
    await expect(api.getCheck("")).rejects.toThrow("check token is required");
    globalThis.fetch = mock(() => Promise.resolve(mockJsonResponse({ token: "a/b" })));
    await api.getCheck("a/b", { metrics: true });
    const [url] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string];
    expect(url).toBe("https://updown.io/api/checks/a%2Fb?metrics=true");
  });

  test("listDowntimes hits downtimes endpoint with pagination", async () => {
    globalThis.fetch = mock(() => Promise.resolve(mockJsonResponse([])));
    const api = new UpdownIo({ apiKey: "key" });
    await api.listDowntimes("tok", { page: 2, results: true });
    const [url] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string];
    expect(url).toBe("https://updown.io/api/checks/tok/downtimes?page=2&results=true");
  });

  test("listMetrics passes from/to/group query params", async () => {
    globalThis.fetch = mock(() => Promise.resolve(mockJsonResponse({ uptime: 99.9 })));
    const api = new UpdownIo({ apiKey: "key" });
    await api.listMetrics("tok", { from: "2026-01-01", to: "2026-02-01", group: "host" });
    const [url] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string];
    expect(url).toContain("/checks/tok/metrics?");
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-02-01");
    expect(url).toContain("group=host");
  });

  test("listNodes does not require auth header", async () => {
    globalThis.fetch = mock(() => Promise.resolve(mockJsonResponse({ tok: { ip: "1.2.3.4" } })));
    const api = new UpdownIo({ apiKey: "key" });
    await api.listNodes();
    const [url, init] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://updown.io/api/nodes");
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBeUndefined();
  });

  test("listNodeIps defaults to json array endpoint", async () => {
    globalThis.fetch = mock(() => Promise.resolve(mockJsonResponse(["1.2.3.4"])));
    const api = new UpdownIo({ apiKey: "key" });
    const ips = await api.listNodeIps();
    expect(ips).toEqual(["1.2.3.4"]);
    const [url] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string];
    expect(url).toBe("https://updown.io/api/nodes/ips");
  });

  test("listNodeIps txt format requests plain text", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        json: () => Promise.reject(new Error("not json")),
        text: () => Promise.resolve("1.2.3.4\n5.6.7.8"),
      } as Response),
    );
    const api = new UpdownIo({ apiKey: "key" });
    const text = await api.listNodeIps("txt");
    expect(text).toBe("1.2.3.4\n5.6.7.8");
    const [url, init] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://updown.io/api/nodes/ips.txt");
    expect((init.headers as Record<string, string>).Accept).toBe("text/plain");
  });

  test("fromEnv requires UPDOWN_IO_API_KEY", () => {
    const prev = process.env.UPDOWN_IO_API_KEY;
    delete process.env.UPDOWN_IO_API_KEY;
    expect(() => UpdownIo.fromEnv()).toThrow("UPDOWN_IO_API_KEY is required");
    if (prev) process.env.UPDOWN_IO_API_KEY = prev;
  });
});
