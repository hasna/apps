// Test-only negative control: a textual suffix replacement can be a no-op or
// change only unused base64url pad bits. Flip decoded HMAC bytes instead.
export function tamperApiKeySignature(token: string): string {
  const separator = token.lastIndexOf(".");
  const signature = Buffer.from(token.slice(separator + 1), "base64url");
  if (separator < 0 || signature.length !== 32) {
    throw new Error("Expected a 32-byte API-key signature fixture.");
  }
  signature[0] = signature[0]! ^ 1;
  return `${token.slice(0, separator + 1)}${signature.toString("base64url")}`;
}
