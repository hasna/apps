/**
 * Deploy-lane gate for apps/todos.
 *
 * WHY THIS IS PARSER-BACKED RATHER THAN SUBSTRING-BASED
 *
 * The first version of this gate asserted that the workflow text CONTAINED
 * fragments such as `aws ecs update-service`. A string that appears in a file
 * is not a command that runs: `echo "aws ecs update-service ..."` and
 * `true # aws ecs update-service ...` both satisfy a substring check while the
 * service is never updated, and a workflow so mutated passed the old gate.
 * That is the vacuous-check shape — a control that cannot fail reports a clean
 * tree, and a clean tree is exactly what success looks like.
 *
 * So the material controls are validated structurally:
 *
 *   1. A minimal block-YAML parser (below, no dependency — the monorepo has no
 *      direct YAML dependency and a transitive one is not a supported import)
 *      turns the workflow into triggers, jobs, steps, `uses`, `with`, `if`,
 *      `env` and `run` block scalars.
 *   2. Each `run` block is reduced to its EFFECTIVE COMMANDS: shell comments
 *      stripped outside quotes, backslash continuations joined, then split at
 *      unquoted command separators (newline, `;`, `|`, `||`, `&&`). A required
 *      control must appear at a COMMAND POSITION — the head of a segment — so
 *      a quoted, echoed, or commented-out copy cannot satisfy it.
 *
 * The self-test proves both directions, and proves the mutants it uses are the
 * exact ones a substring check would have missed: each mutated workflow still
 * CONTAINS the required text while the gate rejects it.
 *
 * Usage:
 *   bun tooling/ci/check-todos-deploy.ts
 *   bun tooling/ci/check-todos-deploy.ts --self-test
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW = ".github/workflows/deploy-todos.yml";
const CI_WORKFLOW = ".github/workflows/ci.yml";

const DEPLOY_JOB = "deploy";
const GATE_JOB = "gate";

const STEP_GATE_RESOLVE = "Resolve the deployable commit";
const STEP_CHECKOUT = "Checkout exact source";
const STEP_VERIFY_SOURCE = "Verify source is the gated ci-passed main commit";
const STEP_TRIVY = "Generate local vulnerability report";
const STEP_OIDC = "Configure AWS credentials with GitHub OIDC";
const STEP_MANIFEST = "Resolve manifest and fail closed on production target mismatch";
const STEP_ECR = "Verify immutable scan-on-push ECR repository";
const STEP_PUSH = "Push scanned image and resolve immutable digest";
const STEP_MIGRATION = "Run one-shot migration task on the digest";
const STEP_DEPLOY = "Register digest-pinned task definition and update service";
const STEP_VERIFY_LIVE = "Verify exact live task definition, digest, and health";
const STEP_ROLLBACK = "Restore rollback anchor after a failed service rollout";

/** Fail-closed step order inside the deploy job. */
const DEPLOY_STEP_ORDER = [
  STEP_CHECKOUT,
  STEP_VERIFY_SOURCE,
  STEP_TRIVY,
  STEP_OIDC,
  STEP_MANIFEST,
  STEP_ECR,
  STEP_PUSH,
  STEP_MIGRATION,
  STEP_DEPLOY,
  STEP_VERIFY_LIVE,
  STEP_ROLLBACK,
];

/** Workflow-level `env` pins that name the exact production target. */
const REQUIRED_ENV: Record<string, string> = {
  AWS_ACCOUNT_ID: "789877399345",
  DEPLOY_MANIFEST: "/hasna/deploy/todos",
  EXPECTED_CLUSTER: "oss-fleet-prod",
  EXPECTED_SERVICE: "todos-prod",
  EXPECTED_ECR_REPOSITORY: "todos",
  EXPECTED_MIGRATION_FAMILY: "todos-prod-migrate",
  DEPLOY_PATH_SCOPE: "apps/todos/**",
  CI_WORKFLOW_FILE: "ci.yml",
};

/**
 * The exact Actions-API read the MANUAL route must perform before it may open
 * the lane, and the predicates its response filter must carry.
 *
 * workflow_dispatch inherits no verified head_sha the way workflow_run does, so
 * resolving to the current origin/main tip proves only WHICH commit would ship,
 * never that the commit passed anything. Without this read a hand dispatch
 * during or after red ci deploys an unverified SHA. Every fragment below is
 * required at a COMMAND position (or inside the command that runs it), so an
 * echoed or commented-out copy cannot satisfy the gate.
 */
const MANUAL_CI_QUERY =
  'gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/${CI_WORKFLOW_FILE}/runs?branch=main&event=push&status=completed&head_sha=${source_sha}&per_page=100"';

const MANUAL_CI_COUNT_PREFIX =
  'jq --arg sha "${source_sha}" --arg name "${REQUIRED_CI_WORKFLOW}"';

