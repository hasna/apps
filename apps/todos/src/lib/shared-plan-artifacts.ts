import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Plan, Task } from "../types/index.js";
import {
  buildPlanArtifactSnapshot,
  comparePlanArtifact,
  parsePlanArtifactMarkdown,
  planArtifactFileName,
  renderPlanArtifactMarkdown,
  type PlanArtifactInspection,
} from "./plan-artifacts.js";

function safeSegment(value: string): string {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) ||
    value === "." ||
    value === ".."
  )
    throw new Error("Invalid plan artifact identity");
  return value;
}
/** The root is chosen on this client. A path returned by the API is never used. */
function artifactPaths(plan: Plan, root: string, create: boolean) {
  if (!plan.project_id)
    throw new Error("Plan artifacts require a project-scoped plan");
  if (!root.trim())
    throw new Error(
      "--artifact-root must name an existing trusted local project directory",
    );
  const chosen = resolve(root);
  const rootStat = lstatSync(chosen);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error("Artifact root must be a real local directory");
  const canonical = realpathSync(chosen);
  let directory = canonical;
  for (const segment of [
    ".hasna",
    "todos",
    "plans",
    safeSegment(plan.project_id),
  ]) {
    directory = join(directory, segment);
    if (!existsSync(directory)) {
      if (!create)
        return {
          directory,
          primary: join(
            canonical,
            ".hasna",
            "todos",
            "plans",
            safeSegment(plan.project_id),
            planArtifactFileName(plan),
          ),
          legacy: join(
            canonical,
            ".hasna",
            "todos",
            "plans",
            safeSegment(plan.project_id),
            `${safeSegment(plan.id)}.md`,
          ),
        };
      mkdirSync(directory, { mode: 0o700 });
    }
    const stat = lstatSync(directory);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (stat.mode & 0o022) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    )
      throw new Error(
        "Artifact directory must be owned by this user and not writable by other users",
      );
  }
  return {
    directory,
    primary: join(directory, planArtifactFileName(plan)),
    legacy: join(directory, `${safeSegment(plan.id)}.md`),
  };
}
function readSafe(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
      throw new Error(
        "Plan artifact must be a regular file no larger than 8 MiB",
      );
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}
export function readSharedPlanArtifact(plan: Plan, root: string) {
  if (!plan.project_id) return null;
  const paths = artifactPaths(plan, root, false);
  const path = existsSync(paths.primary)
    ? paths.primary
    : existsSync(paths.legacy)
      ? paths.legacy
      : null;
  if (!path) return null;
  return { path, ...parsePlanArtifactMarkdown(readSafe(path)) };
}

export function inspectSharedPlanArtifact(
  plan: Plan,
  tasks: Task[],
  root: string,
): PlanArtifactInspection | null {
  if (!plan.project_id) return null;
  const paths = artifactPaths(plan, root, false);
  const path = existsSync(paths.primary)
    ? paths.primary
    : existsSync(paths.legacy)
      ? paths.legacy
      : null;
  if (!path)
    return {
      path: paths.primary,
      exists: false,
      parse_error: null,
      metadata: null,
      task_references: [],
      conflicts: [],
    };
  const markdown = readSafe(path);
  try {
    const artifact = parsePlanArtifactMarkdown(markdown);
    return {
      path,
      exists: true,
      parse_error: null,
      metadata: artifact.metadata,
      task_references: artifact.task_references,
      conflicts: comparePlanArtifact(plan, artifact, tasks),
    };
  } catch {
    return {
      path,
      exists: true,
      parse_error: "Invalid plan Markdown artifact",
      metadata: null,
      task_references: [],
      conflicts: [],
    };
  }
}
export function writeSharedPlanArtifact(
  plan: Plan,
  tasks: Task[],
  root: string,
) {
  if (!plan.project_id) return null;
  const snapshot = buildPlanArtifactSnapshot(plan, tasks);
  const markdown = renderPlanArtifactMarkdown(snapshot);
  if (Buffer.byteLength(markdown) > 8 * 1024 * 1024)
    throw new Error("Plan artifact exceeds 8 MiB");
  const paths = artifactPaths(plan, root, true);
  if (existsSync(paths.primary) && !lstatSync(paths.primary).isFile())
    throw new Error("Artifact target must be a regular file");
  const temporary = join(paths.directory, `.plan-${randomUUID()}.tmp`);
  let renamed = false;
  try {
    const fd = openSync(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, markdown);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    artifactPaths(plan, root, false);
    renameSync(temporary, paths.primary);
    renamed = true;
    const directoryFd = openSync(paths.directory, constants.O_RDONLY);
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
    return { path: paths.primary, snapshot };
  } catch (error) {
    if (renamed)
      throw new Error(
        "Artifact was replaced but durable completion is uncertain; inspect it before retrying",
      );
    throw error;
  } finally {
    if (!renamed) {
      try {
        rmSync(temporary, { force: true });
      } catch {
        /* Preserve the primary failure; only our owned staging path is eligible for cleanup. */
      }
    }
  }
}
