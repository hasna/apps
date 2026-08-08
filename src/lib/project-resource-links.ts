import type {
  ProjectResourceAuthority,
  ProjectResourceLink,
  ProjectResourceLinkInput,
  ProjectResourceLinkLabels,
  ProjectResourceLinkRow,
  ProjectResourceLinkSnapshot,
  ProjectResourceTargetKind,
  Workspace,
  WorkspaceIntegrations,
} from "../types/workspace.js";
import {
  PROJECT_RESOURCE_AUTHORITIES,
  PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
} from "../types/workspace.js";
import { canonicalJson, sha256 } from "./guarded-project-mutation.js";

export type { ProjectResourceLinkInput } from "../types/workspace.js";
export { PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS } from "../types/workspace.js";

const SOURCE_PACKAGE_BY_AUTHORITY: Record<ProjectResourceAuthority, string> = {
  todos: "@hasna/todos",
  conversations: "@hasna/conversations",
  knowledge: "@hasna/knowledge",
  mementos: "@hasna/mementos",
  orgs: "@hasna/orgs",
  contacts: "@hasna/contacts",
};

const TARGET_KINDS_BY_AUTHORITY: Record<ProjectResourceAuthority, readonly ProjectResourceTargetKind[]> = {
  todos: ["project", "task_list", "plan"],
  conversations: ["project", "channel"],
  knowledge: ["collection", "item"],
  mementos: ["project", "item"],
  orgs: ["org", "project"],
  contacts: ["contact"],
};