/** Predicates the count filter must bind, checked inside the real jq command. */
const MANUAL_CI_PREDICATES = [
  '.name == $name',
  '.path == $path',
  '.head_sha == $sha',
  '.head_branch == "main"',
  '.event == "push"',
  '.status == "completed"',
  '.conclusion == "success"',
];

const REQUIRED_DOCUMENTATION = ["repo:hasna/apps:environment:production"];

/** Text that must never appear anywhere in the active (comment-stripped) workflow. */
const FORBIDDEN = [
  "pull_request:",
  "terraform apply",
  "todos-prod-image-builder",
  ":latest",
  "secrets.AWS_",
  "aws-access-key-id",
  "aws-secret-access-key",
  "apps/todos/.github/workflows/deploy.yml",
];

// ---------------------------------------------------------------------------
// Minimal block-YAML parser (GitHub Actions subset)
// ---------------------------------------------------------------------------

export type YamlNode = string | YamlNode[] | { [key: string]: YamlNode };

/** Strip a trailing `#` comment that begins outside quotes at a word boundary. */
function stripInlineComment(line: string): string {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && double) {
      escaped = true;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      continue;
    }
    if (character === "#" && !single && !double && (index === 0 || /\s/.test(line[index - 1] ?? ""))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function scalarValue(raw: string): YamlNode {
  const trimmed = raw.trim();
  if (trimmed === "{}") return {};
  if (trimmed === "[]") return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((entry) => unquote(entry));
  }
  return unquote(trimmed);
}

const MAP_KEY = /^("[^"]*"|'[^']*'|[^:\s][^:]*?)\s*:(?:\s+(.*))?$/;

export function parseYaml(source: string): YamlNode {
  const lines = source.split("\n");
  let cursor = 0;

  const indentOf = (line: string): number => line.length - line.trimStart().length;

  const skipBlank = (): void => {
    while (cursor < lines.length && (lines[cursor].trim() === "" || /^\s*#/.test(lines[cursor]))) cursor += 1;
  };

  function parseBlockScalar(parentIndent: number): string {
    const collected: string[] = [];
    let contentIndent = -1;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line.trim() === "") {
        collected.push("");
        cursor += 1;
        continue;
      }
      const indent = indentOf(line);
      if (indent <= parentIndent) break;
      if (contentIndent < 0) contentIndent = indent;
      collected.push(line.slice(contentIndent));
      cursor += 1;
    }
    while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
    return collected.join("\n");
  }

  function parseNode(minIndent: number): YamlNode | null {
    skipBlank();
    if (cursor >= lines.length) return null;
    const indent = indentOf(lines[cursor]);
    if (indent < minIndent) return null;
    const head = lines[cursor].trimStart();
    if (head === "-" || head.startsWith("- ")) return parseSequence(indent);
    return parseMapping(indent);
  }

  function parseSequence(indent: number): YamlNode[] {
    const items: YamlNode[] = [];
    for (;;) {
      skipBlank();
      if (cursor >= lines.length) break;
      if (indentOf(lines[cursor]) !== indent) break;
      const head = lines[cursor].trimStart();
      if (head !== "-" && !head.startsWith("- ")) break;
      const rest = head === "-" ? "" : head.slice(2);
      if (rest === "") {
        cursor += 1;
        items.push(parseNode(indent + 1) ?? "");
        continue;
      }
      if (MAP_KEY.test(stripInlineComment(rest))) {
        // Re-anchor the inline entry so the mapping parser sees it at its own column.
        lines[cursor] = " ".repeat(indent + 2) + rest;
        items.push(parseMapping(indent + 2));
        continue;
      }
      cursor += 1;
      items.push(scalarValue(stripInlineComment(rest)));
    }
    return items;
  }

  function parseMapping(indent: number): Record<string, YamlNode> {
    const map: Record<string, YamlNode> = {};
    for (;;) {
      skipBlank();
      if (cursor >= lines.length) break;
      if (indentOf(lines[cursor]) !== indent) break;
      const head = lines[cursor].trimStart();
      const match = MAP_KEY.exec(head);
      if (!match) break;
      const key = unquote(match[1]);
      const inline = (match[2] ?? "").trim();
      cursor += 1;
      if (/^[|>][-+]?\d*$/.test(inline)) {
        map[key] = parseBlockScalar(indent);
      } else if (inline === "") {
        map[key] = parseNode(indent + 1) ?? "";
      } else {
        map[key] = scalarValue(stripInlineComment(inline));
      }
    }
    return map;
  }

  return parseNode(0) ?? {};
}

// ---------------------------------------------------------------------------
// Shell command-position analysis
// ---------------------------------------------------------------------------

const LEADING_KEYWORDS = new Set([
  "if", "elif", "then", "else", "fi", "while", "until", "do", "done",
  "case", "esac", "!", "time", "{", "}", "(", ")",
]);

