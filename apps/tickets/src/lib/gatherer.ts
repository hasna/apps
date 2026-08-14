// Training data gatherer for @hasna/tickets
// Exports gatherTrainingData() conforming to GatherResult interface from @hasna/brains

import { listTickets } from "../db/tickets.ts";
import { listComments } from "../db/comments.ts";
import { listProjects } from "../db/projects.ts";

// Inline type definition — mirrors GatherResult / GatherTrainingDataFn from @hasna/brains
// (avoids requiring @hasna/brains as a hard dependency)

interface TrainingMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface TrainingExample {
  messages: TrainingMessage[];
}

interface GatherResult {
  source: string;
  examples: TrainingExample[];
  count: number;
}

interface GathererOptions {
  limit?: number;
  since?: Date;
  outputDir?: string;
}

type GatherTrainingDataFn = (options?: GathererOptions) => Promise<GatherResult>;

const SYSTEM_PROMPT =
  "You are an issue management assistant that triages bugs, prioritizes features, and tracks resolutions.";

export const gatherTrainingData: GatherTrainingDataFn = async (
  options: GathererOptions = {}
): Promise<GatherResult> => {
  const limit = options.limit ?? 500;
  const examples: TrainingExample[] = [];

  try {
    // ── Projects overview ─────────────────────────────────────────────────────

    const projects = listProjects();
    if (projects.length > 0) {
      const projectList = projects
        .map((p) => `${p.name} [${p.ticket_prefix}] — ${p.ticket_counter} tickets`)
        .join(", ");
      examples.push({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "List all projects and their ticket counts." },
          {
            role: "assistant",
            content: `There are ${projects.length} project(s): ${projectList}.`,
          },
        ],
      });
    }

    // ── Ticket triage examples ────────────────────────────────────────────────

    const { tickets } = listTickets({
      per_page: Math.min(limit, 100),
      created_after: options.since?.toISOString(),
    });

    for (const t of tickets) {
      // Triage example
      examples.push({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Triage this ticket: "${t.title}"\nType: ${t.type}\nDescription: ${t.description ?? "(none)"}`,
          },
          {
            role: "assistant",
            content: `Ticket ${t.short_id} — ${t.type} — Priority: ${t.priority}${t.severity ? `, Severity: ${t.severity}` : ""}. Status: ${t.status}${t.resolution ? ` (${t.resolution})` : ""}.${t.assignee_id ? ` Assigned to: ${t.assignee_id}.` : " Unassigned."}`,
          },
        ],
      });

      // Status query example
      examples.push({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `What is the current status of "${t.title}"?`,
          },
          {
            role: "assistant",
            content: `"${t.title}" (${t.short_id}) is currently ${t.status}${t.resolution ? ` with resolution: ${t.resolution}` : ""}. Priority: ${t.priority}.`,
          },
        ],
      });

      // Resolution flow (only for resolved/closed tickets)
      if ((t.status === "resolved" || t.status === "closed") && t.resolution) {
        examples.push({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `How was "${t.title}" resolved?`,
            },
            {
              role: "assistant",
              content: `"${t.title}" was ${t.status} with resolution: ${t.resolution}.${t.resolved_at ? ` Resolved on ${t.resolved_at.slice(0, 10)}.` : ""}`,
            },
          ],
        });
      }

      // Comment thread (if any)
      try {
        const comments = listComments(t.id, false);
        if (comments.length > 0) {
          const thread = comments
            .slice(0, 5)
            .map((c) => `> ${c.content.slice(0, 200)}`)
            .join("\n");
          examples.push({
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: `Summarize the discussion on ticket "${t.title}".`,
              },
              {
                role: "assistant",
                content: `"${t.title}" has ${comments.length} comment(s):\n${thread}`,
              },
            ],
          });
        }
      } catch {
        // comments optional
      }

      if (examples.length >= limit) break;
    }

    // ── Priority / label queries ───────────────────────────────────────────────

    const criticalTickets = listTickets({ priority: "critical", per_page: 10 }).tickets;

    if (criticalTickets.length > 0) {
      examples.push({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "Show me all critical priority tickets." },
          {
            role: "assistant",
            content: `Critical tickets (${criticalTickets.length}):\n${criticalTickets
              .map((t) => `- ${t.short_id}: ${t.title} [${t.status}]`)
              .join("\n")}`,
          },
        ],
      });
    }

    // ── Unassigned open tickets ────────────────────────────────────────────────

    const openTickets = listTickets({ status: "open", per_page: 20 }).tickets;
    const unassigned = openTickets.filter((t) => !t.assignee_id);
    if (unassigned.length > 0) {
      examples.push({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "Which open tickets are unassigned?" },
          {
            role: "assistant",
            content: `There are ${unassigned.length} unassigned open ticket(s):\n${unassigned
              .slice(0, 10)
              .map((t) => `- ${t.short_id}: ${t.title} (${t.priority})`)
              .join("\n")}`,
          },
        ],
      });
    }
  } catch {
    // Return partial results on any DB error
  }

  const finalExamples = examples.slice(0, limit);
  return { source: "tickets", examples: finalExamples, count: finalExamples.length };
};
