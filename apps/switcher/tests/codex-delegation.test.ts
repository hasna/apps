import { expect, test } from "bun:test";
import { normalizeCodexDelegation } from "../src/codex-delegation";
import { compileModelPolicy } from "../src/model-policy";
import { createInferenceGateway } from "../src/inference-gateway";

test("desktop inter-task input preserves text, images and order without changing paired tool results", () => {
  const envelope = "<codex_delegation>\n<source_thread_id>source</source_thread_id>\n<input>hi &lt;task&gt; 🙂</input>\n</codex_delegation>";
  const image = { type: "input_image", image_url: "data:image/png;base64,fixture", detail: "original" };
  const original = { model: "main", input: [
    { type: "message", role: "user", content: "Original input" },
    { type: "function_call", name: "shell", call_id: "call_1", arguments: "{}" },
    { type: "function_call_output", call_id: "call_1", output: "Paired output" },
    { type: "function_call_output", name: "create_thread", namespace: "codex_app", output: envelope },
    { type: "function_call_output", name: "send_message", namespace: "codex_app", call_id: null, output: [{ type: "input_text", text: "Follow-up" }, image] },
    { type: "function_call_output", name: "send_message", namespace: "codex_app", call_id: "call_2", output: "Keep pairing" },
    { type: "function_call_output", name: "send_message", namespace: "another_namespace", output: "Unrelated" },
  ] };
  const before = structuredClone(original);
  const result = normalizeCodexDelegation(original);
  expect(result.input.slice(0, 3)).toEqual(original.input.slice(0, 3));
  expect(result.input[3]).toEqual({ type: "message", role: "user", content: [{ type: "input_text", text: envelope }] });
  expect(result.input[4]).toEqual({ type: "message", role: "user", content: [{ type: "input_text", text: "Follow-up" }, image] });
  expect(result.input.slice(5)).toEqual(original.input.slice(5));
  expect(normalizeCodexDelegation(result)).toEqual(result);
  expect(original).toEqual(before);
  expect(normalizeCodexDelegation({ input: "plain input" })).toEqual({ input: "plain input" });
});

test("gateway repairs native task messages before a strict provider and rejects unrepresentable content without dropping it", async () => {
  const seen: any[] = [], events: any[] = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json(); seen.push(body);
    if (body.input.some((item: any) => item.type === "function_call_output" && !item.call_id)) return Response.json({ error: { message: "missing field call_id" } }, { status: 400 });
    return new Response('data: {"type":"response.completed","response":{"model":"main"}}\n\n', { headers: { "content-type": "text/event-stream" } });
  } });
  const models = [{ id: "main", name: "Main" }];
  const gateway = createInferenceGateway({ harness: "codex", protocol: "openai-responses", baseUrl: upstream.url.origin, model: "main", models, stateDir: "/fixture", cwd: "/fixture", compiledPolicy: compileModelPolicy("main", models), catalogPath: "/fixture/catalog.json", onRoutingEvent: event => events.push(event) });
  const send = (output: unknown) => fetch(gateway.baseUrl + "/responses", { method: "POST", headers: { authorization: `Bearer ${gateway.token}`, "content-type": "application/json" }, body: JSON.stringify({ model: "main", input: [{ type: "function_call_output", name: "send_message", namespace: "codex_app", output }] }) });
  try {
    const response = await send("Complete task text");
    expect(response.status).toBe(200); expect(await response.text()).toContain("response.completed");
    expect(seen[0].input).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "Complete task text" }] }]);
    expect(events[0].upstreamStatus).toBe(200);
    const invalid = await send([{ type: "encrypted_content", encrypted_content: "private message" }]);
    expect(invalid.status).toBe(400); expect((await invalid.json()).error.code).toBe("unsupported_task_message_content");
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("private message");
  } finally { await gateway.cleanup(); await upstream.stop(true); }
});