/** Inner text of every `$( ... )` substitution that is actually expanded. */
function commandSubstitutions(text: string): string[] {
  const found: string[] = [];
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && !single) {
      escaped = true;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      continue;
    }
    // Inside single quotes `$(` is literal; inside double quotes it expands.
    if (single || character !== "$" || text[index + 1] !== "(") continue;

    let depth = 0;
    let innerSingle = false;
    let innerDouble = false;
    let innerEscaped = false;
    let scan = index + 1;
    for (; scan < text.length; scan += 1) {
      const inner = text[scan];
      if (innerEscaped) {
        innerEscaped = false;
        continue;
      }
      if (inner === "\\" && !innerSingle) {
        innerEscaped = true;
        continue;
      }
      if (inner === "'" && !innerDouble) {
        innerSingle = !innerSingle;
        continue;
      }
      if (inner === '"' && !innerSingle) {
        innerDouble = !innerDouble;
        continue;
      }
      if (innerSingle || innerDouble) continue;
      if (inner === "(") depth += 1;
      else if (inner === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0 || scan >= text.length) continue;
    found.push(text.slice(index + 2, scan));
    index = scan;
  }
  return found;
}

/** Split at unquoted command separators; only a segment HEAD is a command position. */
function splitSegments(text: string): string[] {
  const segments: string[] = [];
  let current = "";
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && !single) {
      current += character;
      escaped = true;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      current += character;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      current += character;
      continue;
    }
    if (!single && !double) {
      if (character === "\n" || character === ";") {
        segments.push(current);
        current = "";
        continue;
      }
      if (character === "|") {
        segments.push(current);
        current = "";
        if (text[index + 1] === "|") index += 1;
        continue;
      }
      if (character === "&" && text[index + 1] === "&") {
        segments.push(current);
        current = "";
        index += 1;
        continue;
      }
    }
    current += character;
  }
  segments.push(current);
  return segments;
}

function collectCommands(text: string): string[] {
  const commands: string[] = [];
  for (const segment of splitSegments(text)) {
    let normalized = segment.replace(/\s+/g, " ").trim();
    if (normalized === "") continue;
    // Peel leading shell keywords / grouping so `elif [[ ... ]]` still exposes
    // the test as the command, while `true # ...` collapses to `true`.
    for (;;) {
      const first = normalized.split(" ")[0];
      if (!LEADING_KEYWORDS.has(first)) break;
      const next = normalized.slice(first.length).trim();
      if (next === "") break;
      normalized = next;
    }
    commands.push(normalized);
  }
  // A command substitution executes its body, so its commands are effective
  // too: `x="$(aws sts get-caller-identity)"` really does call the API.
  for (const inner of commandSubstitutions(text)) commands.push(...collectCommands(inner));
  return commands;
}

/**
 * Reduce a `run:` block to the commands that actually execute.
 * Comments are stripped outside quotes and continuations joined before the
 * text is split, so a quoted, echoed, or commented-out copy of a control never
 * reaches a command position.
 */
export function effectiveCommands(run: string): string[] {
  const decommented = run.split("\n").map(stripInlineComment).join("\n");
  const joined = decommented.replace(/\\\n\s*/g, " ");
  return collectCommands(joined);
}

/** True when `expected` heads an effective command (exact token-boundary prefix). */
export function runsCommand(run: string, expected: string): boolean {
  return commandStartingWith(run, expected) !== undefined;
}

/**
 * The first EFFECTIVE command headed by `expected`, or undefined.
 *
 * Returning the command itself (rather than a boolean) is what lets a caller
 * inspect the arguments of the command that really runs — a jq filter, say —
 * instead of grepping the whole file, where an echoed copy would match.
 */
