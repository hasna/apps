import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerReleaseNotesTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("generate_release_notes")) {
    server.tool(
      "generate_release_notes",
      "Generate local release notes from git commits and completed tasks.",
      {
        version: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        project_id: z.string().optional(),
        cwd: z.string().optional(),
        include_commits: z.boolean().optional(),
        include_tasks: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { buildReleaseNotes } = await import("../../lib/release-notes.js");
          const report = buildReleaseNotes({
            version: params.version,
            since: params.since,
            until: params.until,
            project_id: params.project_id
              ? resolveId(params.project_id, "projects") ?? params.project_id
              : undefined,
            cwd: params.cwd,
            include_commits: params.include_commits,
            include_tasks: params.include_tasks,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("format_release_notes_markdown")) {
    server.tool(
      "format_release_notes_markdown",
      "Format a release notes report as Keep a Changelog markdown.",
      {
        version: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        project_id: z.string().optional(),
        cwd: z.string().optional(),
        include_commits: z.boolean().optional(),
        include_tasks: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { buildReleaseNotes, formatReleaseNotesMarkdown } = await import("../../lib/release-notes.js");
          const report = buildReleaseNotes({
            version: params.version,
            since: params.since,
            until: params.until,
            project_id: params.project_id
              ? resolveId(params.project_id, "projects") ?? params.project_id
              : undefined,
            cwd: params.cwd,
            include_commits: params.include_commits,
            include_tasks: params.include_tasks,
          });
          return {
            content: [{ type: "text" as const, text: formatReleaseNotesMarkdown(report) }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_changelog")) {
    server.tool(
      "update_changelog",
      "Prepend a generated changelog section to CHANGELOG.md.",
      {
        version: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        project_id: z.string().optional(),
        cwd: z.string().optional(),
        path: z.string().optional(),
        dry_run: z.boolean().optional(),
        include_commits: z.boolean().optional(),
        include_tasks: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { buildReleaseNotes, updateChangelog } = await import("../../lib/release-notes.js");
          const report = buildReleaseNotes({
            version: params.version,
            since: params.since,
            until: params.until,
            project_id: params.project_id
              ? resolveId(params.project_id, "projects") ?? params.project_id
              : undefined,
            cwd: params.cwd,
            include_commits: params.include_commits,
            include_tasks: params.include_tasks,
          });
          const result = updateChangelog({
            path: params.path,
            report,
            dry_run: params.dry_run,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  server.resource(
    "todos://release-notes-docs",
    "Local release notes and changelog generation documentation",
    async () => {
      const { getReleaseNotesDocs } = await import("../../lib/release-notes.js");
      return {
        contents: [{
          uri: "todos://release-notes-docs",
          mimeType: "text/markdown",
          text: getReleaseNotesDocs(),
        }],
      };
    },
  );
}
