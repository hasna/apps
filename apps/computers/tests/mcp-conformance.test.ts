import { describe, expect, test } from "bun:test";
import { ComputersMcpServer, SAFE_MCP_TOOLS } from "../src/mcp";
import {
  INSTALL_POLICY_PACKAGE_PATTERN_SCHEMA,
  MCP_INPUT_SCHEMA_FRAGMENTS,
  validateArgv,
  validateId,
  validateIdempotencyKey,
  validateInstallPolicyRules,
  validatePackageSpec,
} from "../src/validation";

const client = {
  listComputers: async () => [], getComputer: async (id: string) => ({ id }), listOperations: async () => [],
  requestExec: async () => ({ id: "operation_exec" }), installPlan: async () => ({ decision: "deny" }), providerReadiness: async () => [],
};

async function message(server: ComputersMcpServer, value: unknown): Promise<unknown> {
  const raw = await server.handle(value);
  return raw === undefined ? undefined : JSON.parse(raw);
}

function tool(name: string): (typeof SAFE_MCP_TOOLS)[number] {
  const result = SAFE_MCP_TOOLS.find((candidate) => candidate.name === name);
  if (result === undefined) throw new Error(`Missing MCP tool ${name}`);
  return result;
}

describe("MCP 2025-03-26 JSON-RPC conformance", () => {
  test("accepts only string or signed-integer request IDs and treats null as an invalid request", async () => {
    for (const id of [null, 1.25, true, false, {}, []]) {
      const server = new ComputersMcpServer(client as never);
      expect(await message(server, { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "reviewer-probe", version: "1" } } }))
        .toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    }
    const server = new ComputersMcpServer(client as never);
    expect(await message(server, { jsonrpc: "2.0", id: -7, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "reviewer-probe", version: "1" } } }))
      .toMatchObject({ id: -7, result: { protocolVersion: "2025-03-26" } });
    expect(await message(new ComputersMcpServer(client as never), { jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "reviewer-probe", version: "1" } } })).toBeUndefined();
  });

  test("rejects initialize in a batch without mutating lifecycle state", async () => {
    const server = new ComputersMcpServer(client as never);
    expect(await message(server, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "batch-probe", version: "1" } } },
      { jsonrpc: "2.0", id: 2, method: "ping", params: {} },
    ])).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Invalid Request" } },
      { jsonrpc: "2.0", id: 2, error: { code: -32002, message: "Server not initialized" } },
    ]);
    expect(await message(server, { jsonrpc: "2.0", id: "direct-after-batch", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "direct-probe", version: "1" } } }))
      .toMatchObject({ id: "direct-after-batch", result: { protocolVersion: "2025-03-26" } });
  });

  test("negotiates the server protocol version for unsupported client versions", async () => {
    const server = new ComputersMcpServer(client as never);
    expect(await message(server, { jsonrpc: "2.0", id: "version-probe", method: "initialize", params: {
      protocolVersion: "2099-01-01", capabilities: { roots: { listChanged: false }, sampling: {} }, clientInfo: { name: "version-probe", version: "1" },
    } })).toMatchObject({ jsonrpc: "2.0", id: "version-probe", result: {
      protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "computers-mcp" },
    } });
  });

  test("requires valid JSON-RPC requests and initialized negotiation", async () => {
    const server = new ComputersMcpServer(client as never);
    expect(await message(server, { method: "initialize", id: 1 })).toMatchObject({ error: { code: -32600 } });
    expect(await message(server, { jsonrpc: "2.0", id: 1, method: "tools/list" })).toMatchObject({ error: { code: -32002 } });
    expect(await message(server, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: { roots: { listChanged: true }, sampling: {} }, clientInfo: { name: "test", version: "1" } } })).toMatchObject({ result: { protocolVersion: "2025-03-26" } });
    expect(await message(server, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect(await message(server, { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })).toMatchObject({ result: { tools: expect.any(Array) } });
    expect(await message(server, { jsonrpc: "2.0", id: 4, method: "ping", params: { extra: true } })).toMatchObject({ error: { code: -32602 } });
    expect(await message(server, { jsonrpc: "2.0", method: "tools/call", params: { name: "computers_get", arguments: { id: "cmp_good" } } })).toBeUndefined();
  });

  test("handles batches, notifications, unknown methods/tools, and invalid args correctly", async () => {
    const server = new ComputersMcpServer(client as never);
    await message(server, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    await message(server, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(await message(server, [])).toMatchObject({ error: { code: -32600 } });
    const batch = await message(server, [
      { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 99 } },
      { jsonrpc: "2.0", id: 2, method: "unknown" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "missing", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "computers_get", arguments: { id: "cmp_good", extra: true } } },
    ]) as Array<{ id: number; error: { code: number } }>;
    expect(batch).toHaveLength(3);
    expect(batch.map((item) => item.error.code)).toEqual([-32601, -32602, -32602]);
  });

  test("publishes strict safe tool schemas and annotations with no forbidden tool", () => {
    for (const tool of SAFE_MCP_TOOLS) expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(SAFE_MCP_TOOLS.find((tool) => tool.name === "computers_exec_request")?.annotations)
      .toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
    expect(SAFE_MCP_TOOLS.find((tool) => tool.name === "computers_install_plan")?.annotations)
      .toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    for (const tool of SAFE_MCP_TOOLS.filter((item) => !["computers_exec_request", "computers_install_plan"].includes(item.name))) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    }
    const names = SAFE_MCP_TOOLS.map((tool) => tool.name).join(" ");
    for (const forbidden of ["delete", "restore", "reassign", "policy", "sandbox"]) expect(names).not.toContain(forbidden);
  });
});

