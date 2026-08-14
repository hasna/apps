import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerDecisionRecordTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("create_decision_record")) {
    server.tool(
      "create_decision_record",
      "Create an ADR-style local decision record.",
      {
        project_id: z.string().optional(),
        task_id: z.string().optional(),
        plan_id: z.string().optional(),
        agent_id: z.string().optional(),
        title: z.string(),
        status: z.enum(["proposed", "accepted", "deprecated", "superseded", "rejected"]).optional(),
        context: z.string().optional(),
        decision: z.string(),
        consequences: z.string().optional(),
        alternatives: z.array(z.object({
          title: z.string(),
          description: z.string().optional(),
          rejected_reason: z.string().optional(),
        })).optional(),
        tags: z.array(z.string()).optional(),
        supersedes_id: z.string().optional(),
      },
      async (params) => {
        try {
          const { createDecisionRecord } = await import("../../lib/decision-records.js");
          const record = createDecisionRecord({
            ...params,
            project_id: params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined,
            task_id: params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined,
            plan_id: params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_decision_record")) {
    server.tool(
      "get_decision_record",
      "Get a decision record by id or short ref.",
      {
        id: z.string(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ id, format }) => {
        try {
          const { getDecisionRecord, getDecisionRecordByRef, formatDecisionRecordMarkdown } = await import("../../lib/decision-records.js");
          const record = getDecisionRecord(id) ?? getDecisionRecordByRef(id);
          if (!record) return { content: [{ type: "text" as const, text: `Decision record not found: ${id}` }], isError: true };
          const text = format === "markdown" ? formatDecisionRecordMarkdown(record) : JSON.stringify(record, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_decision_records")) {
    server.tool(
      "list_decision_records",
      "List ADR-style decision records with optional filters.",
      {
        project_id: z.string().optional(),
        task_id: z.string().optional(),
        plan_id: z.string().optional(),
        status: z.enum(["proposed", "accepted", "deprecated", "superseded", "rejected"]).optional(),
        tag: z.string().optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { listDecisionRecords } = await import("../../lib/decision-records.js");
          const records = listDecisionRecords({
            ...params,
            project_id: params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined,
            task_id: params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined,
            plan_id: params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(records, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_decision_record")) {
    server.tool(
      "update_decision_record",
      "Update decision record fields (not status).",
      {
        id: z.string(),
        title: z.string().optional(),
        context: z.string().optional(),
        decision: z.string().optional(),
        consequences: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      async ({ id, ...rest }) => {
        try {
          const { updateDecisionRecord } = await import("../../lib/decision-records.js");
          const record = updateDecisionRecord(id, rest);
          return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_decision_status")) {
    server.tool(
      "set_decision_status",
      "Set decision record lifecycle status.",
      {
        id: z.string(),
        status: z.enum(["proposed", "accepted", "deprecated", "superseded", "rejected"]),
      },
      async ({ id, status }) => {
        try {
          const { setDecisionStatus } = await import("../../lib/decision-records.js");
          const record = setDecisionStatus(id, status);
          return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("supersede_decision_record")) {
    server.tool(
      "supersede_decision_record",
      "Create a replacement decision and mark the prior record superseded.",
      {
        id: z.string(),
        title: z.string(),
        decision: z.string(),
        context: z.string().optional(),
        consequences: z.string().optional(),
        agent_id: z.string().optional(),
      },
      async ({ id, ...rest }) => {
        try {
          const { supersedeDecisionRecord } = await import("../../lib/decision-records.js");
          const result = supersedeDecisionRecord(id, rest);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("capture_knowledge_snapshot")) {
    server.tool(
      "capture_knowledge_snapshot",
      "Capture a project knowledge snapshot bundling decisions, plans, and conventions.",
      {
        project_id: z.string(),
        title: z.string().optional(),
        summary: z.string().optional(),
        notes: z.string().optional(),
        conventions: z.array(z.string()).optional(),
        topics: z.array(z.string()).optional(),
      },
      async (params) => {
        try {
          const { captureKnowledgeSnapshot } = await import("../../lib/decision-records.js");
          const projectId = resolveId(params.project_id, "projects") ?? params.project_id;
          const record = captureKnowledgeSnapshot({ ...params, project_id: projectId });
          return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_knowledge_snapshot")) {
    server.tool(
      "get_knowledge_snapshot",
      "Get a stored project knowledge snapshot.",
      {
        id: z.string(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ id, format }) => {
        try {
          const { getKnowledgeSnapshot, formatKnowledgeSnapshotMarkdown } = await import("../../lib/decision-records.js");
          const record = getKnowledgeSnapshot(id);
          if (!record) return { content: [{ type: "text" as const, text: `Knowledge snapshot not found: ${id}` }], isError: true };
          const text = format === "markdown" ? formatKnowledgeSnapshotMarkdown(record) : JSON.stringify(record, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_knowledge_snapshots")) {
    server.tool(
      "list_knowledge_snapshots",
      "List stored project knowledge snapshots.",
      {
        project_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { listKnowledgeSnapshots } = await import("../../lib/decision-records.js");
          const records = listKnowledgeSnapshots({
            ...params,
            project_id: params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(records, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("export_decision_record")) {
    server.tool(
      "export_decision_record",
      "Export a decision record to local Markdown or JSON.",
      {
        id: z.string(),
        output_path: z.string().optional(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ id, output_path, format }) => {
        try {
          const { exportDecisionRecord, getDecisionRecord, getDecisionRecordByRef } = await import("../../lib/decision-records.js");
          const record = getDecisionRecord(id) ?? getDecisionRecordByRef(id);
          if (!record) return { content: [{ type: "text" as const, text: `Decision record not found: ${id}` }], isError: true };
          const result = exportDecisionRecord(record.id, output_path, format ?? "markdown");
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("export_knowledge_snapshot")) {
    server.tool(
      "export_knowledge_snapshot",
      "Export a project knowledge snapshot to local Markdown or JSON.",
      {
        id: z.string(),
        output_path: z.string().optional(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ id, output_path, format }) => {
        try {
          const { exportKnowledgeSnapshot } = await import("../../lib/decision-records.js");
          const result = exportKnowledgeSnapshot(id, output_path, format ?? "markdown");
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