export function commandStartingWith(run: string, expected: string): string | undefined {
  const wanted = expected.replace(/\s+/g, " ").trim();
  return effectiveCommands(run).find(
    (command) => command === wanted || command.startsWith(`${wanted} `),
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Step = Record<string, YamlNode>;

function asMap(node: YamlNode | undefined): Record<string, YamlNode> {
  return node && typeof node === "object" && !Array.isArray(node) ? (node as Record<string, YamlNode>) : {};
}

function asArray(node: YamlNode | undefined): YamlNode[] {
  return Array.isArray(node) ? node : [];
}

function asText(node: YamlNode | undefined): string {
  return typeof node === "string" ? node : "";
}

function stepsOf(job: Record<string, YamlNode>): Step[] {
  return asArray(job.steps).map((step) => asMap(step));
}

function stepNamed(steps: Step[], name: string): Step | undefined {
  return steps.find((step) => asText(step.name) === name);
}

export function validateTodosDeploy(workflow: string, ciWorkflowName: string): string[] {
  const errors: string[] = [];
  const push = (message: string): void => {
    errors.push(message);
  };

  const document = asMap(parseYaml(workflow));
  const activeText = workflow.split("\n").map(stripInlineComment).join("\n");

  // --- documentation and blanket prohibitions -------------------------------
  for (const fragment of REQUIRED_DOCUMENTATION) {
    if (!workflow.includes(fragment)) push(`missing required deployment documentation: ${fragment}`);
  }
  for (const fragment of FORBIDDEN) {
    if (activeText.includes(fragment)) push(`forbidden deployment construct: ${fragment}`);
  }

  // --- triggers: deployment may only follow a successful ci run -------------
  const triggers = asMap(document.on);
  if ("push" in triggers) {
    push("deployment must not carry its own push trigger — it would race ci for the same commit");
  }
  if ("pull_request" in triggers) push("deployment must not be triggered by pull_request");
  if (!("workflow_dispatch" in triggers)) push("the explicit manual route (workflow_dispatch) is missing");
  if (!("workflow_run" in triggers)) {
    push("deployment is not bound to a completed ci run (on.workflow_run is missing)");
  } else {
    const workflowRun = asMap(triggers.workflow_run);
    const upstream = asArray(workflowRun.workflows).map((entry) => asText(entry));
    if (!upstream.includes(ciWorkflowName)) {
      push(`on.workflow_run.workflows must name the ci workflow "${ciWorkflowName}", found [${upstream.join(", ")}]`);
    }
    if (!asArray(workflowRun.types).map(asText).includes("completed")) {
      push("on.workflow_run.types must include completed");
    }
    if (!asArray(workflowRun.branches).map(asText).includes("main")) {
      push("on.workflow_run.branches must be restricted to main");
    }
  }

  // --- workflow-level pins ---------------------------------------------------
  const env = asMap(document.env);
  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    if (asText(env[key]) !== value) {
      push(`env.${key} must pin ${value}, found ${JSON.stringify(env[key] ?? null)}`);
    }
  }
  if (asText(env.REQUIRED_CI_WORKFLOW) !== ciWorkflowName) {
    push(`env.REQUIRED_CI_WORKFLOW must equal the ci workflow name "${ciWorkflowName}"`);
  }
  const permissions = asMap(document.permissions);
  if (asText(permissions.contents) !== "read") push("permissions.contents must be read");
  if (asText(permissions["id-token"]) !== "write") push("permissions.id-token must be write");

  const jobs = asMap(document.jobs);
  const gate = asMap(jobs[GATE_JOB]);
  const deploy = asMap(jobs[DEPLOY_JOB]);
  if (Object.keys(gate).length === 0) push(`the ${GATE_JOB} job is missing`);
  if (Object.keys(deploy).length === 0) push(`the ${DEPLOY_JOB} job is missing`);

  // --- gate job: conclusion / event / branch binding ------------------------
  const gateIf = asText(gate.if);
  for (const required of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    "github.event_name == 'workflow_dispatch'",
  ]) {
    if (!gateIf.includes(required)) push(`the ${GATE_JOB} job condition must require ${required}`);
  }

  // The gate reads history and run metadata. It needs `actions: read` to ask
  // whether ci passed, and must NEVER hold `id-token` — a job that can mint an
  // OIDC assertion is a job that can reach production before any gate resolved.
  const gatePermissions = asMap(gate.permissions);
  if (asText(gatePermissions.contents) !== "read") push(`the ${GATE_JOB} job must narrow permissions.contents to read`);
  if (asText(gatePermissions.actions) !== "read") {
    push(`the ${GATE_JOB} job must hold permissions.actions: read so it can verify the ci run for the manual route`);
  }
  if ("id-token" in gatePermissions) {
    push(`the ${GATE_JOB} job must not hold permissions.id-token — the gate must never be able to assume the deployment role`);
  }

  const gateSteps = stepsOf(gate);
  const resolve = stepNamed(gateSteps, STEP_GATE_RESOLVE);
  if (!resolve) {
    push(`the ${GATE_JOB} job is missing its "${STEP_GATE_RESOLVE}" step`);
  } else {
    if (asText(resolve.id) !== "resolve") push(`"${STEP_GATE_RESOLVE}" must keep id: resolve so its outputs are addressable`);
    const run = asText(resolve.run);
    const requiredResolveCommands = [
      '[[ "${RUN_CONCLUSION}" == "success" ]]',
      '[[ "${RUN_EVENT}" == "push" ]]',
      '[[ "${RUN_BRANCH}" == "main" ]]',
      '[[ "${RUN_NAME}" == "${REQUIRED_CI_WORKFLOW}" ]]',
      '[[ "${GITHUB_REF}" == "refs/heads/main" ]]',
      'source_sha="${main_tip}"',
      'git merge-base --is-ancestor "${source_sha}^{commit}" refs/remotes/origin/main',
      // The manual route's own ci binding. Resolving the tip is not proving it
      // passed; these three are what refuse a dispatch during or after red ci.
      MANUAL_CI_QUERY,
      MANUAL_CI_COUNT_PREFIX,
      '[[ "${ci_success_count}" -ge 1 ]]',
    ];
    for (const command of requiredResolveCommands) {
      if (!runsCommand(run, command)) push(`"${STEP_GATE_RESOLVE}" does not run the control: ${command}`);
    }
    // Read the predicates out of the jq command that ACTUALLY runs, so a
    // weakened filter is caught while an echoed correct copy is not credited.
    const countCommand = commandStartingWith(run, MANUAL_CI_COUNT_PREFIX);
    if (countCommand) {
      for (const predicate of MANUAL_CI_PREDICATES) {
        if (!countCommand.includes(predicate)) {
          push(`the manual-route ci count must bind ${predicate} — without it a non-ci-passed commit satisfies the gate`);
        }
      }
    }
    const resolveEnv = asMap(resolve.env);
    if (!asText(resolveEnv.GH_TOKEN).includes("github.token")) {
      push(`"${STEP_GATE_RESOLVE}" must read the Actions API through the workflow's own github.token (env.GH_TOKEN)`);
    }
    if (!run.includes("${DEPLOY_PATH_SCOPE}")) {
      push(`"${STEP_GATE_RESOLVE}" must scope the lane with DEPLOY_PATH_SCOPE — workflow_run carries no paths: filter`);
    }
  }
  const gateOutputs = asMap(gate.outputs);
  if (!asText(gateOutputs.proceed).includes("steps.resolve.outputs.proceed")) {
    push(`the ${GATE_JOB} job must export steps.resolve.outputs.proceed`);
  }
  if (!asText(gateOutputs.source_sha).includes("steps.resolve.outputs.source_sha")) {
    push(`the ${GATE_JOB} job must export steps.resolve.outputs.source_sha`);
  }

  // --- deploy job: gated, environment-scoped, source-pinned ----------------
  const needs = Array.isArray(deploy.needs) ? deploy.needs.map(asText) : [asText(deploy.needs)];
  if (!needs.includes(GATE_JOB)) push(`the ${DEPLOY_JOB} job must depend on ${GATE_JOB}`);
  if (!asText(deploy.if).includes("needs.gate.outputs.proceed == 'true'")) {
    push(`the ${DEPLOY_JOB} job must run only when needs.gate.outputs.proceed == 'true'`);
  }
  if (asText(deploy.environment) !== "production") push(`the ${DEPLOY_JOB} job must run in the production environment`);
  if (asText(asMap(asMap(deploy.defaults).run)["working-directory"]) !== "apps/todos") {
    push(`the ${DEPLOY_JOB} job default working-directory must be apps/todos`);
  }

  const deploySteps = stepsOf(deploy);

  const checkout = stepNamed(deploySteps, STEP_CHECKOUT);
  if (!checkout) {
    push(`the ${DEPLOY_JOB} job is missing its "${STEP_CHECKOUT}" step`);
  } else {
    const ref = asText(asMap(checkout.with).ref);
    if (!ref.includes("needs.gate.outputs.source_sha")) {
      push(`"${STEP_CHECKOUT}" must check out needs.gate.outputs.source_sha, found ${JSON.stringify(ref)}`);
    }
    if (asText(asMap(checkout.with)["persist-credentials"]) !== "false") {
      push(`"${STEP_CHECKOUT}" must set persist-credentials: false`);
    }
  }

  const verifySource = stepNamed(deploySteps, STEP_VERIFY_SOURCE);
  if (!verifySource) {
    push(`the ${DEPLOY_JOB} job is missing its "${STEP_VERIFY_SOURCE}" step`);
  } else {
    const run = asText(verifySource.run);
    for (const command of [
      'test "$(git rev-parse HEAD)" = "${GATED_SHA}"',
      'git merge-base --is-ancestor "${GATED_SHA}^{commit}" refs/remotes/origin/main',
      '[[ "${GITHUB_REF}" == "refs/heads/main" ]]',
      '[[ "${GATED_SHA}" == "${main_tip}" ]]',
    ]) {
      if (!runsCommand(run, command)) push(`"${STEP_VERIFY_SOURCE}" does not run the control: ${command}`);
    }
  }

  const trivy = stepNamed(deploySteps, STEP_TRIVY);
  if (trivy) {
    const imageRef = asText(asMap(trivy.with)["image-ref"]);
    if (!imageRef.includes("needs.gate.outputs.source_sha")) {
      push(`"${STEP_TRIVY}" must scan the gated source tag, found ${JSON.stringify(imageRef)}`);
    }
  } else {
    push(`the ${DEPLOY_JOB} job is missing its "${STEP_TRIVY}" step`);
  }

  const oidc = stepNamed(deploySteps, STEP_OIDC);
  if (!oidc) {
    push(`the ${DEPLOY_JOB} job is missing its "${STEP_OIDC}" step`);
  } else if (
    asText(asMap(oidc.with)["role-to-assume"]) !== "arn:aws:iam::${{ env.AWS_ACCOUNT_ID }}:role/todos-prod-gha-deploy"
  ) {
    push(`"${STEP_OIDC}" must assume the todos-prod-gha-deploy role in the pinned account`);
  }

  // Material AWS controls, each required at a command position in its own step.
  const stepControls: [string, string[]][] = [
    [STEP_MANIFEST, [
      "aws sts get-caller-identity",
      "aws ssm get-parameter",
      '[[ "${cluster}" == "${EXPECTED_CLUSTER}" ]]',
      '[[ "${service}" == "${EXPECTED_SERVICE}" ]]',
      '[[ "${migration_family}" == "${EXPECTED_MIGRATION_FAMILY}" ]]',
      '[[ "${ecr_url}" == "${expected_ecr_url}" ]]',
    ]],
    [STEP_ECR, ["aws ecr describe-repositories"]],
    [STEP_PUSH, ["docker push", "aws ecr describe-images"]],
    [STEP_MIGRATION, ["aws ecs run-task", "aws ecs wait tasks-stopped"]],
    [STEP_DEPLOY, ["aws ecs register-task-definition", "aws ecs update-service", "aws ecs wait services-stable"]],
    [STEP_VERIFY_LIVE, ['[[ "${deployed_image}" == "${IMAGE}" ]]', "curl"]],
    [STEP_ROLLBACK, [
      "aws ecs update-service",
      "aws ecs wait services-stable",
      '[[ "${live}" == "${PREVIOUS_TASK_DEFINITION}" ]]',
    ]],
  ];
  for (const [stepName, controls] of stepControls) {
    const step = stepNamed(deploySteps, stepName);
    if (!step) {
      push(`the ${DEPLOY_JOB} job is missing its "${stepName}" step`);
      continue;
    }
    const run = asText(step.run);
    for (const control of controls) {
      if (!runsCommand(run, control)) push(`"${stepName}" does not run the control: ${control}`);
    }
  }

  const rollback = stepNamed(deploySteps, STEP_ROLLBACK);
  if (rollback) {
    const condition = asText(rollback.if);
    if (!condition.includes("failure()") || !condition.includes("steps.deploy.outputs.service_mutated == 'true'")) {
      push(`"${STEP_ROLLBACK}" must be conditioned on failure() and steps.deploy.outputs.service_mutated == 'true'`);
    }
  }

  const deployStep = stepNamed(deploySteps, STEP_DEPLOY);
  if (deployStep && !asText(deployStep.run).includes("service_mutated=true")) {
    push(`"${STEP_DEPLOY}" must record service_mutated=true before mutating the service`);
  }

  const verifyLive = stepNamed(deploySteps, STEP_VERIFY_LIVE);
  if (verifyLive && !asText(verifyLive.run).includes("hasna.todos.production_deploy.v1")) {
    push(`"${STEP_VERIFY_LIVE}" must emit the hasna.todos.production_deploy.v1 evidence document`);
  }

  // --- every action pinned to a full commit --------------------------------
  for (const job of [gate, deploy]) {
    for (const step of stepsOf(job)) {
      const uses = asText(step.uses);
      if (uses === "") continue;
      if (!/@[0-9a-f]{40}$/.test(uses)) push(`action is not pinned to a full commit: ${uses}`);
    }
  }

  // --- fail-closed ordering -------------------------------------------------
  const order = DEPLOY_STEP_ORDER.map((name) => deploySteps.findIndex((step) => asText(step.name) === name));
  const present = order.every((index) => index >= 0);
  const ascending = order.every((index, position) => position === 0 || index > order[position - 1]);
  if (!present || !ascending) {
    push("deployment controls are not in fail-closed source/scan/auth/target/push/migrate/deploy/verify/rollback order");
  }

  return errors;
}