const LINK_FIELDS = new Set([
  "authority",
  "service_instance",
  "source_package",
  "target_kind",
  "locator",
  "scope",
  "labels",
]);
const LOCATOR_FIELDS = new Set(["kind", "value"]);
const LABEL_FIELDS = new Set(["name", "channel_name", "path", "tags"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVERSATIONS_CHANNEL_ID_RE = /^chn_[0-9a-f]{32}$/;
const URN_RE = /^urn:[a-z0-9][a-z0-9-]{0,31}:[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/;

export function projectResourceLinkConversationsChannelLocatorKind(
  value: string,
): "external_uuid" | "conversations_channel_id" | null {
  if (UUID_RE.test(value)) return "external_uuid";
  if (CONVERSATIONS_CHANNEL_ID_RE.test(value)) return "conversations_channel_id";
  return null;
}

function assertClosedObject(value: object, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field '${key}'`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function canonicalUri(value: string, label: string): string {
  if (URN_RE.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a canonical https URI or URN`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be a non-secret canonical https URI or URN`);
  }
  if (url.search || url.hash) throw new Error(`${label} must not contain query or fragment components`);
  return url.toString();
}

function normalizeLabels(value: unknown): ProjectResourceLinkLabels {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("resource link labels must be an object");
  }
  assertClosedObject(value, LABEL_FIELDS, "resource link labels");
  const raw = value as Record<string, unknown>;
  const labels: ProjectResourceLinkLabels = {};
  if (raw["name"] !== undefined) labels.name = requiredString(raw["name"], "resource link labels.name");
  if (raw["channel_name"] !== undefined) labels.channel_name = requiredString(raw["channel_name"], "resource link labels.channel_name");
  if (raw["path"] !== undefined) labels.path = requiredString(raw["path"], "resource link labels.path");
  if (raw["tags"] !== undefined) {
    if (!Array.isArray(raw["tags"]) || raw["tags"].some((tag) => typeof tag !== "string")) {
      throw new Error("resource link labels.tags must be an array of strings");
    }
    labels.tags = [...new Set((raw["tags"] as string[]).map((tag) => tag.trim()).filter(Boolean))].sort();
  }
  return labels;
}

export function normalizeProjectResourceLink(input: ProjectResourceLinkInput): ProjectResourceLinkInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("resource link must be an object");
  assertClosedObject(input, LINK_FIELDS, "resource link");
  if (!PROJECT_RESOURCE_AUTHORITIES.includes(input.authority)) {
    throw new Error("resource link authority is unsupported");
  }
  const authority = input.authority;
  const serviceInstance = canonicalUri(requiredString(input.service_instance, "resource link service_instance"), "resource link service_instance");
  const expectedPackage = SOURCE_PACKAGE_BY_AUTHORITY[authority];
  if (input.source_package !== expectedPackage) {
    throw new Error(`resource link source_package for ${authority} must be ${expectedPackage}`);
  }
  if (!TARGET_KINDS_BY_AUTHORITY[authority].includes(input.target_kind)) {
    throw new Error(`resource link target_kind '${input.target_kind}' is not valid for ${authority}`);
  }
  if (!input.locator || typeof input.locator !== "object" || Array.isArray(input.locator)) {
    throw new Error("resource link locator must be an object");
  }
  assertClosedObject(input.locator, LOCATOR_FIELDS, "resource link locator");
  const locatorValue = requiredString(input.locator.value, "resource link locator.value");
  let normalizedLocatorValue: string;
  if (input.locator.kind === "external_uuid") {
    if (projectResourceLinkConversationsChannelLocatorKind(locatorValue) !== "external_uuid") {
      throw new Error("resource link external_uuid must be a complete UUID");
    }
    normalizedLocatorValue = locatorValue.toLowerCase();
  } else if (input.locator.kind === "canonical_uri") {
    normalizedLocatorValue = canonicalUri(locatorValue, "resource link canonical_uri");
  } else if (input.locator.kind === "conversations_channel_id") {
    if (
      projectResourceLinkConversationsChannelLocatorKind(locatorValue)
      !== "conversations_channel_id"
    ) {
      throw new Error("resource link conversations channel ID must match chn_<32hex>");
    }
    normalizedLocatorValue = locatorValue.toLowerCase();
  } else {
    throw new Error(
      "resource link locator.kind must be external_uuid, canonical_uri, or conversations_channel_id",
    );
  }
  const locator = {
    kind: input.locator.kind,
    value: normalizedLocatorValue,
  };
  if (input.scope !== "resource" && input.scope !== "collection") {
    throw new Error("resource link scope must be resource or collection");
  }
  const labels = normalizeLabels(input.labels);
  if (
    locator.kind === "conversations_channel_id" &&
    !(authority === "conversations" && input.target_kind === "channel")
  ) {
    throw new Error(
      "resource link conversations_channel_id is only valid for Conversations channel links",
    );
  }
  if (authority === "conversations" && input.target_kind === "channel") {
    if (locator.kind !== "external_uuid" && locator.kind !== "conversations_channel_id") {
      throw new Error(
        "conversations channel links require an immutable external_uuid or conversations_channel_id",
      );
    }
    if (!labels.channel_name) {
      throw new Error("conversations channel links require labels.channel_name as mutable compatibility data");
    }
  }
  if (authority === "contacts" && input.target_kind === "contact" && locator.kind !== "external_uuid") {
    throw new Error("contacts contact links require an immutable external_uuid");
  }
  return {
    authority,
    service_instance: serviceInstance,
    source_package: expectedPackage,
    target_kind: input.target_kind,
    locator,
    scope: input.scope,
    labels,
  };
}

export function projectResourceLinkIdentity(input: ProjectResourceLinkInput): Record<string, string> {
  const link = normalizeProjectResourceLink({
    authority: input.authority,
    service_instance: input.service_instance,
    source_package: input.source_package,
    target_kind: input.target_kind,
    locator: input.locator,
    scope: input.scope,
    labels: input.labels,
  });
  return {
    authority: link.authority,
    service_instance: link.service_instance,
    source_package: link.source_package,
    target_kind: link.target_kind,
    locator_kind: link.locator.kind,
    locator_value: link.locator.value,
  };
}

export function projectResourceLinkId(projectId: string, input: ProjectResourceLinkInput): string {
  return `prl_${sha256(canonicalJson({ project_id: projectId, ...projectResourceLinkIdentity(input) })).slice(0, 36)}`;
}

export function normalizeProjectResourceLinks(inputs: readonly ProjectResourceLinkInput[]): ProjectResourceLinkInput[] {
  if (!Array.isArray(inputs)) throw new Error("resource links must be an array");
  const normalized = inputs.map(normalizeProjectResourceLink);
  const seen = new Set<string>();
  for (const link of normalized) {
    const key = canonicalJson(projectResourceLinkIdentity(link));
    if (seen.has(key)) throw new Error(`duplicate resource link identity in request: ${key}`);
    seen.add(key);
  }
  return normalized.sort((a, b) =>
    canonicalJson(projectResourceLinkIdentity(a)).localeCompare(canonicalJson(projectResourceLinkIdentity(b))),
  );
}

export function rowToProjectResourceLink(row: ProjectResourceLinkRow): ProjectResourceLink {
  return {
    id: row.id,
    project_id: row.project_id,
    authority: row.authority as ProjectResourceLink["authority"],
    service_instance: row.service_instance,
    source_package: row.source_package,
    target_kind: row.target_kind as ProjectResourceLink["target_kind"],
    locator: {
      kind: row.locator_kind as ProjectResourceLink["locator"]["kind"],
      value: row.locator_value,
    },
    scope: row.scope as ProjectResourceLink["scope"],
    labels: JSON.parse(row.labels_json) as ProjectResourceLinkLabels,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function projectResourceLinksDigest(links: readonly ProjectResourceLink[]): string {
  const ordered = [...links].sort((a, b) =>
    canonicalJson(projectResourceLinkIdentity(a)).localeCompare(canonicalJson(projectResourceLinkIdentity(b))),
  );
  return sha256(canonicalJson(ordered.map((link) => ({
    id: link.id,
    project_id: link.project_id,
    ...projectResourceLinkIdentity(link),
    scope: link.scope,
    labels: link.labels,
  }))));
}

function projectionValue(link: ProjectResourceLink): string | null {
  if (link.authority === "conversations" && link.target_kind === "channel") {
    return link.labels.channel_name ?? null;
  }
  return link.locator.value;
}

const PROJECTIONS = [
  { key: "todos_project_id", match: (link: ProjectResourceLink) => link.authority === "todos" && link.target_kind === "project" },
  { key: "todos_task_list_id", match: (link: ProjectResourceLink) => link.authority === "todos" && link.target_kind === "task_list" },
  { key: "mementos_project_id", match: (link: ProjectResourceLink) => link.authority === "mementos" && link.target_kind === "project" },
  { key: "orgs_org_id", match: (link: ProjectResourceLink) => link.authority === "orgs" && link.target_kind === "org" },
  { key: "orgs_project_id", match: (link: ProjectResourceLink) => link.authority === "orgs" && link.target_kind === "project" },
  { key: "conversations_channel", match: (link: ProjectResourceLink) => link.authority === "conversations" && link.target_kind === "channel" },
] as const;

export function projectResourceLinkIntegrationProjection(
  integrations: WorkspaceIntegrations,
  beforeLinks: readonly ProjectResourceLink[],
  afterLinks: readonly ProjectResourceLink[],
): WorkspaceIntegrations {
  const projected = { ...integrations };
  for (const projection of PROJECTIONS) {
    const before = beforeLinks.filter(projection.match);
    const after = afterLinks.filter(projection.match);
    if (after.length === 1) {
      const value = projectionValue(after[0]!);
      if (value) projected[projection.key] = value;
      else delete projected[projection.key];
    } else if (after.length > 1 || before.length > 0) {
      delete projected[projection.key];
    }
  }
  return projected;
}

export function projectResourceLinkSnapshot(project: Workspace, links: ProjectResourceLink[]): ProjectResourceLinkSnapshot {
  return {
    project,
    links,
    collection_digest: projectResourceLinksDigest(links),
  };
}
