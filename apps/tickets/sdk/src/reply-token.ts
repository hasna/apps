/**
 * Verify a reply token from an email reply-to address.
 * Used to validate that a reply email is legitimate and maps to the correct ticket.
 *
 * @example
 * const valid = verifyReplyToken("TST-0042", "user@example.com", token, process.env.REPLY_SECRET);
 */
export function generateReplyToken(ticketId: string, reporterEmail: string, secret: string): string {
  const message = `${ticketId.toUpperCase()}:${reporterEmail.toLowerCase()}`;
  let hash = 5381;
  const combined = message + ":" + secret;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) + hash) ^ combined.charCodeAt(i);
    hash = hash >>> 0;
  }
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
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}
