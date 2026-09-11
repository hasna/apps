import { Fault } from "./domain";

/**
 * New desktop runtimes deliver inter-task input as a namespaced tool output
 * without a call_id. Standard Responses providers require a paired call_id.
 * Use the same user-message semantics as older desktop runtimes, retaining the
 * complete delegation envelope and content. Never invent a matching tool call.
 */
export function normalizeCodexDelegation(body: Record<string, any>): Record<string, any> {
  if (!Array.isArray(body.input)) return body;
  return { ...body, input: body.input.map((item: any) => {
    if (item?.type !== "function_call_output" || item.namespace !== "codex_app" || item.call_id != null) return item;
    const content = typeof item.output === "string" ? [{ type: "input_text", text: item.output }] : item.output;
    if (!Array.isArray(content) || !content.length || !content.every(part => part && (
      part.type === "input_text" && typeof part.text === "string" ||
      part.type === "input_image" && (typeof part.image_url === "string" || typeof part.file_id === "string")
    ))) throw new Fault(400, "unsupported_task_message_content", "The task message contains content this provider route cannot represent.");
    return { type: "message", role: "user", content };
  }) };
}