function ciWorkflowName(root: string): string {
  const document = asMap(parseYaml(readFileSync(join(root, CI_WORKFLOW), "utf8")));
  return asText(document.name);
}

// ---------------------------------------------------------------------------
// Two-sided self-test
// ---------------------------------------------------------------------------

/** The real deploy-step invocation the material-control check must require. */
const REAL_UPDATE_SERVICE = [
  '          aws ecs update-service \\',
  '            --cluster "${CLUSTER}" \\',
  '            --service "${SERVICE}" \\',
  '            --task-definition "${deployed_task_definition}" >/dev/null',
].join("\n");

const QUOTED_UPDATE_SERVICE =
  '          echo "aws ecs update-service --cluster ${CLUSTER} --service ${SERVICE} --task-definition ${deployed_task_definition}" >/dev/null';

const NOOP_UPDATE_SERVICE =
  '          true # aws ecs update-service --cluster "${CLUSTER}" --service "${SERVICE}" --task-definition "${deployed_task_definition}"';

interface Mutation {
  label: string;
  mutate: (source: string) => string;
  /** Substring the OLD substring-only gate matched; must survive the mutation. */
  survivingText?: string;
  expect: (errors: string[]) => boolean;
}

const MUTATIONS: Mutation[] = [
  {
    label: "quoted (echoed) aws ecs update-service in the deploy step",
    mutate: (source) => source.replace(REAL_UPDATE_SERVICE, QUOTED_UPDATE_SERVICE),
    survivingText: "aws ecs update-service",
    expect: (errors) => errors.some((error) => error.includes(`"${STEP_DEPLOY}" does not run the control: aws ecs update-service`)),
  },
  {
    label: "no-op (commented) aws ecs update-service in the deploy step",
    mutate: (source) => source.replace(REAL_UPDATE_SERVICE, NOOP_UPDATE_SERVICE),
    survivingText: "aws ecs update-service",
    expect: (errors) => errors.some((error) => error.includes(`"${STEP_DEPLOY}" does not run the control: aws ecs update-service`)),
  },
  {
    label: "no-op rollback verification",
    mutate: (source) =>
      source.replace(
        '          [[ "${live}" == "${PREVIOUS_TASK_DEFINITION}" ]] || { echo "rollback did not restore the previous task definition" >&2; exit 1; }',
        '          true # [[ "${live}" == "${PREVIOUS_TASK_DEFINITION}" ]]',
      ),
    survivingText: '[[ "${live}" == "${PREVIOUS_TASK_DEFINITION}" ]]',
    expect: (errors) => errors.some((error) => error.includes(`"${STEP_ROLLBACK}" does not run the control`)),
  },
  {
    label: "retargeted production service",
    mutate: (source) =>
      source.replace("EXPECTED_SERVICE: todos-prod", "EXPECTED_SERVICE: wrong-service # EXPECTED_SERVICE: todos-prod"),
    survivingText: "EXPECTED_SERVICE: todos-prod",
    expect: (errors) => errors.some((error) => error.includes("env.EXPECTED_SERVICE must pin todos-prod")),
  },
  {
    label: "independent push trigger that races ci",
    mutate: (source) =>
      source.replace(
        "on:\n  workflow_run:\n    workflows: [ci]\n    types: [completed]\n    branches: [main]\n",
        'on:\n  push:\n    branches: [main]\n    paths: ["apps/todos/**"]\n',
      ),
    expect: (errors) =>
      errors.some((error) => error.includes("must not carry its own push trigger")) &&
      errors.some((error) => error.includes("on.workflow_run is missing")),
  },
  {
    label: "gate that accepts a failed ci run",
    mutate: (source) =>
      source.replace(
        "github.event.workflow_run.conclusion == 'success' && ",
        "",
      ),
    expect: (errors) => errors.some((error) => error.includes("conclusion == 'success'")),
  },
  {
    label: "manual run released from the current main tip",
    mutate: (source) =>
      source.replace(
        '            [[ "${GATED_SHA}" == "${main_tip}" ]] || { echo "manual deploy must target the exact current origin/main commit ${main_tip}, received ${GATED_SHA}" >&2; exit 1; }\n',
        "",
      ),
    expect: (errors) => errors.some((error) => error.includes(`"${STEP_VERIFY_SOURCE}" does not run the control`)),
  },
  {
    // The exact P1 this cycle closes: the manual route resolved the tip and
    // opened the lane without ever proving ci had passed for it.
    label: "manual dispatch released from the ci-success binding",
    mutate: (source) =>
      source.replace(
        '              [[ "${ci_success_count}" -ge 1 ]] || { echo "manual deploy refused: no completed successful ${REQUIRED_CI_WORKFLOW} push run on main for the exact origin/main tip ${source_sha}" >&2; exit 1; }\n',
        "",
      ),
    survivingText: "ci_success_count",
    expect: (errors) =>
      errors.some((error) => error.includes('does not run the control: [[ "${ci_success_count}" -ge 1 ]]')),
  },
  {
    label: "manual dispatch ci binding weakened to any concluded run",
    mutate: (source) => source.replace('.conclusion == "success"', ".conclusion != null"),
    survivingText: "ci_success_count",
    expect: (errors) => errors.some((error) => error.includes('must bind .conclusion == "success"')),
  },
  {
    label: "manual dispatch ci binding released from the exact commit",
    mutate: (source) => source.replace("&head_sha=${source_sha}", ""),
    survivingText: "gh api",
    expect: (errors) => errors.some((error) => error.includes("does not run the control: gh api")),
  },
  {
    label: "manual dispatch ci read stripped of its token surface",
    mutate: (source) => source.replace("          GH_TOKEN: ${{ github.token }}\n", ""),
    survivingText: "gh api",
    expect: (errors) => errors.some((error) => error.includes("env.GH_TOKEN")),
  },
  {
    label: "gate granted the deployment OIDC token",
    mutate: (source) =>
      source.replace(
        "    permissions:\n      contents: read\n      actions: read\n",
        "    permissions:\n      contents: read\n      actions: read\n      id-token: write\n",
      ),
    expect: (errors) => errors.some((error) => error.includes("must not hold permissions.id-token")),
  },
  {
    label: "gate stripped of the actions read it needs to verify ci",
    mutate: (source) => source.replace("      contents: read\n      actions: read\n", "      contents: read\n"),
    expect: (errors) => errors.some((error) => error.includes("permissions.actions: read")),
  },
  {
    label: "checkout released from the gated commit",
    mutate: (source) => source.replace("          ref: ${{ needs.gate.outputs.source_sha }}\n", "          ref: main\n"),
    expect: (errors) => errors.some((error) => error.includes(`"${STEP_CHECKOUT}" must check out needs.gate.outputs.source_sha`)),
  },
  {
    label: "deploy job released from the gate",
    mutate: (source) => source.replace("    if: ${{ needs.gate.outputs.proceed == 'true' }}\n", ""),
    expect: (errors) => errors.some((error) => error.includes("needs.gate.outputs.proceed == 'true'")),
  },
];

