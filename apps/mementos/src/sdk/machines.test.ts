import { describe, expect, test } from "bun:test";
import {
  MEMENTOS_MACHINE_LIST_CONTRACT,
  MEMENTOS_MACHINE_MUTATION_CONTRACT,
  MEMENTOS_MACHINE_REGISTRATION_CONTRACT,
  MementosClient,
  type MementosMachine,
} from "./index.js";

const machine: MementosMachine = {
  id: "machine-sdk-1",
  name: "apple01",
  hostname: "apple01",
  platform: "darwin",
  is_primary: false,
  created_at: "2026-09-17T00:00:00.000Z",
  last_seen_at: "2026-09-17T00:00:00.000Z",
};

function clientWith(responses: unknown[], calls: Array<{ url: string; method?: string; body?: string }> = []): MementosClient {
  return new MementosClient({
    baseUrl: "https://api.hasna.com/mementos",
    apiKey: "test-only-key",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
      return Response.json(responses.shift());
    }) as typeof fetch,
  });
}

describe("MementosClient hosted machines", () => {
  test("uses one /v1 prefix and validates registration/list/mutation receipts", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const client = clientWith([
      {
        contract: MEMENTOS_MACHINE_REGISTRATION_CONTRACT,
        machine,
        created: true,
        identity: { idempotency_key: "normalized_hostname", stable_id: machine.id },
      },
      { contract: MEMENTOS_MACHINE_LIST_CONTRACT, machines: [machine], count: 1, complete: true },
      { contract: MEMENTOS_MACHINE_MUTATION_CONTRACT, machine },
      { contract: MEMENTOS_MACHINE_MUTATION_CONTRACT, machine: { ...machine, name: "renamed" } },
      { contract: MEMENTOS_MACHINE_MUTATION_CONTRACT, machine: { ...machine, is_primary: true } },
      { contract: "mementos.machine-touch.v1", touched: true, id: machine.id, touched_at: machine.last_seen_at, machine },
      { contract: MEMENTOS_MACHINE_MUTATION_CONTRACT, deleted: true, id: machine.id },
    ], calls);

    expect((await client.registerMachine({ hostname: "apple01", platform: "darwin" })).id).toBe(machine.id);
    expect((await client.listMachines()).count).toBe(1);
    expect((await client.getMachine(machine.id)).id).toBe(machine.id);
    expect((await client.renameMachine(machine.id, "renamed")).name).toBe("renamed");
    expect((await client.setPrimaryMachine(machine.id)).is_primary).toBe(true);
    expect((await client.touchMachine(machine.id)).id).toBe(machine.id);
    expect(await client.deleteMachine(machine.id)).toEqual({ deleted: true, id: machine.id });

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.hasna.com/mementos/v1/machines",
      "https://api.hasna.com/mementos/v1/machines",
      `https://api.hasna.com/mementos/v1/machines/${machine.id}`,
      `https://api.hasna.com/mementos/v1/machines/${machine.id}`,
      `https://api.hasna.com/mementos/v1/machines/${machine.id}/primary`,
      `https://api.hasna.com/mementos/v1/machines/${machine.id}/touch`,
      `https://api.hasna.com/mementos/v1/machines/${machine.id}`,
    ]);
    expect(calls.every((call) => !call.url.includes("/v1/v1/"))).toBe(true);
  });

  test.each([
    {},
    { contract: MEMENTOS_MACHINE_LIST_CONTRACT, machines: [machine], count: 2, complete: true },
    { contract: MEMENTOS_MACHINE_LIST_CONTRACT, machines: [machine, machine], count: 2, complete: true },
    { contract: MEMENTOS_MACHINE_LIST_CONTRACT, machines: [machine, { ...machine, id: "other", hostname: "other" }], count: 2, complete: true },
    { contract: MEMENTOS_MACHINE_LIST_CONTRACT, machines: [{ ...machine, created_at: "bad" }], count: 1, complete: true },
    { contract: MEMENTOS_MACHINE_LIST_CONTRACT, machines: [{ ...machine, created_at: "2026-02-30T00:00:00.000Z" }], count: 1, complete: true },
    { contract: MEMENTOS_MACHINE_LIST_CONTRACT, machines: [{ ...machine, created_at: "2026-09-18T00:00:00.000Z" }], count: 1, complete: true },
  ])("list refuses malformed success %#", async (response) => {
    await expect(clientWith([response]).listMachines()).rejects.toThrow("malformed 2xx response");
  });

  test("mutations refuse a wrong returned stable id and false delete receipt", async () => {
    await expect(clientWith([{ contract: MEMENTOS_MACHINE_MUTATION_CONTRACT, machine: { ...machine, id: "other" } }]).renameMachine(machine.id, "renamed"))
      .rejects.toThrow("malformed 2xx response");
    await expect(clientWith([{ contract: MEMENTOS_MACHINE_MUTATION_CONTRACT, deleted: false, id: machine.id }]).deleteMachine(machine.id))
      .rejects.toThrow("malformed 2xx response");
  });
  test("registration, rename, primary, and touch receipts are bound to requested postconditions", async () => {
    await expect(clientWith([{
      contract: MEMENTOS_MACHINE_REGISTRATION_CONTRACT,
      machine: { ...machine, hostname: "other-host" },
      created: true,
      identity: { idempotency_key: "normalized_hostname", stable_id: machine.id },
    }]).registerMachine({ hostname: machine.hostname, platform: machine.platform }))
      .rejects.toThrow("malformed 2xx response");

    await expect(clientWith([{ contract: MEMENTOS_MACHINE_MUTATION_CONTRACT, machine }]).renameMachine(machine.id, "renamed"))
      .rejects.toThrow("malformed 2xx response");
    await expect(clientWith([{ contract: MEMENTOS_MACHINE_MUTATION_CONTRACT, machine }]).setPrimaryMachine(machine.id))
      .rejects.toThrow("malformed 2xx response");
    await expect(clientWith([{ contract: "mementos.machine-touch.v1", touched: false, id: machine.id, touched_at: machine.last_seen_at, machine }]).touchMachine(machine.id))
      .rejects.toThrow("malformed 2xx response");
  });

});
