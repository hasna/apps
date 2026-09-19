import { pathToFileURL } from "node:url";

export const MAX_REDACTED_LOG_BYTES = 32 * 1024;

export function redactLogText(input, maxBytes = MAX_REDACTED_LOG_BYTES) {
  let output = String(input)
    .replace(/\b((?:postgres(?:ql)?|https?):\/\/)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(
      /\b([A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|KEY|DATABASE_URL)[A-Z0-9_]*\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/([?&](?:password|token|secret|api[_-]?key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]");

  const encoded = Buffer.from(output);
  if (encoded.byteLength > maxBytes) {
    output = `${encoded.subarray(0, maxBytes).toString("utf8")}\n[TRUNCATED at ${maxBytes} bytes]\n`;
  }
  return output;
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  process.stdout.write(redactLogText(Buffer.concat(chunks).toString("utf8")));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
