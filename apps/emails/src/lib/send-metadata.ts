/** Public metadata is never permission to replace transport or service headers. */
const RESERVED_HEADER = /^(?:x-(?:hasna|emails|ses|amz|amzn|resend|google|ms|microsoft|original|envelope|list|tracking|track|sg|mailgun|mc|pm)-|x-(?:auth|api-key|access-token|refresh-token|bearer|session|credential|secret|token|forward|received|unsubscribe|smtpapi))/i;
export function normalizeSendMetadata(headers: unknown, tags: unknown): {
  headers?: Record<string, string>; tags?: Record<string, string>;
} {
  const result: { headers?: Record<string, string>; tags?: Record<string, string> } = {};
  for (const [kind, value, max] of [["headers", headers, 20], ["tags", tags, 50]] as const) {
    if (value === undefined) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${kind} must be an object of strings`);
    const entries = Object.entries(value);
    if (entries.length > max) throw new Error(`${kind} exceeds the ${max} entry limit`);
    const normalized = new Map<string, string>();
    let headerBytes = 0;
    for (const [name, item] of entries) {
      if (typeof item !== "string") throw new Error(`${kind} values must be strings`);
      if (kind === "headers") {
        if (!/^X-[A-Za-z0-9!#$%&'*+.^_`|~-]{1,76}$/i.test(name) || RESERVED_HEADER.test(name)) throw new Error("Custom headers must use nonreserved X-* names; transport, authentication, forwarding and tracking headers are reserved");
        if (!item || item.length > 900 || /[^\x20-\x7e]/.test(item)) throw new Error("Custom header values must contain 1 to 900 printable ASCII characters without controls or newlines");
        const key = name.toLowerCase();
        if (normalized.has(key)) throw new Error("Custom header names must be unique ignoring case");
        headerBytes += name.length + item.length + 4;
        if (headerBytes > 8192) throw new Error("Custom headers exceed the 8192 byte limit");
        normalized.set(key, item);
      } else {
        if (!/^[A-Za-z0-9_-]{1,256}$/.test(name) || !/^[A-Za-z0-9_-]{1,256}$/.test(item)) throw new Error("Tag names and values must contain 1 to 256 ASCII letters, digits, underscores or hyphens");
        normalized.set(name, item);
      }
    }
    if (normalized.size) result[kind] = Object.fromEntries([...normalized].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }
  return result;
}
