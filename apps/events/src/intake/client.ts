import { createClientTransport, type CredentialChainOptions } from "@hasna/contracts/client";
import { INTAKE_PROTOCOL, IntakeError, boundedText, object, validateBinding, validateRequest, validateReceipt, type IntakeBinding, type IntakeRequest, type IntakeReceipt } from "./protocol.js";
import { acceptEvent, intakeCapability, readReceipt } from "./generated.js";
export * from "./protocol.js";

/** HTTP only. No filesystem spool acknowledgment or destination auto-adoption. */
export function createIntakeClient(options: { binding: IntakeBinding; tenantId: string; env?: Record<string, string | undefined>; credentials?: CredentialChainOptions }) {
  const binding = Object.freeze(validateBinding(options.binding));
  const tenant = boundedText(options.tenantId, 256);
  const { client } = createClientTransport("events", options.env ?? process.env, { credentials: options.credentials, retry: false, timeoutMs: 15_000 });
  const headers = { "x-events-sink-id": binding.sink_id, "x-events-producer-id": binding.producer_id, "x-events-corpus-id": binding.corpus_id, "x-events-source-authority-id": binding.source_authority_id, "x-events-tenant-id": tenant };
  return {
    async capability(): Promise<void> {
      const r = object(await intakeCapability(client, { headers, retry: false }));
      if (r.protocol !== INTAKE_PROTOCOL || r.tenant_id !== tenant || JSON.stringify(validateBinding(r)) !== JSON.stringify(binding) || typeof r.kid !== "string" || !r.kid) throw new IntakeError("intake_capability_mismatch", 502);
    },
    async accept(raw: IntakeRequest, signal?: AbortSignal): Promise<IntakeReceipt> {
      const request = Object.freeze({ ...validateRequest(raw) });
      if (JSON.stringify(validateBinding(request)) !== JSON.stringify(binding)) throw new IntakeError("client_binding_mismatch");
      // No automatic POST retry. Ambiguous network outcomes keep the producer's
      // checkpoint pending; callers read back or replay this same frozen request.
      const response = await acceptEvent(client, request, { headers, retry: false, signal });
      return validateReceipt(response, request, tenant);
    },
    async receipt(raw: IntakeRequest, signal?: AbortSignal): Promise<IntakeReceipt> {
      const request = Object.freeze({ ...validateRequest(raw) });
      if (JSON.stringify(validateBinding(request)) !== JSON.stringify(binding)) throw new IntakeError("client_binding_mismatch");
      const response = await readReceipt(client, { headers, query: { event_id: request.event_id }, retry: false, signal });
      return validateReceipt(response, request, tenant);
    },
  };
}
