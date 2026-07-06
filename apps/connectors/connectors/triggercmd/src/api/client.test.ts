import { afterEach, describe, expect, test } from "bun:test";
import { Connector, ConnectorClient } from "./index";

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) {
        headers[k.toLowerCase()] = v;
      }
    }
    recorded.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("TriggercmdConnectorClient", () => {
  test("requires API token", () => {
    expect(() => new ConnectorClient({})).toThrow("TRIGGERcmd API token is required");
  });

  test("sends Bearer authorization header", async () => {
    const recorded = installFetch(() => ({ records: [] }));
    const client = new ConnectorClient({ apiKey: "test-token-abc" });
    await client.get("/api/computer/list");
    expect(recorded[0].headers.authorization).toBe("Bearer test-token-abc");
  });

  test("computers.list calls GET /api/computer/list", async () => {
    const recorded = installFetch((url) => {
      if (url.includes("/api/computer/list")) return { records: [{ name: "MyPC" }] };
      return {};
    });
    const connector = new Connector({ apiKey: "tok" });
    const result = await connector.computers.list();
    expect(result.records?.[0]?.name).toBe("MyPC");
    expect(recorded[0].url).toContain("/api/computer/list");
    expect(recorded[0].method).toBe("GET");
  });

  test("commands.commandlist calls POST /api/command/commandlist", async () => {
    const recorded = installFetch((url) => {
      if (url.includes("/api/command/commandlist")) return { records: [{ name: "calc" }] };
      return {};
    });
    const connector = new Connector({ apiKey: "tok" });
    const result = await connector.commands.commandlist();
    expect(result.records?.[0]?.name).toBe("calc");
    expect(recorded[0].url).toContain("/api/command/commandlist");
    expect(recorded[0].method).toBe("POST");
  });

  test("commands.list sends computer_id in POST body", async () => {
    const recorded = installFetch((url) => {
      if (url.includes("/api/command/list")) return { records: [] };
      return {};
    });
    const connector = new Connector({ apiKey: "tok" });
    await connector.commands.list({ computer_id: "comp123" });
    const body = JSON.parse(recorded[0].body!);
    expect(body.computer_id).toBe("comp123");
    expect(recorded[0].method).toBe("POST");
  });

  test("trigger.run sends computer, trigger, and params in POST body", async () => {
    const recorded = installFetch((url) => {
      if (url.includes("/api/run/triggerSave")) return { success: true };
      return {};
    });
    const connector = new Connector({ apiKey: "tok" });
    await connector.trigger.run({
      computer: "MyPC",
      trigger: "notepad",
      params: "file.txt",
    });
    expect(recorded[0].url).toContain("/api/run/triggerSave");
    expect(recorded[0].method).toBe("POST");
    const body = JSON.parse(recorded[0].body!);
    expect(body).toEqual({ computer: "MyPC", trigger: "notepad", params: "file.txt" });
  });

  test("runs.list calls GET /api/run/list with query params", async () => {
    const recorded = installFetch((url) => {
      if (url.includes("/api/run/list")) return { records: [{ status: "Command ran" }] };
      return {};
    });
    const connector = new Connector({ apiKey: "tok" });
    const result = await connector.runs.list({ command_id: "cmd1", sortOn: "createdAt,DESC" });
    expect(result.records?.[0]?.status).toBe("Command ran");
    expect(recorded[0].url).toContain("/api/run/list");
    expect(recorded[0].url).toContain("command_id=cmd1");
    expect(recorded[0].url).toContain("sortOn=createdAt%2CDESC");
    expect(recorded[0].method).toBe("GET");
  });

  test("fromEnv reads TRIGGERCMD_API_KEY", () => {
    process.env.TRIGGERCMD_API_KEY = "env-token-abcdefghij";
    const connector = Connector.fromEnv();
    expect(connector.getTokenPreview()).toMatch(/^env-to/);
    delete process.env.TRIGGERCMD_API_KEY;
  });
});
