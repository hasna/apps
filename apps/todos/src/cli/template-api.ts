import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type {
  TodosTemplateHistory,
  TodosTemplateInitialization,
} from "../storage/interfaces.js";

export async function initializeSharedTemplates(
  client: HasnaStorageClient,
): Promise<TodosTemplateInitialization> {
  const raw = await client.transport.post<TodosTemplateInitialization>(
    "/templates/initialize",
    {},
  );
  if (
    !raw ||
    raw.schema_version !== 1 ||
    !Array.isArray(raw.records) ||
    !Array.isArray(raw.names) ||
    !Number.isSafeInteger(raw.created) ||
    !Number.isSafeInteger(raw.skipped) ||
    raw.created < 0 ||
    raw.skipped < 0 ||
    raw.records.length !== raw.created + raw.skipped
  )
    throw new Error(
      "Template initialization receipt is incomplete; inspect shared templates before retrying",
    );
  for (const [index, row] of raw.records.entries()) {
    if (
      !row ||
      row.definition_index !== index ||
      !Array.isArray(row.ids) ||
      !row.ids.length ||
      row.ids.some((id) => typeof id !== "string" || !id) ||
      new Set(row.ids).size !== row.ids.length ||
      typeof row.name !== "string" ||
      !row.name ||
      !["created", "skipped"].includes(row.status) ||
      (row.status === "created" && row.ids.length !== 1)
    )
      throw new Error(
        "Invalid template initialization receipt; inspect shared templates before retrying",
      );
  }
  const names = raw.records
    .filter((row) => row.status === "created")
    .map((row) => row.name);
  if (
    names.length !== raw.created ||
    JSON.stringify(names) !== JSON.stringify(raw.names)
  )
    throw new Error("Conflicting template initialization counts");
  return raw;
}

export async function readSharedTemplateHistory(
  client: HasnaStorageClient,
  id: string,
): Promise<TodosTemplateHistory> {
  const raw = await client.transport.get<TodosTemplateHistory>(
    `/templates/${encodeURIComponent(id)}/history`,
  );
  if (
    !raw ||
    !Number.isSafeInteger(raw.current_version) ||
    raw.current_version < 1 ||
    raw.current_version > 10000 ||
    !Array.isArray(raw.versions) ||
    raw.selection?.schema_version !== 1 ||
    raw.selection.template_id !== id ||
    !Array.isArray(raw.selection.missing_versions)
  )
    throw new Error(
      "Upgrade the Todos API for supported template version history",
    );
  const seen = new Set<number>();
  for (const row of raw.versions) {
    if (
      !row ||
      row.template_id !== id ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1 ||
      row.version >= raw.current_version ||
      seen.has(row.version) ||
      typeof row.snapshot !== "string" ||
      !Number.isFinite(Date.parse(row.created_at))
    )
      throw new Error("Invalid template history record");
    const snapshot = JSON.parse(row.snapshot);
    if (
      !snapshot ||
      typeof snapshot.name !== "string" ||
      typeof snapshot.title_pattern !== "string" ||
      !Array.isArray(snapshot.tasks)
    )
      throw new Error("Invalid template history snapshot");
    seen.add(row.version);
  }
  const missing = Array.from(
    { length: raw.current_version - 1 },
    (_, i) => i + 1,
  ).filter((version) => !seen.has(version));
  if (
    JSON.stringify(missing) !==
      JSON.stringify(raw.selection.missing_versions) ||
    raw.selection.complete !== (missing.length === 0)
  )
    throw new Error("Conflicting template history completeness receipt");
  return raw;
}

export async function listSharedTemplates(
  client: HasnaStorageClient,
  projectId?: string,
): Promise<import("../types/index.js").TaskTemplate[]> {
  const raw = await client.transport.get<{
    templates: import("../types/index.js").TaskTemplate[];
    count: number;
  }>("/templates", {
    query: projectId ? { project_id: projectId } : undefined,
  });
  if (
    !raw ||
    !Array.isArray(raw.templates) ||
    raw.count !== raw.templates.length ||
    raw.count > 10000
  )
    throw new Error("Template inventory is incomplete; upgrade the Todos API");
  const ids = new Set<string>();
  for (const row of raw.templates) {
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id ||
      ids.has(row.id) ||
      (projectId !== undefined && row.project_id !== projectId)
    )
      throw new Error("Invalid shared template inventory");
    ids.add(row.id);
  }
  return raw.templates;
}

export async function updateSharedTemplate(
  client: HasnaStorageClient,
  id: string,
  patch: import("../storage/interfaces.js").UpdateTemplateInput,
): Promise<import("../types/index.js").TemplateWithTasks> {
  const raw = await client.transport.patch<any>(
    `/templates/${encodeURIComponent(id)}`,
    patch,
  );
  const receipt = raw?.history_write;
  if (
    !raw?.template ||
    raw.template.id !== id ||
    receipt?.schema_version !== 1 ||
    receipt.template_id !== id ||
    receipt.previous_version !== patch.expected_version ||
    receipt.version !== patch.expected_version! + 1 ||
    receipt.recorded !== true ||
    raw.template.version !== receipt.version
  )
    throw new Error(
      "Template update acknowledgment is incomplete; inspect shared state before retrying",
    );
  for (const [key, value] of Object.entries(patch)) {
    if (
      key !== "expected_version" &&
      JSON.stringify(raw.template[key]) !== JSON.stringify(value)
    )
      throw new Error(
        "Template update readback differs; inspect shared state before retrying",
      );
  }
  return raw.template;
}