function selfTest(root: string): boolean {
  const real = readFileSync(join(root, WORKFLOW), "utf8");
  const ciName = ciWorkflowName(root);
  let ok = true;

  // Instrument controls: the command analyser must both fire and stay silent.
  const analyser: [string, string, string, boolean][] = [
    ["real command", "aws ecs update-service \\\n  --cluster x", "aws ecs update-service", true],
    ["quoted command", 'echo "aws ecs update-service --cluster x"', "aws ecs update-service", false],
    ["commented command", 'true # aws ecs update-service --cluster x', "aws ecs update-service", false],
    ["piped-into command", 'printf x | aws ecs update-service', "aws ecs update-service", true],
    ["command substitution", 'account="$(aws sts get-caller-identity --query Account)"', "aws sts get-caller-identity", true],
    ["single-quoted substitution text", "account='$(aws sts get-caller-identity)'", "aws sts get-caller-identity", false],
  ];
  for (const [label, snippet, control, expected] of analyser) {
    const actual = runsCommand(snippet, control);
    if (actual !== expected) {
      console.error(`todos-deploy self-test: FAIL — command analyser on ${label}: expected ${expected}, got ${actual}`);
      ok = false;
    }
  }

  for (const mutation of MUTATIONS) {
    const mutated = mutation.mutate(real);
    if (mutated === real) {
      console.error(`todos-deploy self-test: FAIL — mutation "${mutation.label}" did not change the workflow`);
      ok = false;
      continue;
    }
    if (mutation.survivingText && !mutated.includes(mutation.survivingText)) {
      console.error(
        `todos-deploy self-test: FAIL — mutation "${mutation.label}" must keep the text "${mutation.survivingText}" so it proves a substring-only gate would have passed it`,
      );
      ok = false;
      continue;
    }
    const errors = validateTodosDeploy(mutated, ciName);
    if (!mutation.expect(errors)) {
      console.error(`todos-deploy self-test: FAIL — mutation "${mutation.label}" was not rejected`);
      console.error(errors.length === 0 ? "  (no errors reported)" : errors.map((e) => `  ${e}`).join("\n"));
      ok = false;
    }
  }

  const clean = validateTodosDeploy(real, ciName);
  if (clean.length > 0) {
    console.error("todos-deploy self-test: FAIL — the real workflow was rejected");
    console.error(clean.map((error) => `  ${error}`).join("\n"));
    ok = false;
  }

  if (ok) {
    console.log(
      `todos-deploy self-test: PASS (${MUTATIONS.length} mutations rejected, ${analyser.length} analyser controls, real workflow accepted)`,
    );
  }
  return ok;
}

const root = process.cwd();

if (process.argv.includes("--self-test")) process.exit(selfTest(root) ? 0 : 1);

const errors = validateTodosDeploy(readFileSync(join(root, WORKFLOW), "utf8"), ciWorkflowName(root));
if (errors.length > 0) {
  for (const error of errors) console.error(`  ${error}`);
  console.error(`todos-deploy: FAIL — ${errors.length} violation(s)`);
  process.exit(1);
}
console.log(
  "todos-deploy: PASS — ci-gated trigger, gated source pin, target-pinned, scan-gated, digest-pinned, rollback-ready",
);
