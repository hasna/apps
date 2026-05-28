/**
 * MCP resource snapshots and subscription tracking — local-only, deterministic URIs.
 */

import { listTasks, getTasksChangedSince } from "../db/tasks.js";
import { listProjects } from "../db/projects.js";
import { listPlans } from "../db/plans.js";
import { listAgents } from "../db/agents.js";
import { listVerificationRecords } from "./verification-providers.js";

export const RESOURCE_SNAPSHOT_VERSION = "todos.resource-snapshot.v1";
export const DEFAULT_STALE_MS = 5 * 60 * 1000;

export const RESOURCE_URIS = [
  "todos://tasks",
  "todos://projects",
  "todos://plans",
  "todos://agents",
  "todos://verification",
] as const;

export type ResourceUri = (typeof RESOURCE_URIS)[number] | `todos://task/${string}`;

export interface ResourceSnapshot {
  schema_version: typeof RESOURCE_SNAPSHOT_VERSION;
  uri: ResourceUri;
  generated_at: string;
  stale_after: string;
  content: unknown;
  content_hash: string;
}

export interface ResourceSubscription {
  uri: ResourceUri;
  agent_id?: string;
  subscribed_at: string;
  last_notified_at?: string;
}

const subscriptions = new Map<string, ResourceSubscription>();

function hashContent(content: unknown): string {
  const data = JSON.stringify(content);
  let h = 0;
  for (let i = 0; i < data.length; i++) h = ((h << 5) - h + data.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16);
}

export function buildResourceSnapshot(uri: ResourceUri, staleMs = DEFAULT_STALE_MS): ResourceSnapshot {
  const generatedAt = new Date();
  let content: unknown;

  switch (uri) {
    case "todos://tasks":
      content = listTasks({ limit: 500 });
      break;
    case "todos://projects":
      content = listProjects();
      break;
    case "todos://plans":
      content = listPlans();
      break;
    case "todos://agents":
      content = listAgents();
      break;
    case "todos://verification":
      content = listVerificationRecords({ limit: 100 });
      break;
    default:
      if (uri.startsWith("todos://task/")) {
        const id = uri.replace("todos://task/", "");
        content = listTasks({ limit: 1 }).filter((t) => t.id.startsWith(id) || t.short_id === id);
      } else {
        throw new Error(`Unknown resource URI: ${uri}`);
      }
  }

  return {
    schema_version: RESOURCE_SNAPSHOT_VERSION,
    uri,
    generated_at: generatedAt.toISOString(),
    stale_after: new Date(generatedAt.getTime() + staleMs).toISOString(),
    content,
    content_hash: hashContent(content),
  };
}

export function isSnapshotStale(snapshot: ResourceSnapshot, now = new Date()): boolean {
  return now.toISOString() > snapshot.stale_after;
}

export function subscribeResource(uri: ResourceUri, agentId?: string): ResourceSubscription {
  const key = `${uri}:${agentId || "*"}`;
  const sub: ResourceSubscription = {
    uri,
    agent_id: agentId,
    subscribed_at: new Date().toISOString(),
  };
  subscriptions.set(key, sub);
  return sub;
}

export function unsubscribeResource(uri: ResourceUri, agentId?: string): boolean {
  return subscriptions.delete(`${uri}:${agentId || "*"}`);
}

export function listSubscriptions(agentId?: string): ResourceSubscription[] {
  return [...subscriptions.values()].filter((s) => !agentId || s.agent_id === agentId || !s.agent_id);
}

export function getChangedResourcesSince(since: string): { uri: ResourceUri; changed_count: number }[] {
  const changed = getTasksChangedSince(since);
  const results: { uri: ResourceUri; changed_count: number }[] = [];
  if (changed.length > 0) {
    results.push({ uri: "todos://tasks", changed_count: changed.length });
  }
  return results;
}

export function resetSubscriptions(): void {
  subscriptions.clear();
}

export function resourceDiagnostics(): {
  subscriptions: number;
  uris: readonly string[];
  snapshot_version: string;
} {
  return {
    subscriptions: subscriptions.size,
    uris: RESOURCE_URIS,
    snapshot_version: RESOURCE_SNAPSHOT_VERSION,
  };
}
