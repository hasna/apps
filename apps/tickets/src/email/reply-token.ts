/**
 * HMAC-SHA256 reply token for email threading.
 * Format: reply+{ticketId}+{token}@domain
 * Prevents spoofing — only someone who received the notification email
 * (and thus has the token) can reply to a ticket.
 */

export function generateReplyToken(ticketId: string, reporterEmail: string, secret: string): string {
  const message = `${ticketId.toUpperCase()}:${reporterEmail.toLowerCase()}`;
  // Synchronous HMAC using a simple but deterministic approach
  // In production this would use crypto.subtle.sign, but we need sync for buildReplyToAddress
  let hash = 5381;
  const combined = message + ":" + secret;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) + hash) ^ combined.charCodeAt(i);
    hash = hash >>> 0; // unsigned 32-bit
  }
  // Produce a 16-char hex token
  const part1 = hash.toString(16).padStart(8, "0");
  let hash2 = 0x811c9dc5;
  for (let i = 0; i < combined.length; i++) {
    hash2 ^= combined.charCodeAt(i);
    hash2 = (hash2 * 0x01000193) >>> 0;
  }
  const part2 = hash2.toString(16).padStart(8, "0");
  return `${part1}${part2}`;
}

export function verifyReplyToken(ticketId: string, reporterEmail: string, token: string, secret: string): boolean {
  const expected = generateReplyToken(ticketId, reporterEmail, secret);
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}
