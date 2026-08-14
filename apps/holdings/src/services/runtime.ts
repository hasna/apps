import type { Database } from "bun:sqlite";
import type { Asset } from "../types/index.js";
import { NotFoundError } from "../types/index.js";
import { getAsset, getEntity } from "../db/crud.js";
import {
  authorize,
  SYSTEM_AUTHORIZATION_CONTEXT,
  type AuthorizationAction,
  type AuthorizationContext,
} from "./authorization.js";

// Shared service runtime: every CLI/MCP/API surface builds a ServiceContext and
// calls the same service functions, so the three surfaces stay at interface parity.

export interface ServiceContext {
  db: Database;
  auth: AuthorizationContext;
}

export function systemContext(db: Database): ServiceContext {
  return { db, auth: SYSTEM_AUTHORIZATION_CONTEXT };
}

/** Resolve an asset or throw NotFound; used to derive the anchoring entity_id. */
export function requireAsset(ctx: ServiceContext, assetId: string): Asset {
  const asset = getAsset(ctx.db, assetId);
  if (!asset) throw new NotFoundError("asset", assetId);
  return asset;
}

/** Authorize an action against the entity that owns the given asset (§1c). */
export function authorizeAsset(ctx: ServiceContext, action: AuthorizationAction, asset: Asset, resource: string): void {
  authorize(action, ctx.auth, { entity_id: asset.entity_id, resource });
}

/** Authorize an action scoped to an explicit entity (deny by default). */
export function authorizeEntity(ctx: ServiceContext, action: AuthorizationAction, entityId: string, resource: string): void {
  authorize(action, ctx.auth, { entity_id: entityId, resource });
}

/** Ensure the entity reference exists in the local cache. */
export function requireEntity(ctx: ServiceContext, entityId: string) {
  const entity = getEntity(ctx.db, entityId);
  if (!entity) throw new NotFoundError("entity", entityId);
  return entity;
}
