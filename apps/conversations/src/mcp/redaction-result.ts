import { describeSendRedaction, type SendRedactionNotice } from "../lib/content-safety.js";

/**
 * Build the MCP tool result for a send, surfacing redaction to the caller.
 *
 * The conversations MCP is the sanctioned cross-runtime path agents use to talk
 * to each other, so a redaction invisible here is invisible to most of the
 * fleet. A tool result carrying only the stored message looks identical whether
 * the body survived or was replaced by a tag.
 *
 * `isError` is set whenever the stored body differs from what was submitted.
 * The operation did persist a row, but it did not do what the caller asked, and
 * an agent that reads success here will move on believing its record landed —
 * which is exactly how a correction to a wrongly-closed incident was lost.
 */
export function sendResult<T extends { content?: string | null; redaction?: SendRedactionNotice }>(submitted: string, msg: T) {
  // Prefer the notice the store funnel already attached; fall back to diffing
  // for any caller that hands us a message from somewhere else.
  const redaction = msg?.redaction ?? describeSendRedaction(submitted, msg?.content ?? null);

  if (!redaction.redacted) {
    return { content: [{ type: "text" as const, text: JSON.stringify(msg) }] };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...msg,
          redaction,
          warning:
            `CONTENT ALTERED WHEN RENDERED TO READERS. ${redaction.message} ` +
            `Re-read the message before treating it as recorded. Do not resend the same text unchanged.`,
        }),
      },
    ],
    isError: true,
  };
}