describe("MCP advertised input constraints", () => {
  test("shares the canonical ID, idempotency, argv, and package schemas", () => {
    expect(tool("computers_get").inputSchema.properties.id).toEqual(MCP_INPUT_SCHEMA_FRAGMENTS.id);
    expect(tool("computers_operations").inputSchema.properties.computerId).toEqual(MCP_INPUT_SCHEMA_FRAGMENTS.id);
    const exec = tool("computers_exec_request").inputSchema.properties;
    expect(exec.computerId).toEqual(MCP_INPUT_SCHEMA_FRAGMENTS.id);
    expect(exec.idempotencyKey).toEqual(MCP_INPUT_SCHEMA_FRAGMENTS.idempotencyKey);
    expect(exec.argv).toEqual(MCP_INPUT_SCHEMA_FRAGMENTS.argv);
    expect(tool("computers_install_plan").inputSchema.properties.spec).toEqual(MCP_INPUT_SCHEMA_FRAGMENTS.packageSpec);
  });

  test("advertises every canonical runtime bound and semantic restriction", () => {
    expect(MCP_INPUT_SCHEMA_FRAGMENTS.id).toEqual({ type: "string", minLength: 3, maxLength: 64, pattern: "^[a-z][a-z0-9_]{2,63}$" });
    expect(MCP_INPUT_SCHEMA_FRAGMENTS.idempotencyKey).toEqual({ type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" });
    expect(MCP_INPUT_SCHEMA_FRAGMENTS.argv).toMatchObject({
      type: "array", minItems: 1, maxItems: 128, "x-maxEncodedBytes": 65_536,
      items: { type: "string", minLength: 1, maxLength: 65_536, pattern: "^[^\\u0000]+$" },
    });
    const spec = MCP_INPUT_SCHEMA_FRAGMENTS.packageSpec;
    expect(spec.properties.name).toMatchObject({ type: "string", minLength: 1, maxLength: 214, not: { pattern: "\\.\\." } });
    expect(spec.properties.version).toEqual({ type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._+~:-]{0,127}$" });
    expect(spec.properties.registry).toEqual(MCP_INPUT_SCHEMA_FRAGMENTS.registry);
    expect(MCP_INPUT_SCHEMA_FRAGMENTS.registry).toEqual({
      type: "string",
      format: "uri",
      pattern: "^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\\.[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?::[1-9][0-9]{3})?/(?:[A-Za-z0-9_~!$&()*+,:;=@-](?:[A-Za-z0-9._~!$&()*+,:;=@-]*[A-Za-z0-9_~!$&()*+,:;=@-])?(?:/[A-Za-z0-9_~!$&()*+,:;=@-](?:[A-Za-z0-9._~!$&()*+,:;=@-]*[A-Za-z0-9_~!$&()*+,:;=@-])?)*/?)?$",
      maxLength: 512,
      "x-maxHostnameLength": 253,
    });
    expect(spec.properties.dependencyClosure).toMatchObject({ type: "array", maxItems: 512 });
    expect(spec.properties.dependencyClosure.items.properties.name).toEqual(spec.properties.name);
    expect(spec.properties.dependencyClosure.items.properties.version).toEqual(spec.properties.version);
    expect(spec.properties.dependencyClosure.items.properties.digest).toEqual(spec.properties.digest);
  });

  test("runtime validators reject values outside the advertised contract", () => {
    for (const id of ["ab", "A_valid", `a${"b".repeat(64)}`]) expect(() => validateId(id)).toThrow("Invalid id");
    for (const key of ["short", "contains space", "x".repeat(129)]) expect(() => validateIdempotencyKey(key)).toThrow("Invalid idempotencyKey");
    expect(() => validateArgv([])).toThrow("Invalid argv");
    expect(() => validateArgv(["ok", "x".repeat(65_537)])).toThrow("Invalid argv");
    expect(() => validateArgv(["bad\0argument"])).toThrow("Invalid argv[0]");
    const valid = {
      manager: "bun", name: "@hasna/example", version: "1.0.0", digest: `sha256:${"a".repeat(64)}`,
      registry: "https://registry.example.invalid/", dependencyClosure: [], allowLifecycleScripts: false,
    } as const;
    expect(validatePackageSpec(valid)).toMatchObject(valid);
    for (const registry of [
      "HTTPS://registry.example.invalid/", "https://REGISTRY.example.invalid/", "https://registry.example.invalid",
      "https://registry.example.invalid:443/", "https://registry.example.invalid/?channel=stable",
      "https://registry.example.invalid/?", "https://registry.example.invalid/#release",
      "https://registry.example.invalid/#", "https://user:pass@registry.example.invalid/",
      "https://registry.example.invalid/a/../b", "https://registry.example.invalid\\path",
      "https://registry.example.invalid/%2e", "https://registry.example.invalid/%zz",
      "https://registry.example.invalid/[raw]", "https://registry.example.invalid/path|raw",
      "https://registry.example.invalid/path//",
      "https://127.1/", "https://0177.1/", "https://0x7f.1/", "https://127.000.000.001/",
      "https://registry.example.123/", "https://registry.example.invalid:444/",
      "https://registry.example.invalid:10443/", "https://registry.example.invalid:65535/",
      "https://registry.example.invalid/.well-known/", "https://registry.example.invalid/name./",
      "http://registry.example.invalid/",
    ]) {
      expect(() => validatePackageSpec({ ...valid, registry }), registry).toThrow("Invalid spec.registry");
      expect(() => validateInstallPolicyRules([{ effect: "allow", registries: [registry] }]), registry).toThrow("Invalid install policy");
    }
    for (const registry of [
      "https://registry.example.invalid/",
      "https://registry.example.invalid/path",
      "https://registry.example.invalid/path/",
      "https://registry.example.invalid:8443/Case-Sensitive/V1.2/",
    ]) {
      expect(validatePackageSpec({ ...valid, registry }).registry).toBe(registry);
      expect(validateInstallPolicyRules([{ effect: "allow", registries: [registry] }])[0]?.registries).toEqual([registry]);
    }
    const maximumRegistry = `https://registry.example.invalid/${"a".repeat(512 - "https://registry.example.invalid/".length)}`;
    expect(validatePackageSpec({ ...valid, registry: maximumRegistry }).registry).toBe(maximumRegistry);
    expect(validateInstallPolicyRules([{ effect: "allow", registries: [maximumRegistry] }])[0]?.registries).toEqual([maximumRegistry]);
    const oversizedRegistry = `${maximumRegistry}a`;
    expect(() => validatePackageSpec({ ...valid, registry: oversizedRegistry })).toThrow("Invalid spec.registry");
    expect(() => validateInstallPolicyRules([{ effect: "allow", registries: [oversizedRegistry] }])).toThrow("Invalid install policy");
    const maximumHostname = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(53)}.invalid`;
    const maximumHostnameRegistry = `https://${maximumHostname}/`;
    expect(maximumHostname).toHaveLength(253);
    expect(validatePackageSpec({ ...valid, registry: maximumHostnameRegistry }).registry).toBe(maximumHostnameRegistry);
    expect(validateInstallPolicyRules([{ effect: "allow", registries: [maximumHostnameRegistry] }])[0]?.registries)
      .toEqual([maximumHostnameRegistry]);
    const oversizedHostnameRegistry = `https://${maximumHostname}a/`;
    expect(() => validatePackageSpec({ ...valid, registry: oversizedHostnameRegistry })).toThrow("Invalid spec.registry");
    expect(() => validateInstallPolicyRules([{ effect: "allow", registries: [oversizedHostnameRegistry] }]))
      .toThrow("Invalid install policy");
    expect(INSTALL_POLICY_PACKAGE_PATTERN_SCHEMA).toEqual({
      type: "string", minLength: 1, maxLength: 128,
      pattern: "^[A-Za-z0-9@/_.+:-]*(?:\\*[A-Za-z0-9@/_.+:-]*){0,8}$",
    });
    expect(validateInstallPolicyRules([{ effect: "allow", packagePatterns: ["a*b*c*d*e*f*g*h*"] }])[0]?.packagePatterns)
      .toEqual(["a*b*c*d*e*f*g*h*"]);
    expect(() => validateInstallPolicyRules([{ effect: "allow", packagePatterns: ["*a*b*c*d*e*f*g*h*"] }]))
      .toThrow("Invalid install policy");
    expect(() => validatePackageSpec({ ...valid, name: "unsafe..name" })).toThrow("Invalid spec.name");
    expect(() => validatePackageSpec({ ...valid, dependencyClosure: Array.from({ length: 513 }, () => ({ name: "dep", version: "1", digest: valid.digest })) })).toThrow("Invalid spec.dependencyClosure");
  });
});
