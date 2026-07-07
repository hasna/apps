/** Typed option bags shared by the route engine, drain engine, and CLI commands. */

export interface TodosTaskRouteOptions {
  eventFile?: string;
  eventJson?: string;
  policy?: string;
  preset?: string;
  routePolicyEvidence?: string;
  template?: string;
  provider?: string;
  providerRule?: string[];
  authProfile?: string;
  authProfilePool?: string;
  triageAuthProfile?: string;
  plannerAuthProfile?: string;
  workerAuthProfile?: string;
  verifierAuthProfile?: string;
  account?: string;
  accountPool?: string;
  triageAccount?: string;
  plannerAccount?: string;
  workerAccount?: string;
  verifierAccount?: string;
  accountTool?: string;
  model?: string;
  variant?: string;
  agent?: string;
  addDir?: string[];
  timeout?: string;
  verifierIdleTimeout?: string;
  permissionMode?: string;
  sandbox?: string;
  manualBreakGlass?: boolean;
  projectPath?: string;
  projectGroup?: string;
  maxActive?: string;
  maxActivePerProject?: string;
  maxActivePerProjectGroup?: string;
  maxActiveScope?: string;
  maxPerProfile?: string;
  worktreeMode?: string;
  worktreeRoot?: string;
  worktreeBranchPrefix?: string;
  prHandoff?: boolean;
  githubReviewer?: string;
  githubReviewerPool?: string;
  namePrefix?: string;
  preflight?: boolean;
  dryRun?: boolean;
  todosProject?: string;
  /** Internal drain context; never derived from CLI/event fields. */
  sourceTodosProjectPath?: string;
}

export interface TodosReadyTask {
  id?: string;
  task_id?: string;
  taskId?: string;
  source_project_path?: string;
  sourceProjectPath?: string;
  title?: string;
  description?: string;
  body?: string;
  status?: string;
  working_dir?: string;
  workingDir?: string;
  project_path?: string;
  projectPath?: string;
  cwd?: string;
  tags?: string[] | string;
  metadata?: Record<string, unknown>;
  project_id?: string;
  projectId?: string;
  task_list_id?: string;
  taskListId?: string;
  task_list?: { id?: string; slug?: string };
  [key: string]: unknown;
}

export interface TodosDrainOptions extends TodosTaskRouteOptions {
  todosProject?: string;
  todosProjectsFromRegistry?: boolean;
  todosProjectInclude?: string[];
  todosProjectId?: string;
  taskList?: string;
  tags?: string;
  tag?: string;
  projectPathPrefix?: string;
  limit?: string;
  scanLimit?: string;
  maxDispatch?: string;
  launchGate?: string;
  launchGateBlocker?: string[];
  evidenceDir?: string;
  compact?: boolean;
}

export interface TodosTaskRoutePrint {
  kind: "skipped" | "deduped" | "throttled" | "created";
  value: Record<string, unknown>;
  human: string;
}
