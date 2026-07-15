import { timingSafeEqual } from "node:crypto";
import type { AuthorizationContext, Computer, Scope } from "./contracts";
import { ComputersError } from "./contracts";

export type AuthorizationAction =
  | "computer:read"
  | "computer:create"
  | "computer:operate"
  | "computer:delete"
  | "exec:request"
  | "install:plan"
  | "install:apply"
  | "snapshot:create"
  | "assignment:write"
  | "policy:write";

const ACTION_SCOPE: Record<AuthorizationAction, Scope> = {
  "computer:read": "computers:read",
  "computer:create": "computers:create",
  "computer:operate": "computers:operate",
  "computer:delete": "computers:admin",
  "exec:request": "computers:exec",
  "install:plan": "computers:install",
  "install:apply": "computers:install",
  "snapshot:create": "computers:snapshot",
  "assignment:write": "computers:assign",
  "policy:write": "computers:policy",
};

export class AuthorizationEngine {
  authorize(context: AuthorizationContext, action: AuthorizationAction, computer?: Computer): void {
    const admin = context.scopes.includes("computers:admin");
    const required = ACTION_SCOPE[action];
    if (!admin && !context.scopes.includes(required)) this.deny();
    if (computer !== undefined) {
      if (context.tenantId !== computer.tenantId) this.deny();
      if (!admin && context.principalId !== computer.ownerPrincipalId) this.deny();
      if (context.boundComputerId !== undefined && context.boundComputerId !== computer.id) this.deny();
      if (!admin && action !== "computer:read" && context.policyGeneration === undefined) {
        throw new ComputersError("policy_generation_mismatch", "Current policy generation is required", 403);
      }
      if (context.policyGeneration !== undefined && context.policyGeneration !== computer.policyGeneration) {
        throw new ComputersError("policy_generation_mismatch", "Authorization denied", 403);
      }
    } else if (!admin && action === "computer:create" && context.boundComputerId === undefined) {
      this.deny();
    }
  }

  private deny(): never {
    throw new ComputersError("authorization_denied", "Authorization denied", 403);
  }
}

export interface BearerPrincipal {
  tokenHash: string;
  context: AuthorizationContext;
}

export async function hashBearerToken(authValue: string): Promise<string> {
  const bytes = new TextEncoder().encode(authValue);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

export function constantTimeHashEqual(leftHex: string, rightHex: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(leftHex) || !/^[a-f0-9]{64}$/.test(rightHex)) return false;
  return timingSafeEqual(Buffer.from(leftHex, "hex"), Buffer.from(rightHex, "hex"));
}

export async function authenticateBearer(header: string | null, principals: readonly BearerPrincipal[]): Promise<AuthorizationContext> {
  if (header === null || !header.startsWith("Bearer ")) throw new ComputersError("authentication_required", "Authentication required", 401);
  const bearerValue = header.slice(7);
  if (bearerValue.length < 16 || bearerValue.length > 512) throw new ComputersError("authentication_required", "Authentication required", 401);
  const candidate = await hashBearerToken(bearerValue);
  let match: AuthorizationContext | undefined;
  for (const principal of principals) {
    if (constantTimeHashEqual(candidate, principal.tokenHash)) match = principal.context;
  }
  if (match === undefined) throw new ComputersError("authentication_required", "Authentication required", 401);
  return match;
}
