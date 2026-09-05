import type { IngestionSourceInventoryRepository } from "../store/repositories.js";
import type { IngestionSourceInventoryRow } from "../store/records.js";
import { validateSelfHostedSdkSuccessResponse } from "../lib/self-hosted-wire.js";
import { EmailsApiFault, ok, refusalForStatus } from "./outcome.js";
import type { Transport } from "./wire.js";

/** This endpoint returns private fields too: validate the DTO, then construct a projection. */
export function createSourceInventoryRepository(transport: Transport): IngestionSourceInventoryRepository {
  return {
    async list(opts = {}) {
      let response;
      try {
        response = await transport.request("GET", "/sources", { query: { limit: opts.limit, offset: opts.offset } });
      } catch (error) {
        const status = error instanceof EmailsApiFault ? error.status : 0;
        throw new EmailsApiFault(status, "The source inventory transport failed.");
      }
      if (response.status !== 200) {
        // Only these existing discriminators affect the refusal/fault distinction.
        // Remote prose, extra fields, source identities and URLs never reach errors.
        const body = response.body;
        const fields = body !== null && typeof body === "object" ? body as { reason?: unknown; code?: unknown } : {};
        const reason = typeof fields.reason === "string" ? fields.reason : fields.code;
        const safeReason = typeof reason === "string" && ["no_tenant", "apikey_required", "session_required", "ambiguous_id"].includes(reason)
          ? reason : undefined;
        return refusalForStatus(response.status, { reason: safeReason }, "source inventory");
      }
      try {
        validateSelfHostedSdkSuccessResponse("GET", "/v1/sources", response.status, response.body);
        const rows = (response.body as { items: IngestionSourceInventoryRow[] }).items;
        if (rows.some(row => !row.id.trim())) throw new Error("invalid identity");
        return ok(rows.map(row => ({ id: row.id, status: row.status, last_synced_at: row.last_synced_at })));
      } catch {
        // Validator details can contain remote property names; never forward them.
        throw new EmailsApiFault(200, "The source inventory response is invalid.");
      }
    },
  };
}
