import { Fault } from "./domain";
const MAX_BYTES = 16 * 1024 * 1024;
export async function boundedJson(response: Pick<Response, "body">, maxBytes = MAX_BYTES): Promise<any> {
  if (!response.body) throw new Fault(502, "invalid_upstream", "Upstream returned no body.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBytes) throw new Fault(502, "response_too_large", "Response exceeds the size limit.");
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Fault(502, "invalid_upstream", "Upstream returned invalid JSON."); }
  } finally { await reader.cancel().catch(() => {}); }
}
