const MAX_ERROR_BYTES = 16 * 1024;
const ERROR_READ_TIMEOUT_MS = 1000;
const contextCodes = new Set(["context_length_exceeded", "context_window_exceeded", "prompt_too_long"]);

/** Only classify known structured failures. Provider text never leaves this boundary. */
export async function isContextOverflow(response: Response): Promise<boolean> {
  if (![400, 413, 422].includes(response.status) || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    return false;
  }
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("provider_error_timeout")), ERROR_READ_TIMEOUT_MS);
    });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, text = "";
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_ERROR_BYTES) return false;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const error = JSON.parse(text)?.error;
    if (!error || typeof error !== "object" || Array.isArray(error)) return false;
    if ([error.code, error.type].some(code => typeof code === "string" && contextCodes.has(code))) return true;
    return typeof error.message === "string" && /^(?:prompt is too long\b|(?:this model['’]s )?maximum context length (?:is|has been exceeded)\b|(?:input|prompt) tokens? (?:exceed|exceeds|exceeded) (?:the )?(?:maximum|model['’]s) context (?:length|window)\b)/i.test(error.message.trim());
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    // Cancelling a broken upstream must not extend the bounded read deadline.
    void reader.cancel().catch(() => undefined);
  }
}
