import { createHash, randomUUID } from "node:crypto";
import { domainToASCII } from "node:url";
import { canonicalSender } from "./email-address.js";
export interface RoundtripOptions {
  domain: string;
  provider: string;
  addresses?: string;
  count?: string | number;
  pollAttempts?: string | number;
  pollInterval?: string | number;
  throttle?: string | number;
  idempotencyKey?: string;
  source?: string;
  bucket?: string;
  syncCursor?: string;
  profile?: string;
}
export interface RoundtripItem {
  from: string;
  to: string;
  subject: string;
  token: string;
  send_key: string;
  state: "not_attempted" | "sent" | "received" | "uncertain" | "failed";
  outbound_id?: string;
  inbound_id?: string;
  received_at?: string;
  replayed?: boolean;
  error?: string;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function integer(
  value: string | number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const number =
    value === undefined
      ? fallback
      : typeof value === "number"
        ? value
        : /^\d+$/.test(value)
          ? Number(value)
          : NaN;
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return number;
}
export function planRoundtrip(options: RoundtripOptions) {
  if (options.profile !== undefined)
    throw new Error(
      "AWS profiles are server-owned. Configure the Emails API ingest binding; use --source to select it.",
    );
  for (const [name, value, max] of [
    ["source", options.source, 256],
    ["bucket", options.bucket, 63],
    ["sync cursor", options.syncCursor, 4096],
  ] as const) {
    if (
      value !== undefined &&
      (!value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    )
      throw new Error(`Invalid ${name}.`);
  }
  if (
    options.syncCursor !== undefined &&
    options.source === undefined &&
    options.bucket === undefined
  )
    throw new Error("A sync cursor requires --source or --bucket.");
  const domain = domainToASCII(options.domain.trim().toLowerCase());
  if (!domain.includes(".") || !canonicalSender(`roundtrip@${domain}`))
    throw new Error("A valid roundtrip domain is required.");
  if (
    !options.provider?.trim() ||
    options.provider.length > 256 ||
    /[\x00-\x1f\x7f]/.test(options.provider)
  )
    throw new Error("A provider ID is required.");
  const addresses = (options.addresses ?? "one,two,three")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  if (
    addresses.length < 2 ||
    addresses.length > 20 ||
    new Set(addresses).size !== addresses.length ||
    addresses.some(
      (value) =>
        value.includes("@") ||
        canonicalSender(`${value}@${domain}`) !== `${value}@${domain}`,
    )
  )
    throw new Error(
      "Choose 2–20 distinct valid local parts on the roundtrip domain.",
    );
  const count = integer(options.count, 16, 1, 100, "Count");
  if (addresses.length * count > 500)
    throw new Error("A roundtrip run is limited to 500 messages.");
  const attempts = integer(options.pollAttempts, 12, 1, 120, "Poll attempts");
  const pollInterval = integer(
    options.pollInterval,
    10000,
    0,
    60000,
    "Poll interval",
  );
  const throttle = integer(options.throttle, 1100, 0, 60000, "Throttle");
  const runId = options.idempotencyKey ?? randomUUID();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runId))
    throw new Error(
      "Idempotency key must contain 1–128 letters, digits, dots, colons, underscores or hyphens.",
    );
  const items: RoundtripItem[] = [];
  for (let round = 0; round < count; round++)
    for (let index = 0; index < addresses.length; index++) {
      const from = `${addresses[index]}@${domain}`,
        to = `${addresses[(index + 1) % addresses.length]}@${domain}`;
      const slot = round * addresses.length + index;
      const token = `EMAILS_ROUNDTRIP_${hash(`${runId}:${slot}:${domain}:${from}:${to}`).slice(0, 40)}`;
      items.push({
        from,
        to,
        subject: `[Emails roundtrip] ${token}`,
        token,
        send_key: `roundtrip:${hash(`${runId}:${slot}`)}`,
        state: "not_attempted",
      });
    }
  return {
    runId,
    provider: options.provider.trim(),
    attempts,
    pollInterval,
    throttle,
    items,
  };
}
