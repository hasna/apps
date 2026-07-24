import { afterEach, describe, expect, test } from "bun:test";
import { TakeCareOS } from "./index";
import { TakeCareOSApiError } from "../types/index";

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; json?: unknown },
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k] = v;
    }
    recorded.push({ url, method: init?.method ?? "GET", headers, body: init?.body });
    const { status = 200, json = {} } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "OK",
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("TakeCareOS transport", () => {
  test("requires an api key", () => {
    expect(() => new TakeCareOS({ apiKey: "" })).toThrow();
  });

  test("listClients hits the default base URL with Bearer auth and query params", async () => {
    const recorded = installFetch(() => ({ json: { data: [{ id: "c1" }], total: 1 } }));
    const tc = new TakeCareOS({ apiKey: "secret-key" });
    const res = await tc.listClients({ page: 2, perPage: 50, status: "active" });

    expect(res.data[0]!.id).toBe("c1");
    const call = recorded[0]!;
    expect(call.method).toBe("GET");
    expect(call.headers.Authorization).toBe("Bearer secret-key");
    const url = new URL(call.url);
    expect(url.origin + url.pathname).toBe("https://api.takecareos.com/v1/clients");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("per_page")).toBe("50");
    expect(url.searchParams.get("status")).toBe("active");
  });

  test("getClient encodes the path segment", async () => {
    const recorded = installFetch(() => ({ json: { id: "c/1" } }));
    const tc = new TakeCareOS({ apiKey: "k" });
    await tc.getClient("c/1");
    expect(recorded[0]!.url).toBe("https://api.takecareos.com/v1/clients/c%2F1");
  });

  test("baseUrl override is honoured and trailing slashes trimmed", async () => {
    const recorded = installFetch(() => ({ json: { data: [] } }));
    const tc = new TakeCareOS({ apiKey: "k", baseUrl: "https://agency.example.com/api/v1/" });
    await tc.listCaregivers();
    expect(recorded[0]!.url.startsWith("https://agency.example.com/api/v1/caregivers")).toBe(true);
  });

  test("createShift POSTs a JSON body", async () => {
    const recorded = installFetch(() => ({ status: 201, json: { id: "s1" } }));
    const tc = new TakeCareOS({ apiKey: "k" });
    const res = await tc.createShift({
      client_id: "c1",
      start_time: "2026-07-06T09:00:00Z",
      end_time: "2026-07-06T12:00:00Z",
      service_type: "personal_care",
    });
    expect(res.id).toBe("s1");
    const call = recorded[0]!;
    expect(call.method).toBe("POST");
    expect(call.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(call.body as string);
    expect(body.client_id).toBe("c1");
    expect(body.service_type).toBe("personal_care");
    expect(new URL(call.url).pathname).toBe("/v1/shifts");
  });

  test("createIncident POSTs to /incidents", async () => {
    const recorded = installFetch(() => ({ json: { id: "i1" } }));
    const tc = new TakeCareOS({ apiKey: "k" });
    await tc.createIncident({ type: "fall", description: "Client slipped", severity: "high", client_id: "c1" });
    const body = JSON.parse(recorded[0]!.body as string);
    expect(body.type).toBe("fall");
    expect(new URL(recorded[0]!.url).pathname).toBe("/v1/incidents");
  });

  test("getComplianceReport GETs /compliance/report with the date range", async () => {
    const recorded = installFetch(() => ({ json: { total_caregivers: 10, compliant_caregivers: 9 } }));
    const tc = new TakeCareOS({ apiKey: "k" });
    const res = await tc.getComplianceReport({ from: "2026-06-01", to: "2026-06-30" });
    expect(res.compliant_caregivers).toBe(9);
    const url = new URL(recorded[0]!.url);
    expect(url.pathname).toBe("/v1/compliance/report");
    expect(url.searchParams.get("from")).toBe("2026-06-01");
    expect(url.searchParams.get("to")).toBe("2026-06-30");
  });

  test("non-2xx responses throw TakeCareOSApiError with parsed message + code", async () => {
    installFetch(() => ({ status: 422, json: { error: { message: "Invalid client", code: "invalid_client" } } }));
    const tc = new TakeCareOS({ apiKey: "k" });
    await expect(tc.getClient("missing")).rejects.toMatchObject({
      name: "TakeCareOSApiError",
      statusCode: 422,
      code: "invalid_client",
    });
  });

  test("TakeCareOSApiError is exported and instanceof works", async () => {
    installFetch(() => ({ status: 500, json: { message: "boom" } }));
    const tc = new TakeCareOS({ apiKey: "k" });
    try {
      await tc.listInvoices();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TakeCareOSApiError);
      expect((err as TakeCareOSApiError).statusCode).toBe(500);
    }
  });

  test("fromEnv reads TAKECAREOS_API_KEY", async () => {
    const prevKey = process.env.TAKECAREOS_API_KEY;
    const prevBase = process.env.TAKECAREOS_BASE_URL;
    process.env.TAKECAREOS_API_KEY = "env-key";
    delete process.env.TAKECAREOS_BASE_URL;
    const recorded = installFetch(() => ({ json: { data: [] } }));
    try {
      const tc = TakeCareOS.fromEnv();
      await tc.listShifts();
      expect(recorded[0]!.headers.Authorization).toBe("Bearer env-key");
    } finally {
      if (prevKey === undefined) delete process.env.TAKECAREOS_API_KEY;
      else process.env.TAKECAREOS_API_KEY = prevKey;
      if (prevBase !== undefined) process.env.TAKECAREOS_BASE_URL = prevBase;
    }
  });

  test("fromEnv throws without an api key", () => {
    const prev = process.env.TAKECAREOS_API_KEY;
    delete process.env.TAKECAREOS_API_KEY;
    try {
      expect(() => TakeCareOS.fromEnv()).toThrow(/TAKECAREOS_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.TAKECAREOS_API_KEY = prev;
    }
  });
});
