import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CloudflareWorkers, CloudflareWorkersApiError } from "../index";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

function mockJsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function client() {
  return new CloudflareWorkers({
    apiToken: "token-123",
    accountId: "account-123",
  });
}

beforeEach(() => {
  fetchMock = mock(async () =>
    mockJsonResponse({ success: true, result: { ok: true } })
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CloudflareWorkers", () => {
  test("lists scripts with account path, auth header, and query params", async () => {
    const api = client();

    await api.listScripts({ per_page: 25, tag: ["edge", "prod"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-123/workers/scripts?per_page=25&tag=edge&tag=prod"
    );
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-123"
    );
  });

  test("uploads a script as multipart form data", async () => {
    const api = client();

    await api.uploadScript("hello-worker", "export default {}", {
      metadata: { main_module: "worker.js", compatibility_date: "2026-01-01" },
      filename: "worker.js",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-123/workers/scripts/hello-worker"
    );
    expect(init.method).toBe("PUT");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(Array.from(form.keys())).toEqual(["metadata", "worker.js"]);
    expect(form.get("worker.js")).toBeInstanceOf(Blob);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  test("uses Workers resource endpoint for Worker resources and versions", async () => {
    const api = client();

    await api.createBetaWorker({ name: "payment-service" });
    await api.createBetaVersion("worker-id", {
      main_module: "worker.js",
      compatibility_date: "2026-01-01",
    });

    const calls = fetchMock.mock.calls as [
      string,
      RequestInit,
    ][];
    expect(calls[0][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-123/workers/workers"
    );
    expect(calls[1][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-123/workers/workers/worker-id/versions"
    );
  });

  test("allows scoped raw Workers API paths and rejects traversal", async () => {
    const api = client();

    await api.rawRequest(
      "GET",
      "/accounts/account-123/workers/scripts/hello-worker/deployments"
    );
    await api.rawRequest(
      "GET",
      "/accounts/account-123/workers/workers/worker-id/versions"
    );

    const [url] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-123/workers/scripts/hello-worker/deployments"
    );
    const [workerVersionsUrl] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(workerVersionsUrl).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-123/workers/workers/worker-id/versions"
    );

    expect(() =>
      api.rawRequest("GET", "/accounts/account-123/workers/scripts/../tokens")
    ).toThrow(CloudflareWorkersApiError);
  });

  test("surfaces Cloudflare API error messages", async () => {
    fetchMock = mock(async () =>
      mockJsonResponse(
        { success: false, errors: [{ message: "missing permission" }] },
        { status: 403 }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(client().listScripts()).rejects.toThrow(
      "Cloudflare Workers: missing permission"
    );
  });

  test("requires token and account ID before sending account-scoped requests", async () => {
    const api = new CloudflareWorkers({ apiToken: "", accountId: "" });

    expect(() => api.listScripts()).toThrow(
      "Cloudflare Workers accountId is required"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
