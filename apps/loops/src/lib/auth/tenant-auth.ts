import { randomUUID } from "node:crypto";
import {
  extractToken,
  hashToken,
  hasAllScopes,
  verifyApiKeyToken,
  type ApiKeyClaims,
} from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../../generated/storage-kit/query.js";
import type { RoutePolicy, TenantRole, TokenKind } from "./route-policy.js";

interface BoundKeyRow extends Record<string, unknown> {
  kid: string;
  app: string;
  agent: string | null;
  scopes: unknown;
  token_hash: string;
  issued_at: string | Date;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
  disabled_at: string | Date | null;
  tenant_id: string;
  tenant_status: string;
  principal_id: string;
  principal_status: string;
  membership_status: string;
  token_kind: TokenKind;
  roles: TenantRole[];
}

export interface TenantAuthContext {
  tenantId: string;
  principalId: string;
  requestId: string;
  kid: string;
  agent: string | null;
  scopes: string[];
  roles: TenantRole[];
  tokenKind: TokenKind;
  claims: ApiKeyClaims;
}

export type TenantAuthDecision =
  | { ok: true; status: 200; principal: TenantAuthContext }
  | { ok: false; status: 401 | 403 | 503; reason: string; message: string; requestId: string };

function scopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).sort();
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).sort() : [];
    } catch {
      return [];
    }
  }
  return [];
}

function epoch(value: string | Date | null): number | null {
  return value === null ? null : Math.floor(new Date(value).getTime() / 1000);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\n") === [...right].sort().join("\n");
}

function requestId(headers: Headers): string {
  const supplied = headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

export class TenantApiAuthenticator {
  constructor(
    private readonly client: TypedQueryClient,
    private readonly signingSecret: string | Buffer,
    private readonly now: () => number = Date.now,
  ) {}

  async authenticate(
    headers: Headers,
    context: { method: string; path: string; policy: RoutePolicy },
  ): Promise<TenantAuthDecision> {
    const id = requestId(headers);
    const token = extractToken(headers);
    if (!token) return this.deny(id, context, 401, "missing_token");

    const verified = verifyApiKeyToken(token, {
      signingSecret: this.signingSecret,
      expectedApp: "loops",
      nowMs: this.now(),
    });
    if (!verified.ok) {
      return this.deny(id, context, verified.reason === "insufficient_scope" ? 403 : 401, verified.reason);
    }

    const tokenHash = hashToken(token);
    const row = await this.client.get<BoundKeyRow>(
      "SELECT * FROM public.open_loops_authenticate_key($1, $2)",
      [verified.kid, tokenHash],
    );
    if (!row) return this.deny(id, context, 401, "unbound_key");

    const persistedScopes = scopes(row.scopes);
    const recordMismatch =
      row.kid !== verified.kid ||
      row.app !== verified.app ||
      row.token_hash !== tokenHash ||
      verified.claims.agent !== row.principal_id ||
      row.agent !== row.principal_id ||
      !sameStrings(persistedScopes, verified.claims.scopes) ||
      epoch(row.issued_at) !== verified.claims.iat ||
      epoch(row.expires_at) !== verified.claims.exp;
    if (recordMismatch) return this.deny(id, context, 401, "key_record_mismatch", row);
    if (row.revoked_at) return this.deny(id, context, 401, "revoked", row);
    if (row.disabled_at) return this.deny(id, context, 401, "disabled", row);
    if (row.expires_at && new Date(row.expires_at).getTime() <= this.now()) return this.deny(id, context, 401, "expired", row);
    if (row.tenant_status !== "active") return this.deny(id, context, 403, "tenant_suspended", row);
    if (row.principal_status !== "active") return this.deny(id, context, 403, "principal_suspended", row);
    if (row.membership_status !== "active") return this.deny(id, context, 403, "membership_suspended", row);
    if (!context.policy.tokenKinds.includes(row.token_kind)) return this.deny(id, context, 403, "wrong_token_kind", row);
    if (!hasAllScopes(persistedScopes, context.policy.scopes)) return this.deny(id, context, 403, "insufficient_scope", row);
    if (!row.roles.some((role) => context.policy.roles.includes(role))) return this.deny(id, context, 403, "insufficient_role", row);

    const principal: TenantAuthContext = {
      tenantId: row.tenant_id,
      principalId: row.principal_id,
      requestId: id,
      kid: row.kid,
      agent: row.agent,
      scopes: persistedScopes,
      roles: row.roles,
      tokenKind: row.token_kind,
      claims: verified.claims,
    };
    try {
      await this.audit(id, context, "allow", null, row);
    } catch {
      return { ok: false, status: 503, reason: "audit_unavailable", message: "Authentication audit unavailable.", requestId: id };
    }
    return { ok: true, status: 200, principal };
  }

  private async deny(
    id: string,
    context: { method: string; path: string; policy: RoutePolicy },
    status: 401 | 403,
    reason: string,
    row?: BoundKeyRow,
  ): Promise<TenantAuthDecision> {
    try {
      await this.audit(id, context, "deny", reason, row);
    } catch {
      return { ok: false, status: 503, reason: "audit_unavailable", message: "Authentication audit unavailable.", requestId: id };
    }
    return { ok: false, status, reason, message: status === 401 ? "Authentication required." : "Forbidden.", requestId: id };
  }

  private async audit(
    id: string,
    context: { method: string; path: string; policy: RoutePolicy },
    decision: "allow" | "deny",
    reason: string | null,
    row?: BoundKeyRow,
  ): Promise<void> {
    await this.client.execute(
      "SELECT public.open_loops_append_auth_audit($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      [
        randomUUID(),
        row?.kid ?? null,
        row?.token_hash ?? null,
        id,
        context.policy.operationId,
        decision,
        reason,
        JSON.stringify({
          method: context.method,
          path: context.path,
          risk: context.policy.risk,
          requiredScopes: context.policy.scopes,
          tokenKind: row?.token_kind ?? null,
          kid: row?.kid ?? null,
        }),
      ],
    );
  }
}
