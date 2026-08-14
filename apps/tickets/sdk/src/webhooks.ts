/**
 * Verify a webhook signature from open-tickets.
 * The X-Tickets-Signature header contains "sha256=<hmac-hex>".
 *
 * @example
 * app.post('/webhook', async (req, res) => {
 *   const sig = req.headers['x-tickets-signature'];
 *   const valid = await verifyWebhookSignature(req.body, sig, process.env.WEBHOOK_SECRET);
 *   if (!valid) return res.status(401).send('Invalid signature');
 * });
 */
export async function verifyWebhookSignature(
  payload: string | Uint8Array,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!signature.startsWith("sha256=")) return false;
  const expected = signature.slice(7);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const data = typeof payload === "string" ? encoder.encode(payload) : payload;
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
