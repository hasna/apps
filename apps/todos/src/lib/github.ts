import { execSync } from "child_process";
import type { CreateTaskInput } from "../types/index.js";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  state: string;
  assignee: string | null;
  url: string;
}

/** Parse a GitHub issue URL into owner/repo/number */
export function parseGitHubUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!, number: parseInt(match[3]!, 10) };
}

/** Fetch a GitHub issue using the gh CLI */
export function fetchGitHubIssue(owner: string, repo: string, number: number): GitHubIssue {
  const json = execSync(
    `gh api repos/${owner}/${repo}/issues/${number}`,
    { encoding: "utf-8", timeout: 15000 },
  );
  const data = JSON.parse(json);
  return {
    number: data.number,
    title: data.title,
    body: data.body,
    labels: (data.labels || []).map((l: any) => l.name),
    state: data.state,
    assignee: data.assignee?.login || null,
    url: data.html_url,
  };
}

/** Convert a GitHub issue to a CreateTaskInput */
export function issueToTask(issue: GitHubIssue, opts?: { project_id?: string; task_list_id?: string; agent_id?: string }): CreateTaskInput {
  const labelToPriority: Record<string, string> = {
    critical: "critical", "priority:critical": "critical",
    high: "high", "priority:high": "high", urgent: "high",
    low: "low", "priority:low": "low",
  };

  let priority: CreateTaskInput["priority"] = "medium";
  for (const label of issue.labels) {
    const mapped = labelToPriority[label.toLowerCase()];
    if (mapped) { priority = mapped as CreateTaskInput["priority"]; break; }
  }

  return {
    title: `[GH#${issue.number}] ${issue.title}`,
    description: issue.body ? issue.body.slice(0, 4000) : undefined,
    tags: issue.labels.slice(0, 10),
    priority,
    metadata: { github_url: issue.url, github_number: issue.number, github_state: issue.state },
    project_id: opts?.project_id,
    task_list_id: opts?.task_list_id,
    agent_id: opts?.agent_id,
  };
}
