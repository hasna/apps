import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { isAbsolute } from "node:path";
import type { ProjectStore } from "../store/project-store.js";
import type { Workspace, WorkspaceIntegrations } from "../types/workspace.js";
import { projectChannelSummary } from "./project-channel.js";
import {
  financeProjectMetadata,
  type FinanceProjectMetadata,
} from "./project-management.js";
import { redactProjectValue } from "./redaction.js";

export const PROJECT_CONTEXT_BUNDLE_SCHEMA = "hasna.projects.project_context_bundle.v2" as const;
const PROJECT_CONTEXT_BUNDLE_MAX_BYTES = 8 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;
const STRICT_ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;
const CREDENTIAL_LIKE_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]|\$\{|https?:\/\//i;

type LinkState = "linked" | "partial" | "unlinked";

export interface ProjectContextBundleV1 {
  schema: typeof PROJECT_CONTEXT_BUNDLE_SCHEMA;
  generated_at: string;
  hash: string;
  revision: string;
  freshness: "fresh";
  resolution: {
    source: "id-or-slug";
    conflict: false;
    create_allowed: false;
  };
  authority: {
    owner: "projects";
    mode: "local" | "api";
    storage: "sqlite" | "cloud" | "self-hosted";
    availability: "available";
  };
  project: {
    id: string;
    slug: string;
    name: string;
    kind: Workspace["kind"];
    status: Workspace["status"];
    path: string | null;
    updated_at: string;
    finance?: FinanceProjectMetadata;
  };
  links: {
    todos: {
      state: LinkState;
      project_id: string | null;
      task_list_id: string | null;
    };
    conversations: {
      state: LinkState;
      channel: string | null;
    };
    mementos: {
      state: LinkState;
      project_id: string | null;
      scope: string | null;
    };
  };
  station: {
    station_id: string | null;
    machine_id: string | null;
  } | null;
  commands: Array<{
    name: "show" | "context" | "why" | "context-bundle";
    argv: string[];
  }>;
}

export interface BuildProjectContextBundleOptions {
  generatedAt?: Date;
  env?: Record<string, string | undefined>;
  hostname?: string;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assertSafeId(value: string | null, label: string): string | null {
  if (value === null) return null;
  if (value.length > 512 || !SAFE_ID_PATTERN.test(value)) {
    throw new Error(`${label} is not a safe project-context identifier`);
  }
  return value;
}

function normalizeTimestamp(value: string, label: string): string {
  const trimmed = value.trim();
  const withTimeSeparator = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const candidate = /(?:Z|[+-]\d{2}:\d{2})$/.test(withTimeSeparator)
    ? withTimeSeparator
    : `${withTimeSeparator}Z`;
  if (!STRICT_ISO_PATTERN.test(candidate) || !Number.isFinite(Date.parse(candidate))) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return candidate;
}

function linkState(values: Array<string | null>): LinkState {
  const present = values.filter((value) => value !== null).length;
  if (present === 0) return "unlinked";
  if (present === values.length) return "linked";
  return "partial";
}

function contextStorage(
  mode: ProjectStore["mode"],
  env: Record<string, string | undefined>,
): ProjectContextBundleV1["authority"]["storage"] {
  if (mode === "local") return "sqlite";
  const configured = stringValue(env["HASNA_PROJECTS_STORAGE_MODE"] ?? env["PROJECTS_STORAGE_MODE"]);
  return configured === "self_hosted" || configured === "self-hosted" ? "self-hosted" : "cloud";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeProjectContextBundleHash(bundle: ProjectContextBundleV1): string {
  const { generated_at: _generatedAt, hash: _hash, ...allowlisted } = bundle;
  return `sha256:${createHash("sha256").update(stableStringify(allowlisted)).digest("hex")}`;
}

function assertBundleSafe(bundle: ProjectContextBundleV1): void {
  const encoded = JSON.stringify(bundle);
  if (
    CREDENTIAL_LIKE_PATTERN.test(encoded)
    || JSON.stringify(redactProjectValue(bundle)) !== encoded
  ) {
    throw new Error("credential-like or URL content is forbidden in project context");
  }
  if (Buffer.byteLength(encoded, "utf8") > PROJECT_CONTEXT_BUNDLE_MAX_BYTES) {
    throw new Error(`project context bundle exceeds ${PROJECT_CONTEXT_BUNDLE_MAX_BYTES} bytes`);
  }
}

function buildLinks(project: Workspace): ProjectContextBundleV1["links"] {
  const todosProjectId = stringValue(project.integrations.todos_project_id);
  const todosTaskListId = stringValue(project.integrations.todos_task_list_id);
  const channel = projectChannelSummary(project);
  const mementosProjectId = stringValue(project.integrations.mementos_project_id);
  const mementosScope = stringValue((project.integrations as WorkspaceIntegrations)["mementos_scope"]);

  return {
    todos: {
      state: linkState([todosProjectId, todosTaskListId]),
      project_id: todosProjectId,
      task_list_id: todosTaskListId,
    },
    conversations: {
      state: channel.channel === null
        ? "unlinked"
        : channel.source === "integration" ? "linked" : "partial",
      channel: channel.channel,
    },
    mementos: {
      state: linkState([mementosProjectId, mementosScope]),
      project_id: mementosProjectId,
      scope: mementosScope,
    },
  };
}

function buildStation(
  project: Workspace,
  env: Record<string, string | undefined>,
  producingHostname: string,
): ProjectContextBundleV1["station"] {
  const stationId = assertSafeId(
    stringValue(env["HASNA_STATION_ID"] ?? env["STATION_ID"]) ?? stringValue(project.canonical_machine),
    "station_id",
  );
  const machineId = assertSafeId(
    stringValue(env["HASNA_MACHINE_ID"] ?? env["MACHINE_ID"]) ?? stringValue(producingHostname.replace(/\.local$/, "")),
    "machine_id",
  );
  return stationId === null && machineId === null
    ? null
    : { station_id: stationId, machine_id: machineId };
}

export async function buildProjectContextBundle(
  store: ProjectStore,
  exactProjectId: string,
  options: BuildProjectContextBundleOptions = {},
): Promise<ProjectContextBundleV1> {
  if (!exactProjectId || exactProjectId.length > 512 || !SAFE_ID_PATTERN.test(exactProjectId)) {
    throw new Error("context-bundle requires an exact project id");
  }
  const project = await store.getProject(exactProjectId);
  if (!project || project.id !== exactProjectId) {
    throw new Error(`context-bundle requires an exact project id; no exact match for ${exactProjectId}`);
  }
  if (project.primary_path !== null && !isAbsolute(project.primary_path)) {
    throw new Error("project context path must be absolute");
  }

  const env = options.env ?? process.env;
  const updatedAt = normalizeTimestamp(project.updated_at, "project.updated_at");
  const generatedAt = normalizeTimestamp((options.generatedAt ?? new Date()).toISOString(), "generated_at");
  const commandNames = ["show", "context", "why", "context-bundle"] as const;
  const finance = financeProjectMetadata(project);
  const bundle: ProjectContextBundleV1 = {
    schema: PROJECT_CONTEXT_BUNDLE_SCHEMA,
    generated_at: generatedAt,
    hash: "sha256:pending",
    revision: updatedAt,
    freshness: "fresh",
    resolution: {
      source: "id-or-slug",
      conflict: false,
      create_allowed: false,
    },
    authority: {
      owner: "projects",
      mode: store.mode,
      storage: contextStorage(store.mode, env),
      availability: "available",
    },
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      kind: project.kind,
      status: project.status,
      path: project.primary_path,
      updated_at: updatedAt,
      ...(finance ? { finance } : {}),
    },
    links: buildLinks(project),
    station: buildStation(project, env, options.hostname ?? hostname()),
    commands: commandNames.map((name) => ({
      name,
      argv: ["projects", name, project.id, "--json"],
    })),
  };
  bundle.hash = computeProjectContextBundleHash(bundle);
  assertBundleSafe(bundle);
  return bundle;
}
