import type { HarnessLaunchInput } from "./harness-types";

/** Recognize whole SSE terminal events, never marker text inside a delta. */
export function terminalEventObserver(protocol: HarnessLaunchInput["protocol"], contentType: string | null) {
  const enabled = contentType?.split(";", 1)[0].trim().toLowerCase() === "text/event-stream";
  const decoder = new TextDecoder();
  let line = "", data: string[] = [], size = 0, overflow = false, afterCR = false, complete = false;
  const dispatchLine = () => {
    if (!line) {
      if (!overflow && data.length) {
        const payload = data.join("\n");
        if (protocol === "openai-chat") complete ||= payload === "[DONE]";
        else try {
          const value = JSON.parse(payload);
          complete ||= protocol === "anthropic-messages" ? value?.type === "message_stop"
            : protocol === "openai-responses" && ["response.completed", "response.failed", "response.incomplete"].includes(value?.type);
        } catch { /* Unknown/malformed events remain transparent to the native client. */ }
      }
      data = []; size = 0; overflow = false;
    } else if (!overflow && line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    line = "";
  };
  return (chunk: Uint8Array): boolean => {
    if (!enabled || protocol === "gemini-generate-content") return false;
    for (const char of decoder.decode(chunk, { stream: true })) {
      if (afterCR && char === "\n") { afterCR = false; continue; }
      afterCR = char === "\r";
      if (char === "\r" || char === "\n") dispatchLine();
      else if (++size <= 131072) line += char;
      else { overflow = true; line = "oversized"; }
    }
    return complete;
  };
}

/** One lifecycle for all bridges: terminal SSE, caller cancellation, and real failure. */
export function proxyProviderStream(input: {
  response: Response;
  protocol: HarnessLaunchInput["protocol"];
  requestSignal: AbortSignal;
  abort: AbortController;
  closing: () => boolean;
  release: () => void;
  inspect?: (chunk: Uint8Array, done?: boolean) => void;
  interrupted?: () => void;
}) {
  const reader = input.response.body!.getReader();
  const terminal = terminalEventObserver(input.protocol, input.response.headers.get("content-type"));
  let ended = false, output: ReadableStreamDefaultController<Uint8Array>;
  const end = (error?: Error) => {
    if (ended) return;
    ended = true;
    try { if (error) output.error(error); else output.close(); } catch { /* The client may have already cancelled. */ }
    input.release();
  };
  const cancelReader = async () => {
    input.abort.abort();
    try { await reader.cancel(); } catch { /* Already closed or aborted. */ }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { output = controller; },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (ended) return;
        if (chunk.done) { input.inspect?.(new Uint8Array(), true); end(); return; }
        input.inspect?.(chunk.value);
        const complete = terminal(chunk.value);
        controller.enqueue(chunk.value);
        if (complete) {
          // All response content, including usage and protocol failure events,
          // reaches the client before the transport is released.
          end();
          await cancelReader();
        }
      } catch {
        if (ended) return;
        if (input.requestSignal.aborted || input.abort.signal.aborted || input.closing()) end();
        else { input.interrupted?.(); end(new Error("Provider stream ended unexpectedly")); }
      }
    },
    async cancel() {
      if (!ended) { ended = true; input.release(); }
      await cancelReader();
    },
  });
  return { stream, cancel: async () => { end(); await cancelReader(); } };
}
