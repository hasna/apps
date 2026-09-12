// Pure message-preview text shaping shared by the CLI (`conversations` read
// paths), the MCP tools and the notification domain library. Kept free of any
// store import so client bundles never drag `bun:sqlite` in through it.
import { COLLECTION_MAX_PREVIEW_BYTES } from "./message-previews.js";
import { redactSensitiveText } from "./content-safety.js";

/**
 * How much of a channel message a notification `preview` carries.
 *
 * Together with the character-class strip in {@link buildMessagePreview} this is
 * why a preview cannot be parsed for identifiers — which is the POINT, not a
 * shortcoming to be opted out of. A caller that needs an identifier reads one
 * message by its exact id (`getMessageById` / `conversations show <id>`); there
 * is deliberately no collection-shaped route to a body. Note this is NOT the DM
 * preview length — that is `DEFAULT_PREVIEW_CHARS` in ./compact-output.ts, which
 * is 160 and strips nothing.
 */
export const DEFAULT_PREVIEW_CHARS = 140;

export function buildMessagePreview(content: string, maxChars = DEFAULT_PREVIEW_CHARS): string {
  const markers: string[] = [];
  const protectedContent = redactSensitiveText(content).replace(/\[REDACTED:[A-Z_]+\]/g, (marker) => {
    const placeholder = `REDACTIONMARKER${markers.length}TOKEN`;
    markers.push(marker);
    return placeholder;
  });
  const normalized = protectedContent
    .replace(/[*#`~_>\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/REDACTIONMARKER(\d+)TOKEN/g, (_match, index) => markers[Number(index)] ?? "[REDACTED]");
  const boundedMaxChars = Math.min(Math.max(1, maxChars), COLLECTION_MAX_PREVIEW_BYTES);
  if (normalized.length <= boundedMaxChars) return normalized;
  return normalized.slice(0, boundedMaxChars).trimEnd() + "…";
}
