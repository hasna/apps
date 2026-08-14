import {
  TODOS_PROJECT_REGISTRATION_ROUTE,
  type TodosProjectResourcePage,
  type TodosProjectResourcePageRequest,
} from "./types.js";

export type TodosProjectResourcePageIdentity = Pick<
  TodosProjectResourcePage,
  | "authority"
  | "route"
  | "package_version"
  | "authority_id"
  | "tenant_id"
  | "corpus_id"
  | "source_project_id"
  | "todos_project_id"
  | "task_list_id"
  | "include_anchors"
  | "collection_revision"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function invalidPage(message: string): never {
  throw new Error(`project-resources producer returned ${message}`);
}

export function projectResourcePageIdentity(
  page: TodosProjectResourcePage,
): TodosProjectResourcePageIdentity {
  return {
    authority: page.authority,
    route: page.route,
    package_version: page.package_version,
    authority_id: page.authority_id,
    tenant_id: page.tenant_id,
    corpus_id: page.corpus_id,
    source_project_id: page.source_project_id,
    todos_project_id: page.todos_project_id,
    task_list_id: page.task_list_id,
    include_anchors: page.include_anchors,
    collection_revision: page.collection_revision,
  };
}

export function assertTodosProjectResourcePage(
  value: unknown,
  request: TodosProjectResourcePageRequest,
  expectedIdentity: TodosProjectResourcePageIdentity | null = null,
): TodosProjectResourcePage {
  if (!isRecord(value)) invalidPage("a non-object page");
  const page = value;
  if (
    page["authority"] !== "todos"
    || page["route"] !== TODOS_PROJECT_REGISTRATION_ROUTE
    || !isNonEmptyString(page["package_version"])
    || !isNonEmptyString(page["authority_id"])
    || !isNonEmptyString(page["tenant_id"])
    || !isNonEmptyString(page["corpus_id"])
    || page["source_project_id"] !== request.source_project_id
    || !isNonEmptyString(page["todos_project_id"])
    || !isNonEmptyString(page["task_list_id"])
    || page["include_anchors"] !== (request.include_anchors === true)
    || !isNonEmptyString(page["collection_revision"])
    || page["limit"] !== request.limit
  ) {
    invalidPage("a page bound to a different request or authority identity");
  }

  if (expectedIdentity) {
    for (const [key, expected] of Object.entries(expectedIdentity)) {
      if (page[key] !== expected) {
        invalidPage("an authority identity change during pagination");
      }
    }
  }

  const resources = page["resources"];
  const count = page["count"];
  if (
    !Array.isArray(resources)
    || !Number.isSafeInteger(count)
    || Number(count) < 0
    || Number(count) !== resources.length
    || resources.length > request.limit
  ) {
    invalidPage("an inconsistent resource count");
  }
  for (const resource of resources) {
    if (
      !isRecord(resource)
      || resource["source_project_id"] !== request.source_project_id
      || !["project", "task_list", "plan", "task"].includes(String(resource["kind"]))
      || !["collection", "resource"].includes(String(resource["scope"]))
      || !isNonEmptyString(resource["target_id"])
      || !(resource["parent_id"] === null || isNonEmptyString(resource["parent_id"]))
      || !isNonEmptyString(resource["revision"])
      || !isNonEmptyString(resource["digest"])
    ) {
      invalidPage("a resource bound to a different source or malformed identity");
    }
  }

  const hasMore = page["has_more"];
  const complete = page["complete"];
  const nextCursor = page["next_cursor"];
  if (
    typeof hasMore !== "boolean"
    || typeof complete !== "boolean"
    || page["truncated"] !== false
    || !(nextCursor === null || isNonEmptyString(nextCursor))
  ) {
    invalidPage("inconsistent completion or cursor flags");
  }
  if (
    hasMore
      ? complete !== false
        || !isNonEmptyString(nextCursor)
        || nextCursor === request.cursor
        || resources.length !== request.limit
      : complete !== true || nextCursor !== null
  ) {
    invalidPage("inconsistent completion or cursor flags");
  }

  return page as unknown as TodosProjectResourcePage;
}
