import { createHash } from "node:crypto";
import { planRoundtrip, type RoundtripItem } from "../../lib/roundtrip-plan.js";
import { canonicalSender } from "../../lib/email-address.js";
import {
  normalizeDomainDns,
  type DomainDnsInput,
  type DomainDnsResult,
} from "./domain-dns.js";
import type { DomainDnsBinding } from "./domain-dns-provider.js";

export class ProvisionUpError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export interface ProvisionUpInput {
  domain: string;
  provider_id: string;
  addresses: string[];
  test_count: number;
  add_mx: boolean;
  force_mx_switch: boolean;
  bucket?: string;
  source_id?: string;
}
export interface BoundProvisionUpInput extends ProvisionUpInput {
  provider_type: "ses";
  provider_region: string | null;
  dns_binding: DomainDnsBinding;
}
export interface ProvisionUpReceipt {
  phase: "dns" | "addresses" | "roundtrip" | "complete";
  binding_generation?: string | null;
  binding_history?: string[];
  address_cursor: number;
  dns: DomainDnsResult | null;
  addresses: Record<
    string,
    {
      id: string;
      status: string;
      receipt: {
        ready: boolean;
        code: string;
        message: string;
        checked_at: string;
      } | null;
    }
  >;
  roundtrip: {
    run_id: string;
    items: RoundtripItem[];
    poll_cursor: number;
    poll_pass: number;
    sync_cursor?: string | null;
    preflight: boolean;
  };
  next_attempt_ms: number;
  complete: boolean;
  delivery_tested: boolean;
  errors: Array<{ code: string; at: string }>;
}
export interface ProvisionUpJob {
  id: string;
  input_hash: string;
  input: BoundProvisionUpInput;
  status: "pending" | "processing" | "blocked" | "ready";
  lease: string | null;
  receipt: ProvisionUpReceipt | null;
  created_at: string;
  updated_at: string;
}
export interface ProvisionUpDeps {
  now?: () => number;
  store: {
    claim(id: string): Promise<ProvisionUpJob | null>;
    get(id: string): Promise<ProvisionUpJob | null>;
    assertCurrent(job: ProvisionUpJob): Promise<void>;
    save(
      job: ProvisionUpJob,
      receipt: ProvisionUpReceipt,
      status: ProvisionUpJob["status"],
    ): Promise<ProvisionUpJob>;
  };
  guard?: (
    input: BoundProvisionUpInput,
    claim: ProvisionUpJob,
  ) => Promise<void>;
  bindingGeneration?: () => Promise<string>;
  dns(input: BoundProvisionUpInput): Promise<DomainDnsResult>;
  address(
    input: BoundProvisionUpInput,
    email: string,
    key: string,
  ): Promise<ProvisionUpReceipt["addresses"][string]>;
  send(item: RoundtripItem, input: BoundProvisionUpInput): Promise<Response>;
  read(item: RoundtripItem): Promise<
    Array<{
      id: string;
      from_address: string;
      subject: string | null;
      text_body: string | null;
      received_at: string;
    }>
  >;
  sync?: (
    input: BoundProvisionUpInput,
    cursor?: string | null,
  ) => Promise<string | null>;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const upHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export function normalizeProvisionUp(
  body: Record<string, unknown>,
): ProvisionUpInput {
  if (
    body.buy_if_needed !== undefined ||
    body.purchase_profile !== undefined ||
    body.profile !== undefined
  )
    throw new ProvisionUpError(
      "Provision up configures an already-owned domain. Complete registration with the Domains registrar commands, then configure the server binding. Client AWS profiles and purchases are not supported here.",
      400,
    );
  if (
    Object.keys(body).some(
      (key) =>
        ![
          "domain",
          "provider_id",
          "addresses",
          "count",
          "test",
          "bucket",
          "source_id",
          "add_mx",
          "force_mx_switch",
          "dry_run",
          "idempotency_key",
        ].includes(key),
    )
  )
    throw new ProvisionUpError("Unknown provisioning option.", 400);
  for (const key of ["test", "add_mx", "force_mx_switch", "dry_run"])
    if (body[key] !== undefined && typeof body[key] !== "boolean")
      throw new ProvisionUpError(`${key} must be boolean.`, 400);
  const count =
    body.count === undefined
      ? 1
      : typeof body.count === "number"
        ? body.count
        : typeof body.count === "string" && /^\d+$/.test(body.count)
          ? Number(body.count)
          : NaN;
  if (!Number.isSafeInteger(count) || count < 0 || count > 100)
    throw new ProvisionUpError("Count must be between 0 and 100.", 400);
  if (body.addresses !== undefined && typeof body.addresses !== "string")
    throw new ProvisionUpError(
      "Addresses must be comma-separated local parts.",
      400,
    );
  try {
    const dns = normalizeDomainDns(
      {
        domain: body.domain,
        provider_id: body.provider_id,
        add_mx: body.add_mx ?? false,
        force_mx_switch: body.force_mx_switch ?? false,
      },
      "provision_domain",
    );
    const plan = planRoundtrip({
      domain: dns.domain,
      provider: dns.provider_id,
      addresses: body.addresses as string | undefined,
      count: Math.max(1, count),
      bucket: body.bucket as string | undefined,
      source: body.source_id as string | undefined,
      idempotencyKey: "validate",
    });
    return {
      domain: dns.domain,
      provider_id: dns.provider_id,
      addresses: [
        ...new Set(plan.items.map((item) => item.from.split("@")[0]!)),
      ],
      test_count: body.test === false ? 0 : count,
      add_mx: dns.add_mx,
      force_mx_switch: dns.force_mx_switch,
      ...(body.bucket !== undefined ? { bucket: String(body.bucket) } : {}),
      ...(body.source_id !== undefined
        ? { source_id: String(body.source_id) }
        : {}),
    };
  } catch (error) {
    throw new ProvisionUpError(
      error instanceof Error ? error.message : "Invalid provisioning input.",
      400,
    );
  }
}
export const upDnsInput = (input: ProvisionUpInput): DomainDnsInput =>
  normalizeDomainDns(
    {
      domain: input.domain,
      provider_id: input.provider_id,
      add_mx: input.add_mx,
      force_mx_switch: input.force_mx_switch,
    },
    "provision_domain",
  );
export function newProvisionUpReceipt(
  input: BoundProvisionUpInput,
  id: string,
): ProvisionUpReceipt {
  const run_id = `up:${id}`;
  return {
    phase: "dns",
    address_cursor: 0,
    dns: null,
    addresses: {},
    roundtrip: {
      run_id,
      items: input.test_count
        ? planRoundtrip({
            domain: input.domain,
            provider: input.provider_id,
            addresses: input.addresses.join(","),
            count: input.test_count,
            idempotencyKey: run_id,
          }).items
        : [],
      poll_cursor: 0,
      poll_pass: 0,
      preflight: false,
    },
    next_attempt_ms: 0,
    complete: false,
    delivery_tested: false,
    errors: [],
  };
}
/** One bounded step per claim. Every network action runs outside a database transaction. */
export async function advanceProvisionUp(
  id: string,
  deps: ProvisionUpDeps,
): Promise<ProvisionUpJob> {
  const claim = await deps.store.claim(id);
  if (!claim) {
    const existing = await deps.store.get(id);
    if (!existing)
      throw new ProvisionUpError("Provisioning run not found.", 404);
    return existing;
  }
  const receipt = structuredClone(
    claim.receipt ?? newProvisionUpReceipt(claim.input, id),
  );
  const now = deps.now ?? Date.now;
  const guard = async () => {
    await deps.store.assertCurrent(claim);
    await deps.guard?.(claim.input, claim);
  };
  const save = (status: ProvisionUpJob["status"], delay = 0) => {
    receipt.next_attempt_ms = now() + delay;
    return deps.store.save(claim, receipt, status);
  };
  const block = (code: string) => {
    receipt.complete = false;
    receipt.errors = [
      ...receipt.errors.slice(-19),
      { code, at: new Date(now()).toISOString() },
    ];
    return save("blocked");
  };
  try {
    await guard();
    if (deps.bindingGeneration) {
      const generation = await deps.bindingGeneration();
      if (
        receipt.binding_generation &&
        receipt.binding_generation !== generation
      )
        return block("provider_binding_changed");
      if (!receipt.binding_generation) {
        receipt.binding_generation = generation;
        receipt.binding_history = [
          ...(receipt.binding_history ?? []).slice(-19),
          generation,
        ];
        await save("processing");
      }
    }
    if (receipt.phase === "dns") {
      receipt.dns = await deps.dns(claim.input);
      await guard();
      if (receipt.dns.job.status === "blocked") return block("dns_blocked");
      if (
        receipt.dns.job.status !== "verified" ||
        !receipt.dns.job.dns_published ||
        !receipt.dns.job.verified_for_sending
      )
        return await save("pending", 30000);
      receipt.phase = "addresses";
      return await save("pending");
    }
    if (receipt.phase === "addresses") {
      const local = claim.input.addresses[receipt.address_cursor];
      if (local) {
        const email = `${local}@${claim.input.domain}`,
          key = `up-address:${upHash([id, email])}`;
        const address = await deps.address(claim.input, email, key);
        receipt.addresses[email] = address;
        await guard();
        if (address.status !== "ready" || !address.receipt?.ready)
          return block("address_not_ready");
        receipt.address_cursor++;
        return await save("pending");
      }
      receipt.phase = "roundtrip";
    }
    if (receipt.phase === "roundtrip") {
      const items = receipt.roundtrip.items;
      if (!items.length || items.every((item) => item.state === "received")) {
        receipt.phase = "complete";
        receipt.complete = true;
        receipt.delivery_tested = items.length > 0;
        return await save("ready");
      }
      if (!receipt.roundtrip.preflight) {
        await deps.read(items[0]!);
        if (deps.sync)
          receipt.roundtrip.sync_cursor = await deps.sync(
            claim.input,
            receipt.roundtrip.sync_cursor,
          );
        await guard();
        receipt.roundtrip.preflight = true;
        return await save("pending");
      }
      const item = items.find((row) =>
        ["not_attempted", "uncertain", "failed"].includes(row.state),
      );
      if (item) {
        item.state = "uncertain";
        await save("processing"); // acceptance may occur before any response is available
        await guard();
        const response = await deps.send(item, claim.input);
        const body = (await response.json()) as {
          sent?: boolean;
          in_progress?: boolean;
          message?: { id?: string; send_state?: string };
          idempotent_replay?: boolean;
        };
        await guard();
        if (
          !response.ok ||
          body.sent !== true ||
          body.in_progress === true ||
          body.message?.send_state !== "sent" ||
          !body.message.id
        )
          return block("send_unconfirmed");
        item.state = "sent";
        item.outbound_id = body.message.id;
        item.replayed = body.idempotent_replay === true;
        delete item.error;
        return await save("pending", 1100);
      }
      if (receipt.roundtrip.poll_pass >= 60) return block("receipt_timeout");
      if (receipt.roundtrip.poll_cursor === 0 && deps.sync)
        receipt.roundtrip.sync_cursor = await deps.sync(
          claim.input,
          receipt.roundtrip.sync_cursor,
        );
      const waiting = items[receipt.roundtrip.poll_cursor]!;
      if (waiting.state === "sent") {
        const rows = await deps.read(waiting);
        const match = rows.find(
          (row) =>
            row.subject === waiting.subject &&
            canonicalSender(row.from_address) === waiting.from &&
            row.text_body?.trim() === waiting.token,
        );
        if (match) {
          waiting.state = "received";
          waiting.inbound_id = match.id;
          waiting.received_at = match.received_at;
        }
      }
      await guard();
      receipt.roundtrip.poll_cursor++;
      if (receipt.roundtrip.poll_cursor >= items.length) {
        receipt.roundtrip.poll_cursor = 0;
        receipt.roundtrip.poll_pass++;
      }
      return await save(
        "pending",
        receipt.roundtrip.poll_cursor === 0 ? 10000 : 0,
      );
    }
    return block("invalid_phase");
  } catch {
    // Do not persist raw SDK errors: they may contain request headers or provider secrets.
    // A lost lease cannot overwrite a newer worker's checkpoint.
    return block("step_unconfirmed");
  }
}
