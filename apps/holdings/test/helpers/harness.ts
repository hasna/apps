import { Database } from "bun:sqlite";
import { openDatabase } from "../../src/db/database.js";
import { systemContext, type ServiceContext } from "../../src/services/runtime.js";
import { seedEntity } from "../../src/services/entities.js";
import { createAsset } from "../../src/services/assets.js";
import { registerDomainTools } from "../../src/mcp/tools/domain.js";
import { registerStorageTools } from "../../src/mcp/tools/storage.js";
import { registerStandardTools } from "../../src/mcp/tools/standard.js";
import { shouldRegisterTool } from "../../src/mcp/index.js";
import type { ApiPrincipal } from "../../src/server/auth.js";
import { LOCAL_DEV_PRINCIPAL } from "../../src/server/principal.js";

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export type CapturedHandler = (input: Record<string, unknown>) => Promise<McpToolResult>;

export function makeDb(): Database {
  return openDatabase(":memory:");
}

export function sysCtx(db: Database): ServiceContext {
  return systemContext(db);
}

export interface Fixture {
  db: Database;
  ctx: ServiceContext;
  entityId: string;
  entitySlug: string;
  assetId: string;
}

/** Seed one entity + one trademark asset. */
export function seedFixture(): Fixture {
  const db = makeDb();
  const ctx = systemContext(db);
  const entity = seedEntity(ctx, { entity_slug: "hasna-inc-us", name: "Hasna Inc (US)" });
  const asset = createAsset(ctx, {
    entity_id: entity.entity_id,
    kind: "trademark",
    name: "HASNA",
    description: "Primary word mark",
  });
  return { db, ctx, entityId: entity.entity_id, entitySlug: entity.entity_slug!, assetId: asset.id };
}

/** Capture all MCP tool handlers (domain + storage + standard) into a map. */
export function captureMcpHandlers(db: Database, principal: ApiPrincipal = LOCAL_DEV_PRINCIPAL): Map<string, CapturedHandler> {
  const handlers = new Map<string, CapturedHandler>();
  const stub = {
    tool(name: string, _desc: string, _schema: unknown, handler: CapturedHandler) {
      handlers.set(name, handler);
    },
  } as never;
  registerStandardTools(stub);
  registerStorageTools(stub, { db, principal });
  registerDomainTools(stub, { db, principal, shouldRegister: shouldRegisterTool });
  return handlers;
}

export function parseMcp<T>(result: McpToolResult): T {
  return JSON.parse(result.content[0]!.text) as T;
}
