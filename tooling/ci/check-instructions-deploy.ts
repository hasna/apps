/** Static, two-sided policy gate for the protected Instructions production lane. */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asArray,
  asMap,
  asText,
  parseYaml,
  stripInlineComment,
  type YamlNode,
} from "./yaml.ts";

const WORKFLOW = ".github/workflows/deploy-instructions.yml";
const CI_WORKFLOW = ".github/workflows/ci.yml";
const PACKAGE_JSON = "package.json";
const GATE = "gate";
const DEPLOY = "deploy";

const NAMES = {
  resolve: "Resolve the deployable commit",
  checkout: "Checkout exact source",
  source: "Verify source is the gated ci-passed main commit",
  build: "Build native ARM64 image locally",
  version: "Verify shipped runtime and package version",
  trivy: "Generate local vulnerability report",
  trivyGate: "Enforce local vulnerability gate",
  oidc: "Configure AWS credentials with GitHub OIDC",
  manifest: "Resolve manifest and fail closed on production target mismatch",
  anchor: "Capture rollback anchor and verify live service authority",
  dataBefore: "Export and validate complete pre-migration domain archive",
  backup: "Create immutable pre-deploy S3 backup",
  ecr: "Verify immutable scan-on-push ECR repository",
  push: "Push scanned image and resolve immutable digest",
  remoteScan: "Wait for ECR scan and enforce vulnerability gate",
  migrate: "Run one-shot migration task on the digest",
  rollout: "Register digest-pinned task definition and update service",
  verify: "Verify exact live task definition, digest, and health",
  rollback: "Restore rollback anchor after a failed service rollout",
} as const;

const REQUIRED_ENV: Record<string, string> = {
  AWS_ACCOUNT_ID: "789877399345",
  DEPLOY_MANIFEST: "/hasna/deploy/instructions",
  EXPECTED_CLUSTER: "oss-fleet-prod",
  EXPECTED_SERVICE: "instructions-prod",
  EXPECTED_WEB_FAMILY: "instructions-prod",
  EXPECTED_ECR_REPOSITORY: "instructions",
  EXPECTED_MIGRATION_FAMILY: "instructions-prod-migrate",
  DEPLOY_PATH_SCOPE: "apps/instructions/**",
  REQUIRED_CI_WORKFLOW: "ci",
  CI_WORKFLOW_FILE: "ci.yml",
  PUBLIC_BASE_URL: "https://api.hasna.com/instructions",
  CLIENT_KEY_SECRET_ID: "hasna/oss/instructions/api-key",
  EXPECTED_BACKUP_BUCKET: "hasna-instructions-prod-backups-789877399345",
};

const ORDER = [
  NAMES.checkout,
  NAMES.source,
  NAMES.build,
  NAMES.version,
  NAMES.trivy,
  NAMES.trivyGate,
  NAMES.oidc,
  NAMES.manifest,
  NAMES.anchor,
  NAMES.dataBefore,
  NAMES.backup,
  NAMES.ecr,
  NAMES.push,
  NAMES.remoteScan,
  NAMES.migrate,
  NAMES.rollout,
  NAMES.verify,
  NAMES.rollback,
];

type Step = Record<string, YamlNode>;
const stepsOf = (job: Record<string, YamlNode>): Step[] =>
  asArray(job.steps).map(asMap);
const named = (steps: Step[], name: string): Step | undefined =>
  steps.find((s) => asText(s.name) === name);
const active = (text: string): string =>
  text.split("\n").map(stripInlineComment).join("\n");
const runOf = (steps: Step[], name: string): string =>
  asText(named(steps, name)?.run);

const commandSubstitutions = (text: string): string[] => {
  const matches: string[] = [];
  let single = false;
  let double = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "'" && !double) single = !single;
    else if (text[i] === '"' && !single) double = !double;
    else if (!single && text[i] === "$" && text[i + 1] === "(") {
      let depth = 1;
      let innerSingle = false;
      let innerDouble = false;
      let j = i + 2;
      for (; j < text.length && depth > 0; j += 1) {
        if (text[j] === "'" && !innerDouble) innerSingle = !innerSingle;
        else if (text[j] === '"' && !innerSingle) innerDouble = !innerDouble;
        else if (!innerSingle && !innerDouble && text[j] === "(") depth += 1;
        else if (!innerSingle && !innerDouble && text[j] === ")") depth -= 1;
      }
      if (depth === 0) matches.push(text.slice(i + 2, j - 1));
      i = j - 1;
    }
  }
  return matches;
};

const effectiveCommands = (run: string): string[] => {
  const normalized = active(run).replace(/\\\n\s*/g, " ");
  const commands = normalized
    .split(/\n|;|&&|\|\|/)
    .map((segment) =>
      segment
        .trim()
        .replace(/^(?:if|then|elif|else|while|until|do|!|time)\s+/, ""),
    )
    .filter(Boolean);
  for (const inner of commandSubstitutions(normalized))
    commands.push(...effectiveCommands(inner));
  return commands;
};

const runsCommand = (run: string, command: string): boolean =>
  effectiveCommands(run).some(
    (candidate) => candidate === command || candidate.startsWith(`${command} `),
  );

const has = (run: string, fragment: string): boolean => {
  if (/^(?:aws|docker|curl|git|gh|bun|bunx|node)\s/.test(fragment))
    return runsCommand(run, fragment);
  return active(run).includes(fragment);
};

export interface JqExecution {
  ok: boolean;
  error?: string;
  document?: Record<string, unknown>;
}

/** Execute the exact archive-member and v2 manifest shell validator embedded in the workflow. */
export function executeDomainArchiveValidation(
  workflow: string,
  manifest: Record<string, unknown>,
  extraMembers: string[] = [],
  phase: "pre" | "post" = "pre",
): JqExecution {
  let doc: Record<string, YamlNode>;
  try {
    doc = asMap(parseYaml(workflow));
  } catch (error) {
    return { ok: false, error: `workflow parse failed: ${(error as Error).message}` };
  }
  const deploy = asMap(asMap(doc.jobs)[DEPLOY]);
  const script = runOf(stepsOf(deploy), phase === "pre" ? NAMES.dataBefore : NAMES.verify);
  const functionStart = script.indexOf("validate_domain_archive() {");
  const functionEnd = script.indexOf("\n}", functionStart);
  if (functionStart < 0 || functionEnd < 0)
    return { ok: false, error: "domain archive shell validator is missing" };
  const validator = script.slice(functionStart, functionEnd + 2);
  const scratch = mkdtempSync(join(tmpdir(), "instructions-deploy-archive-check-"));
  try {
    const source = join(scratch, "source");
    mkdirSync(source, { mode: 0o700 });
    writeFileSync(join(source, "manifest.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    writeFileSync(join(source, "domain.json"), "{}\n", { mode: 0o600 });
    for (const member of extraMembers) {
      if (!/^[a-zA-Z0-9._-]+$/.test(member))
        return { ok: false, error: "invalid synthetic archive member" };
      writeFileSync(join(source, member), "fixture\n", { mode: 0o600 });
    }
    const archive = join(scratch, "domain.tar.gz");
    const members = ["manifest.json", "domain.json", ...extraMembers];
    const packed = spawnSync("tar", ["-czf", archive, "-C", source, ...members], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (packed.error || packed.status !== 0)
      return { ok: false, error: `unable to create synthetic archive: ${packed.error?.message ?? packed.stderr.trim()}` };
    const extractedManifest = join(scratch, "extracted-manifest.json");
    const result = spawnSync(
      "bash",
      ["-c", `set -Eeuo pipefail\n${validator}\nvalidate_domain_archive "$1" "$2"`, "archive-validator", archive, extractedManifest],
      { encoding: "utf8", maxBuffer: 1_048_576, timeout: 5_000 },
    );
    if (result.error)
      return { ok: false, error: `unable to execute archive validator: ${result.error.message}` };
    if (result.status !== 0)
      return { ok: false, error: `domain archive validator rejected input: ${result.stderr.trim()}` };
    return { ok: true };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Execute the exact Object Lock jq expression embedded in the workflow. */
export function executeObjectLockExpression(
  workflow: string,
  response: Record<string, unknown>,
): JqExecution {
  let doc: Record<string, YamlNode>;
  try {
    doc = asMap(parseYaml(workflow));
  } catch (error) {
    return { ok: false, error: `workflow parse failed: ${(error as Error).message}` };
  }
  const deploy = asMap(asMap(doc.jobs)[DEPLOY]);
  const backup = runOf(stepsOf(deploy), NAMES.backup);
  const objectLock = backup.indexOf("get-object-lock-configuration");
  const marker = "jq -e '";
  const start = backup.indexOf(marker, objectLock);
  if (objectLock < 0 || start < 0)
    return { ok: false, error: "Object Lock jq command is missing" };
  const expressionStart = start + marker.length;
  const tail = backup.slice(expressionStart);
  const expressionTerminator = /\n\s*' <<<"\$\{object_lock\}"/.exec(tail);
  if (!expressionTerminator)
    return { ok: false, error: "Object Lock jq expression is missing" };
  const expression = tail.slice(0, expressionTerminator.index).trim();
  const result = spawnSync("jq", ["-e", expression], {
    encoding: "utf8",
    input: JSON.stringify(response),
    maxBuffer: 1_048_576,
    timeout: 5_000,
  });
  if (result.error)
    return { ok: false, error: `unable to execute jq: ${result.error.message}` };
  if (result.status !== 0)
    return {
      ok: false,
      error: `Object Lock jq rejected input: ${(result.stderr || result.stdout).trim()}`,
    };
  return { ok: true };
}

/** Execute the exact per-object WORM jq expression embedded in the workflow. */
export function executeWormObjectHeadExpression(
  workflow: string,
  response: Record<string, unknown>,
  nowEpoch: number,
  retainUntilEpoch: number,
  expectedVersionId = "version-1",
): JqExecution {
  let doc: Record<string, YamlNode>;
  try {
    doc = asMap(parseYaml(workflow));
  } catch (error) {
    return { ok: false, error: `workflow parse failed: ${(error as Error).message}` };
  }
  const deploy = asMap(asMap(doc.jobs)[DEPLOY]);
  const backup = runOf(stepsOf(deploy), NAMES.backup);
  const headObject = backup.indexOf("aws s3api head-object");
  const start = backup.indexOf("jq -e", headObject);
  if (headObject < 0 || start < 0)
    return { ok: false, error: "per-object WORM jq command is missing" };
  const expressionMarker = "--argjson retain_until_epoch \"${retain_until_epoch}\" '";
  const expressionStart = backup.indexOf(expressionMarker, start);
  if (expressionStart < 0)
    return { ok: false, error: "per-object WORM jq expression is missing" };
  const tail = backup.slice(expressionStart + expressionMarker.length);
  const expressionTerminator = /\n\s*' <<<"\$\{head_object\}"/.exec(tail);
  if (!expressionTerminator)
    return { ok: false, error: "per-object WORM jq expression is unterminated" };
  const expression = tail.slice(0, expressionTerminator.index).trim();
  const result = spawnSync(
    "jq",
    [
      "-e",
      "--arg",
      "object_version_id",
      expectedVersionId,
      "--argjson",
      "now_epoch",
      String(nowEpoch),
      "--argjson",
      "retain_until_epoch",
      String(retainUntilEpoch),
      expression,
    ],
    {
      encoding: "utf8",
      input: JSON.stringify(response),
      maxBuffer: 1_048_576,
      timeout: 5_000,
    },
  );
  if (result.error)
    return { ok: false, error: `unable to execute jq: ${result.error.message}` };
  if (result.status !== 0)
    return {
      ok: false,
      error: `per-object WORM jq rejected input: ${(result.stderr || result.stdout).trim()}`,
    };
  return { ok: true };
}

/** Execute the exact consecutive pre-migration integrity comparison embedded in the workflow. */
export function executeStableDomainIntegrityComparison(
  workflow: string,
  previousManifest: Record<string, unknown>,
  candidateManifest: Record<string, unknown>,
): JqExecution {
  let doc: Record<string, YamlNode>;
  try {
    doc = asMap(parseYaml(workflow));
  } catch (error) {
    return { ok: false, error: `workflow parse failed: ${(error as Error).message}` };
  }
  const deploy = asMap(asMap(doc.jobs)[DEPLOY]);
  const capture = runOf(stepsOf(deploy), NAMES.dataBefore);
  const marker = 'jq -e --slurpfile previous "${previous_manifest}" \'';
  const start = capture.indexOf(marker);
  if (start < 0) return { ok: false, error: "stable archive integrity comparison is missing" };
  const tail = capture.slice(start + marker.length);
  const expressionTerminator = /\n\s*' "\$\{candidate_manifest\}"/.exec(tail);
  if (!expressionTerminator)
    return { ok: false, error: "stable archive integrity comparison is unterminated" };
  const expression = tail.slice(0, expressionTerminator.index).trim();
  const scratch = mkdtempSync(join(tmpdir(), "instructions-deploy-stable-archive-check-"));
  try {
    const previousPath = join(scratch, "previous.json");
    writeFileSync(previousPath, `${JSON.stringify(previousManifest)}\n`, { mode: 0o600 });
    const result = spawnSync("jq", ["-e", "--slurpfile", "previous", previousPath, expression], {
      encoding: "utf8",
      input: JSON.stringify(candidateManifest),
      maxBuffer: 1_048_576,
      timeout: 5_000,
    });
    if (result.error)
      return { ok: false, error: `unable to execute stable archive integrity comparison: ${result.error.message}` };
    if (result.status !== 0)
      return { ok: false, error: `stable archive integrity comparison rejected input: ${(result.stderr || result.stdout).trim()}` };
    return { ok: true };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Execute the exact post-rollout integrity comparison embedded in the workflow. */
export function executeDomainIntegrityComparison(
  workflow: string,
  preManifest: Record<string, unknown>,
  postManifest: Record<string, unknown>,
): JqExecution {
  let doc: Record<string, YamlNode>;
  try {
    doc = asMap(parseYaml(workflow));
  } catch (error) {
    return { ok: false, error: `workflow parse failed: ${(error as Error).message}` };
  }
  const deploy = asMap(asMap(doc.jobs)[DEPLOY]);
  const verify = runOf(stepsOf(deploy), NAMES.verify);
  const marker = 'jq -e --slurpfile pre "${PRE_DEPLOY_MANIFEST}" \'';
  const start = verify.indexOf(marker);
  if (start < 0) return { ok: false, error: "domain integrity comparison is missing" };
  const tail = verify.slice(start + marker.length);
  const expressionTerminator = /\n\s*' "\$\{post_manifest\}"/.exec(tail);
  if (!expressionTerminator)
    return { ok: false, error: "domain integrity comparison is unterminated" };
  const expression = tail.slice(0, expressionTerminator.index).trim();
  const scratch = mkdtempSync(join(tmpdir(), "instructions-deploy-integrity-check-"));
  try {
    const prePath = join(scratch, "pre.json");
    writeFileSync(prePath, `${JSON.stringify(preManifest)}\n`, { mode: 0o600 });
    const result = spawnSync("jq", ["-e", "--slurpfile", "pre", prePath, expression], {
      encoding: "utf8",
      input: JSON.stringify(postManifest),
      maxBuffer: 1_048_576,
      timeout: 5_000,
    });
    if (result.error)
      return { ok: false, error: `unable to execute integrity comparison: ${result.error.message}` };
    if (result.status !== 0)
      return { ok: false, error: `domain integrity comparison rejected input: ${(result.stderr || result.stdout).trim()}` };
    return { ok: true };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Execute the exact deployment-evidence jq expression embedded in the workflow. */
export function executeDeploymentEvidenceExpression(
  workflow: string,
): JqExecution {
  let doc: Record<string, YamlNode>;
  try {
    doc = asMap(parseYaml(workflow));
  } catch (error) {
    return { ok: false, error: `workflow parse failed: ${(error as Error).message}` };
  }
  const deploy = asMap(asMap(doc.jobs)[DEPLOY]);
  const verify = runOf(stepsOf(deploy), NAMES.verify);
  const marker = "> deploy-evidence.json";
  const markerIndex = verify.indexOf(marker);
  if (markerIndex < 0) return { ok: false, error: "deployment evidence output is missing" };
  const prefix = verify.slice(0, markerIndex);
  const commandStart = prefix.lastIndexOf("jq -n");
  if (commandStart < 0) return { ok: false, error: "deployment evidence jq command is missing" };
  const command = prefix.slice(commandStart);
  const expressions = [...command.matchAll(/^\s*'([^'\n]+)'\s*\\?\s*$/gm)];
  const expression = expressions.at(-1)?.[1];
  if (!expression) return { ok: false, error: "deployment evidence jq expression is missing" };
  const argNames = [...command.matchAll(/--arg\s+([A-Za-z_][A-Za-z0-9_]*)\s+/g)].map(
    (match) => match[1],
  );
  const fixtures: Record<string, string> = {
    backup_id: "fixture-backup-id",
    backup_sha256: "a".repeat(64),
    backup_size_bytes: "4096",
    backup_payload_version_id: "fixture-payload-version-id",
    backup_manifest_version_id: "fixture-manifest-version-id",
  };
  const integrity = {
    algorithm: "sha256",
    canonicalization: "hasna.instructions.logical-json/v1",
    counts: {
      configs: 260,
      config_snapshots: 510,
      profiles: 8,
      profile_config_bindings: 23,
      profile_asset_bindings: 4,
      machines: 3,
    },
    hashes: {
      configs: "a".repeat(64),
      config_snapshots: "b".repeat(64),
      profiles: "c".repeat(64),
      profile_config_bindings: "d".repeat(64),
      profile_asset_bindings: "e".repeat(64),
      machines: "f".repeat(64),
    },
    domain_sha256: "9".repeat(64),
  };
  const scratch = mkdtempSync(join(tmpdir(), "instructions-deploy-evidence-check-"));
  try {
    const args = ["-n"];
    for (const name of argNames) args.push("--arg", name, fixtures[name] ?? `fixture-${name}`);
    const slurpNames = [...command.matchAll(/--slurpfile\s+([A-Za-z_][A-Za-z0-9_]*)\s+/g)].map(
      (match) => match[1],
    );
    for (const name of slurpNames) {
      const fixturePath = join(scratch, `${name}.json`);
      writeFileSync(fixturePath, `${JSON.stringify({ integrity })}\n`, { mode: 0o600 });
      args.push("--slurpfile", name, fixturePath);
    }
    args.push(expression);
    const result = spawnSync("jq", args, { encoding: "utf8", maxBuffer: 1_048_576, timeout: 5_000 });
  if (result.error)
    return { ok: false, error: `unable to execute jq: ${result.error.message}` };
  if (result.status !== 0)
    return {
      ok: false,
      error: `deployment evidence jq failed: ${(result.stderr || result.stdout).trim()}`,
    };
  try {
    return { ok: true, document: JSON.parse(result.stdout) as Record<string, unknown> };
    } catch (error) {
      return { ok: false, error: `deployment evidence was not JSON: ${(error as Error).message}` };
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function validateInstructionsDeploy(
  workflow: string,
  ciName = "ci",
  bunVersion = "1.3.14",
): string[] {
  const errors: string[] = [];
  const fail = (m: string) => errors.push(m);
  const doc = asMap(parseYaml(workflow));
  const text = active(workflow);
  const triggers = asMap(doc.on);
  if ("push" in triggers) fail("workflow must not have a push trigger");
  if ("pull_request" in triggers)
    fail("workflow must not have a pull_request trigger");
  if (!("workflow_dispatch" in triggers)) fail("workflow_dispatch is required");
  const wr = asMap(triggers.workflow_run);
  if (!asArray(wr.workflows).map(asText).includes(ciName))
    fail(`workflow_run must bind to ${ciName}`);
  if (!asArray(wr.types).map(asText).includes("completed"))
    fail("workflow_run must require completed");
  if (!asArray(wr.branches).map(asText).includes("main"))
    fail("workflow_run must bind to main");

  const env = asMap(doc.env);
  for (const [key, value] of Object.entries(REQUIRED_ENV))
    if (asText(env[key]) !== value) fail(`env.${key} must equal ${value}`);
  const permissions = asMap(doc.permissions);
  if (
    asText(permissions.contents) !== "read" ||
    asText(permissions["id-token"]) !== "write"
  )
    fail("workflow permissions must be contents:read and id-token:write");

  const jobs = asMap(doc.jobs);
  const gate = asMap(jobs[GATE]);
  const deploy = asMap(jobs[DEPLOY]);
  if (!Object.keys(gate).length) fail("gate job is missing");
  if (!Object.keys(deploy).length) fail("deploy job is missing");
  const gateIf = asText(gate.if);
  for (const p of [
    "github.event_name == 'workflow_dispatch'",
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
  ])
    if (!gateIf.includes(p)) fail(`gate condition must require ${p}`);
  const gp = asMap(gate.permissions);
  if (
    asText(gp.contents) !== "read" ||
    asText(gp.actions) !== "read" ||
    "id-token" in gp
  )
    fail("gate permissions must be contents/actions read with no id-token");
  const gateRun = runOf(stepsOf(gate), NAMES.resolve);
  for (const p of [
    '[[ "${RUN_CONCLUSION}" == "success" ]]',
    '[[ "${RUN_EVENT}" == "push" ]]',
    '[[ "${RUN_BRANCH}" == "main" ]]',
    '[[ "${RUN_NAME}" == "${REQUIRED_CI_WORKFLOW}" ]]',
    '[[ "${GITHUB_REF}" == "refs/heads/main" ]]',
    'source_sha="${main_tip}"',
    "head_sha=${source_sha}",
    '.conclusion == "success"',
    '[[ "${ci_success_count}" -ge 1 ]]',
    "${DEPLOY_PATH_SCOPE}",
  ])
    if (!has(gateRun, p)) fail(`gate resolver missing control: ${p}`);

  const needs = Array.isArray(deploy.needs)
    ? deploy.needs.map(asText)
    : [asText(deploy.needs)];
  if (
    !needs.includes(GATE) ||
    !asText(deploy.if).includes("needs.gate.outputs.proceed == 'true'")
  )
    fail("deploy must depend on the successful gate output");
  if (asText(deploy.environment) !== "production")
    fail("deploy must use the production environment");
  if (
    asText(asMap(asMap(deploy.defaults).run)["working-directory"]) !==
    "apps/instructions"
  )
    fail("deploy working-directory must be apps/instructions");
  const steps = stepsOf(deploy);
  for (const name of ORDER)
    if (!named(steps, name)) fail(`missing step: ${name}`);
  const indices = ORDER.map((n) =>
    steps.findIndex((s) => asText(s.name) === n),
  );
  if (!indices.every((n, i) => n >= 0 && (i === 0 || n > indices[i - 1])))
    fail("deployment steps are not in fail-closed order");

  const checkout = named(steps, NAMES.checkout);
  if (
    !asText(asMap(checkout?.with).ref).includes(
      "needs.gate.outputs.source_sha",
    ) ||
    asText(asMap(checkout?.with)["persist-credentials"]) !== "false"
  )
    fail("checkout must pin the gated SHA without persisted credentials");
  const source = runOf(steps, NAMES.source);
  for (const p of [
    'test "$(git rev-parse HEAD)" = "${GATED_SHA}"',
    '[[ "${GATED_SHA}" == "${main_tip}" ]]',
  ])
    if (!has(source, p)) fail(`source verification missing: ${p}`);
  const build = runOf(steps, NAMES.build);
  for (const p of [
    "docker buildx build",
    "--platform linux/arm64",
    "--target runner",
    "--load",
    "org.opencontainers.image.revision=${SOURCE_SHA}",
  ])
    if (!has(build, p)) fail(`build missing: ${p}`);
  const version = runOf(steps, NAMES.version);
  for (const p of [
    'require("./package.json").version',
    "--entrypoint bun",
    "dist/server/index.js --version",
  ])
    if (!has(version, p)) fail(`version verification missing: ${p}`);
  const setup = named(
    steps,
    "Set up host Bun for shipped-artefact verification",
  );
  if (
    !asText(setup?.uses).startsWith("oven-sh/setup-bun@") ||
    asText(asMap(setup?.with)["bun-version"]) !== bunVersion
  )
    fail(`host Bun must be pinned to ${bunVersion}`);
  if (
    steps.findIndex((s) => s === setup) >
    steps.findIndex((s) => asText(s.name) === NAMES.oidc)
  )
    fail("host Bun setup must precede OIDC");

  const oidc = named(steps, NAMES.oidc);
  if (
    asText(asMap(oidc?.with)["role-to-assume"]) !==
    "arn:aws:iam::${{ env.AWS_ACCOUNT_ID }}:role/instructions-prod-gha-deploy"
  )
    fail("OIDC role pin is wrong");
  const manifest = runOf(steps, NAMES.manifest);
  for (const p of [
    "aws sts get-caller-identity",
    "aws ssm get-parameter",
    '[[ "${cluster}" == "${EXPECTED_CLUSTER}" ]]',
    '[[ "${service}" == "${EXPECTED_SERVICE}" ]]',
    '[[ "${web_family}" == "${EXPECTED_WEB_FAMILY}" ]]',
    '[[ "${migration_family}" == "${EXPECTED_MIGRATION_FAMILY}" ]]',
    '[[ "${ecr_url}" == "${expected_ecr_url}" ]]',
  ])
    if (!has(manifest, p)) fail(`manifest validation missing: ${p}`);
  const dataBefore = runOf(steps, NAMES.dataBefore);
  for (const p of [
    "aws secretsmanager get-secret-value",
    'echo "::add-mask::${client_key}"',
    "if ! docker run",
    "dist/cli/index.js export --output /archive/instructions-domain-candidate-${capture_attempt}.tar.gz",
    "chmod 600 /archive/instructions-domain-candidate-${capture_attempt}.tar.gz",
    "max_capture_attempts=5",
    'for capture_attempt in $(seq 1 "${max_capture_attempts}")',
    "candidate-domain-manifest-${capture_attempt}.json",
    '.integrity == $previous[0].integrity',
    'mv "${candidate_archive}" "${pre_archive}"',
    'mv "${candidate_manifest}" "${pre_manifest}"',
    "stable_archive=true",
    "failed to capture two consecutive identical valid archives",
    "validate_domain_archive",
    "tar -tzf",
    "archive contains unexpected members",
    "tar -xOzf",
    "pre-domain-manifest.json",
    'schema == "hasna.instructions.domain-archive/v2"',
    'version == "2.0.0"',
    'payload.path == "domain.json"',
    "configs",
    "config_snapshots",
    "profiles",
    "profile_config_bindings",
    "profile_asset_bindings",
    "machines",
    ".integrity.counts",
    ".integrity.hashes",
    ".integrity.domain_sha256",
    "archive=%s",
    "manifest=%s",
  ])
    if (!has(dataBefore, p)) fail(`pre-migration archive control missing: ${p}`);
  if ((dataBefore.match(/dist\/cli\/index\.js export/g) ?? []).length !== 1)
    fail("pre-migration archive capture must have exactly one bounded-loop export command");
  const stableIntegrity = executeStableDomainIntegrityComparison(workflow, { integrity: { domain_sha256: "a".repeat(64) } }, { integrity: { domain_sha256: "a".repeat(64) } });
  if (!stableIntegrity.ok)
    fail(`stable archive integrity comparison rejected equal manifests: ${stableIntegrity.error}`);
  const changedStableIntegrity = executeStableDomainIntegrityComparison(workflow, { integrity: { domain_sha256: "a".repeat(64) } }, { integrity: { domain_sha256: "b".repeat(64) } });
  if (changedStableIntegrity.ok)
    fail("stable archive integrity comparison accepted changed integrity");
  const backup = runOf(steps, NAMES.backup);
  for (const p of [
    "aws s3api head-bucket",
    "get-bucket-versioning",
    "get-object-lock-configuration",
    '$lock.ObjectLockEnabled == "Enabled"',
    '$retention.Mode == "COMPLIANCE"',
    "$retention.Days",
    "$retention.Years",
    "COMPLIANCE default retention period",
    "get-public-access-block",
    "get-bucket-encryption",
    '[[ "${PRE_DEPLOY_ARCHIVE}" == "${backup_dir}/instructions-domain-pre.tar.gz" ]]',
    "pre-deploy archive permissions are not owner-only",
    "storage backup push /backup/instructions-domain-pre.tar.gz",
    'payload_version_id="$(jq -er',
    '"${backup_dir}/s3-backup.json")"',
    'manifest_version_id="$(jq -er',
    '-e PAYLOAD_VERSION_ID="${payload_version_id}"',
    '-e MANIFEST_VERSION_ID="${manifest_version_id}"',
    "storage backup verify",
    '--payload-version-id "${PAYLOAD_VERSION_ID}"',
    '--manifest-version-id "${MANIFEST_VERSION_ID}"',
    'archive_sha256="$(sha256sum "${PRE_DEPLOY_ARCHIVE}"',
    "archive_size=\"$(stat -c '%s' \"${PRE_DEPLOY_ARCHIVE}\")\"",
    '.sha256 == $sha256 and .sizeBytes == $size_bytes',
    "hasna.instructions.redacted-backup-receipt.v2",
    "payloadKey",
    "manifestKey",
    "payloadVersionId",
    "manifestVersionId",
    "--payload-version-id",
    "--manifest-version-id",
    "payload_key=\"$(jq -er '.payloadKey' \"${backup_receipt}\")\"",
    "manifest_key=\"$(jq -er '.manifestKey' \"${backup_receipt}\")\"",
    "aws s3api head-object",
    '--version-id "${object_version_id}"',
    '(.VersionId == $object_version_id)',
    "aws s3api get-object",
    'sha256sum "${versioned_payload}"',
    "payload_version_id=%s",
    "manifest_version_id=%s",
    '.ObjectLockMode == "COMPLIANCE"',
    ".ObjectLockRetainUntilDate",
    "$retain_until_epoch > $now_epoch",
    'verify_worm_object "payload" "${payload_key}" "${payload_version_id}"',
    'verify_worm_object "manifest" "${manifest_key}" "${manifest_version_id}"',
    "pre-deploy-${SOURCE_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}",
  ])
    if (!has(backup, p)) fail(`S3 backup control missing: ${p}`);
  const pushCommand = backup.indexOf("storage backup push /backup/instructions-domain-pre.tar.gz");
  const runnerVersionParse = backup.indexOf('payload_version_id="$(jq -er', pushCommand);
  const verifyCommand = backup.indexOf("storage backup verify", runnerVersionParse);
  if (pushCommand < 0 || runnerVersionParse < pushCommand || verifyCommand < runnerVersionParse)
    fail("S3 backup must push in the app image, parse version IDs on the runner, then verify in the app image");
  const pushContainer = backup.slice(backup.lastIndexOf("docker run --rm", pushCommand), runnerVersionParse);
  if (pushContainer.includes("jq"))
    fail("S3 backup push container must not depend on jq");
  const backupContainers = [...backup.matchAll(/docker run --rm/g)].map((match) => match.index);
  if (backupContainers.length !== 2) {
    fail("S3 backup must use separate push and version-pinned verification containers");
  } else if (runnerVersionParse >= 0) {
    const verificationContainerStart = backupContainers.find((index) => index > runnerVersionParse);
    const verificationContainerEnd = verificationContainerStart === undefined
      ? -1
      : backup.indexOf("\narchive_sha256=", verificationContainerStart);
    if (verificationContainerStart === undefined || verificationContainerEnd < 0) {
      fail("S3 backup verification container is missing or unterminated");
    } else {
      const verificationContainer = backup.slice(verificationContainerStart, verificationContainerEnd);
      if (!/"\$\{LOCAL_IMAGE\}:\$\{SOURCE_SHA\}" \\\n\s+-c '/.test(verificationContainer))
        fail("S3 backup verification container must run the exact source image");
      const shellMarker = "-c '";
      const shellStart = verificationContainer.indexOf(shellMarker);
      const shellEnd = shellStart < 0
        ? -1
        : verificationContainer.indexOf("'", shellStart + shellMarker.length);
      const shell = shellStart < 0 || shellEnd < 0
        ? ""
        : verificationContainer.slice(shellStart + shellMarker.length, shellEnd);
      for (const command of [
        'bun dist/cli/index.js storage backup verify "${BACKUP_ID}"',
        '--payload-version-id "${PAYLOAD_VERSION_ID}"',
        '--manifest-version-id "${MANIFEST_VERSION_ID}"',
        '--json > /backup/s3-verify.json',
      ])
        if (!shell.includes(command))
          fail(`S3 backup verification container shell missing: ${command}`);
    }
  }
  if (backup.includes("dist/cli/index.js export"))
    fail("S3 backup step must push the previously validated archive without re-exporting");
  const ecr = runOf(steps, NAMES.ecr);
  for (const p of [
    "aws ecr describe-repositories",
    "imageTagMutability",
    "IMMUTABLE",
    "scanOnPush",
  ])
    if (!has(ecr, p)) fail(`ECR validation missing: ${p}`);
  const push = runOf(steps, NAMES.push);
  for (const p of [
    "docker push",
    "aws ecr describe-images",
    "digest_image=%s@%s",
  ])
    if (!has(push, p)) fail(`immutable image resolution missing: ${p}`);
  const migrate = runOf(steps, NAMES.migrate);
  for (const p of [
    "aws ecs run-task",
    "aws ecs wait tasks-stopped",
    'if [[ "${exit_code}" != "0" ]]',
  ])
    if (!has(migrate, p)) fail(`migration control missing: ${p}`);
  const rollout = runOf(steps, NAMES.rollout);
  for (const p of [
    '[[ "${live_task_definition}" == "${PREVIOUS_TASK_DEFINITION}" ]]',
    "aws ecs register-task-definition",
    "aws ecs update-service",
    "aws ecs wait services-stable",
    "service_mutated=true",
  ])
    if (!has(rollout, p)) fail(`rollout control missing: ${p}`);
  const verify = runOf(steps, NAMES.verify);
  for (const p of [
    '[[ "${deployed_image}" == "${IMAGE}" ]]',
    "${PUBLIC_BASE_URL}/ready",
    "${PUBLIC_BASE_URL}/version",
    "${PUBLIC_BASE_URL}/v1/configs",
    "anonymous_status",
    "aws secretsmanager get-secret-value",
    'echo "::add-mask::${client_key}"',
    "HASNA_INSTRUCTIONS_API_KEY",
    "dist/cli/index.js export --output /archive/instructions-domain-post.tar.gz",
    "post-domain-manifest.json",
    "validate_domain_archive",
    ".integrity == $pre[0].integrity",
    ".integrity.domain_sha256 == $pre[0].integrity.domain_sha256",
    "domain integrity changed during deployment",
    '--slurpfile pre_manifest "${PRE_DEPLOY_MANIFEST}"',
    '--slurpfile post_manifest "${post_manifest}"',
    "exact_domain_integrity",
    '--arg backup_id "${{ steps.backup.outputs.backup_id }}"',
    '--arg backup_sha256 "${{ steps.backup.outputs.sha256 }}"',
    '--arg backup_size_bytes "${{ steps.backup.outputs.size_bytes }}"',
    '--arg backup_payload_version_id "${{ steps.backup.outputs.payload_version_id }}"',
    '--arg backup_manifest_version_id "${{ steps.backup.outputs.manifest_version_id }}"',
    "hasna.instructions.production_deploy.v1",
  ])
    if (!has(verify, p)) fail(`live verification missing: ${p}`);
  if ((verify.match(/dist\/cli\/index\.js export/g) ?? []).length !== 1)
    fail("post-rollout domain archive must be exported exactly once");
  const validObjectLock = executeObjectLockExpression(workflow, {
    ObjectLockConfiguration: {
      ObjectLockEnabled: "Enabled",
      Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 30 } },
    },
  });
  if (!validObjectLock.ok)
    fail(`Object Lock jq rejected valid default retention: ${validObjectLock.error}`);
  const missingRetention = executeObjectLockExpression(workflow, {
    ObjectLockConfiguration: {
      ObjectLockEnabled: "Enabled",
      Rule: { DefaultRetention: { Mode: "COMPLIANCE" } },
    },
  });
  if (missingRetention.ok)
    fail("Object Lock jq accepted a missing default retention period");
  const governanceRetention = executeObjectLockExpression(workflow, {
    ObjectLockConfiguration: {
      ObjectLockEnabled: "Enabled",
      Rule: { DefaultRetention: { Mode: "GOVERNANCE", Days: 30 } },
    },
  });
  if (governanceRetention.ok)
    fail("Object Lock jq accepted GOVERNANCE default retention");
  const futureWormObject = executeWormObjectHeadExpression(
    workflow,
    {
      VersionId: "version-1",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: "2027-01-15T00:00:00+00:00",
    },
    1_700_000_000,
    1_800_000_000,
  );
  if (!futureWormObject.ok)
    fail(`per-object WORM jq rejected valid COMPLIANCE retention: ${futureWormObject.error}`);
  for (const [label, response, retainUntilEpoch] of [
    ["missing VersionId", { VersionId: null, ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: "2027-01-15T00:00:00+00:00" }, 1_800_000_000],
    ["GOVERNANCE mode", { VersionId: "version-1", ObjectLockMode: "GOVERNANCE", ObjectLockRetainUntilDate: "2027-01-15T00:00:00+00:00" }, 1_800_000_000],
    ["expired retention", { VersionId: "version-1", ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: "2023-01-15T00:00:00+00:00" }, 1_700_000_000],
  ] as const) {
    if (executeWormObjectHeadExpression(workflow, response, 1_700_000_000, retainUntilEpoch).ok)
      fail(`per-object WORM jq accepted ${label}`);
  }
  const archiveIntegrity = {
    algorithm: "sha256",
    canonicalization: "hasna.instructions.logical-json/v1",
    counts: {
      configs: 260,
      config_snapshots: 510,
      profiles: 8,
      profile_config_bindings: 23,
      profile_asset_bindings: 4,
      machines: 3,
    },
    hashes: {
      configs: "a".repeat(64),
      config_snapshots: "b".repeat(64),
      profiles: "c".repeat(64),
      profile_config_bindings: "d".repeat(64),
      profile_asset_bindings: "e".repeat(64),
      machines: "f".repeat(64),
    },
    domain_sha256: "9".repeat(64),
  };
  const validArchiveManifest = {
    schema: "hasna.instructions.domain-archive/v2",
    version: "2.0.0",
    payload: { path: "domain.json", sha256: "1".repeat(64), size_bytes: 4096 },
    integrity: archiveIntegrity,
  };
  const validArchive = executeDomainArchiveValidation(workflow, validArchiveManifest);
  if (!validArchive.ok)
    fail(`pre-migration domain archive shell validator rejected a complete v2 archive: ${validArchive.error}`);
  const validPostArchive = executeDomainArchiveValidation(
    workflow,
    validArchiveManifest,
    [],
    "post",
  );
  if (!validPostArchive.ok)
    fail(`post-rollout domain archive shell validator rejected a complete v2 archive: ${validPostArchive.error}`);
  const incompleteArchive = executeDomainArchiveValidation(workflow, {
    ...validArchiveManifest,
    integrity: {
      ...archiveIntegrity,
      hashes: { ...archiveIntegrity.hashes, machines: "invalid" },
    },
  });
  if (incompleteArchive.ok)
    fail("domain archive shell validator accepted an invalid collection hash");
  const extraMemberArchive = executeDomainArchiveValidation(
    workflow,
    validArchiveManifest,
    ["unexpected.txt"],
  );
  if (extraMemberArchive.ok)
    fail("domain archive shell validator accepted an unexpected archive member");
  const equalIntegrity = executeDomainIntegrityComparison(
    workflow,
    validArchiveManifest,
    validArchiveManifest,
  );
  if (!equalIntegrity.ok)
    fail(`domain integrity comparison rejected equal manifests: ${equalIntegrity.error}`);
  const changedIntegrity = executeDomainIntegrityComparison(
    workflow,
    validArchiveManifest,
    {
      ...validArchiveManifest,
      integrity: { ...archiveIntegrity, domain_sha256: "8".repeat(64) },
    },
  );
  if (changedIntegrity.ok)
    fail("domain integrity comparison accepted changed domain integrity");
  const evidenceExecution = executeDeploymentEvidenceExpression(workflow);
  if (!evidenceExecution.ok)
    fail(`deployment evidence jq is not executable: ${evidenceExecution.error}`);
  const rollback = named(steps, NAMES.rollback);
  if (
    !asText(rollback?.if).includes("failure()") ||
    !asText(rollback?.if).includes("service_mutated == 'true'")
  )
    fail("rollback must be failure-only after service mutation");
  for (const p of [
    "aws ecs update-service",
    "aws ecs wait services-stable",
    '[[ "${live}" == "${PREVIOUS_TASK_DEFINITION}" ]]',
  ])
    if (!has(asText(rollback?.run), p)) fail(`rollback missing: ${p}`);

  const trivyIndex = steps.findIndex((s) => asText(s.name) === NAMES.trivy);
  const oidcIndex = steps.findIndex((s) => asText(s.name) === NAMES.oidc);
  if (trivyIndex < 0 || oidcIndex < 0 || trivyIndex > oidcIndex)
    fail("local vulnerability scan must run before OIDC");
  if (/\bcat\s[^\n]*(?:domain|s3-backup|s3-verify|backup-receipt)/.test(text))
    fail("deployment must not print domain archives or backup receipts");
  if (/echo[^\n]*domain\.json/.test(text))
    fail("deployment must not echo domain content");
  if (text.includes("capture_identity_collection") || text.includes("view=identity"))
    fail("redundant ID-only data capture is forbidden");
  if (text.includes("scripts/seed.ts") || /\bbun run seed\b/.test(text))
    fail("deployment must never seed production data");
  if (
    text.includes("secrets.AWS_ACCESS") ||
    text.includes("aws-access-key-id") ||
    text.includes("aws-secret-access-key") ||
    text.includes(":latest")
  )
    fail("workflow contains a forbidden credential or mutable-image construct");
  if (
    /echo[^\n]*(client_key|SecretString)/.test(
      active(verify).replace('echo "::add-mask::${client_key}"', ""),
    )
  )
    fail("client key may not be echoed");
  for (const job of [gate, deploy])
    for (const step of stepsOf(job)) {
      const uses = asText(step.uses);
      if (uses && !/@[0-9a-f]{40}$/.test(uses))
        fail(`action is not commit-pinned: ${uses}`);
    }
  return errors;
}

function ciName(root: string): string {
  return asText(
    asMap(parseYaml(readFileSync(join(root, CI_WORKFLOW), "utf8"))).name,
  );
}
function bunVersion(root: string): string {
  const p = JSON.parse(readFileSync(join(root, PACKAGE_JSON), "utf8"));
  const m = /^bun@(\d+\.\d+\.\d+)$/.exec(p.packageManager ?? "");
  if (!m) throw new Error("root packageManager must pin bun@x.y.z");
  return m[1];
}

export function selfTestInstructionsDeploy(root = process.cwd()): string[] {
  const real = readFileSync(join(root, WORKFLOW), "utf8");
  const ci = ciName(root);
  const bun = bunVersion(root);
  const failures: string[] = [];
  if (validateInstructionsDeploy(real, ci, bun).length)
    failures.push("positive control rejected the real workflow");
  const mutations: [string, (s: string) => string, string][] = [
    [
      "wrong account",
      (s) =>
        s.replace(
          'AWS_ACCOUNT_ID: "789877399345"',
          'AWS_ACCOUNT_ID: "000000000000"',
        ),
      "env.AWS_ACCOUNT_ID",
    ],
    [
      "scan removed",
      (s) =>
        s.replace(
          "      - name: Generate local vulnerability report",
          "      - name: Removed local vulnerability report",
        ),
      "missing step",
    ],
    [
      "migration removed",
      (s) => s.replaceAll("aws ecs run-task", 'echo "aws ecs run-task"'),
      "migration control",
    ],
    [
      "mutable image",
      (s) => s.replace('"IMMUTABLE"', '"MUTABLE"'),
      "ECR validation",
    ],
    [
      "anonymous check removed",
      (s) => s.replaceAll("anonymous_status", "omitted_status"),
      "anonymous_status",
    ],
    [
      "auth read removed",
      (s) =>
        s.replaceAll(
          "aws secretsmanager get-secret-value",
          "echo secretsmanager get-secret-value",
        ),
      "secretsmanager",
    ],
    [
      "key leaked",
      (s) =>
        s.replaceAll(
          '          echo "::add-mask::${client_key}"',
          '          echo "client_key=${client_key}"',
        ),
      "live verification missing: echo",
    ],
    [
      "pre-deploy backup removed",
      (s) =>
        s.replace(
          "      - name: Create immutable pre-deploy S3 backup",
          "      - name: Removed immutable pre-deploy S3 backup",
        ),
      "missing step",
    ],
    [
      "archive member validation removed",
      (s) =>
        s.replace(
          "Instructions domain archive contains unexpected members",
          "Instructions domain archive accepted every member",
        ),
      "pre-migration archive control missing: archive contains unexpected members",
    ],
    [
      "v2 archive contract weakened",
      (s) =>
        s.replaceAll(
          '.schema == "hasna.instructions.domain-archive/v2"',
          '.schema | type == "string"',
        ),
      'pre-migration archive control missing: schema == "hasna.instructions.domain-archive/v2"',
    ],
    [
      "stable archive retry bound removed",
      (s) => s.replace("max_capture_attempts=5", "capture_attempt_limit=500"),
      "pre-migration archive control missing: max_capture_attempts=5",
    ],
    [
      "consecutive archive integrity weakened",
      (s) => s.replace(
        ".integrity == $previous[0].integrity",
        ".integrity.domain_sha256 | length > 0",
      ),
      "pre-migration archive control missing: .integrity == $previous[0].integrity",
    ],
    [
      "stable archive authority bypassed",
      (s) => s.replace(
        'mv "${candidate_archive}" "${pre_archive}"',
        'cp "${previous_archive}" "${pre_archive}"',
      ),
      "pre-migration archive control missing: mv",
    ],
    [
      "exact archive push replaced",
      (s) =>
        s.replace(
          "storage backup push /backup/instructions-domain-pre.tar.gz",
          "storage backup push /backup/re-exported.tar.gz",
        ),
      "S3 backup control missing: storage backup push /backup/instructions-domain-pre.tar.gz",
    ],
    [
      "backup push container depends on jq",
      (s) =>
        s.replace(
          "> /backup/s3-backup.json'\n          payload_version_id=",
          "> /backup/s3-backup.json\n              jq --version'\n          payload_version_id=",
        ),
      "S3 backup push container must not depend on jq",
    ],
    [
      "backup push and verification share one container",
      (s) => {
        const backupStep = s.indexOf("      - name: Create immutable pre-deploy S3 backup");
        const pushContainer = s.indexOf("docker run --rm", backupStep);
        const verifyContainer = s.indexOf("docker run --rm", pushContainer + 1);
        return verifyContainer < 0
          ? s
          : `${s.slice(0, verifyContainer)}docker run --reuse${s.slice(verifyContainer + "docker run --rm".length)}`;
      },
      "S3 backup must use separate push and version-pinned verification containers",
    ],
    [
      "version-pinned verification moved outside its container shell",
      (s) =>
        s.replace(
          "-c 'set -eu\n              bun dist/cli/index.js storage backup verify",
          "-c 'true'\n          bun dist/cli/index.js storage backup verify",
        ).replace(
          "                --json > /backup/s3-verify.json'\n          archive_sha256=",
          "            --json > /backup/s3-verify.json\n          archive_sha256=",
        ),
      "S3 backup verification container shell missing: bun dist/cli/index.js storage backup verify",
    ],
    [
      "verification container source image replaced",
      (s) => {
        const runnerParse = s.indexOf('payload_version_id="$(jq -er');
        const image = s.indexOf('"${LOCAL_IMAGE}:${SOURCE_SHA}"', runnerParse);
        return image < 0
          ? s
          : `${s.slice(0, image)}"unrelated-image:fixed"${s.slice(image + '"${LOCAL_IMAGE}:${SOURCE_SHA}"'.length)}`;
      },
      "S3 backup verification container must run the exact source image",
    ],
    [
      "exact archive digest binding removed",
      (s) =>
        s.replaceAll(
          ".sha256 == $sha256 and .sizeBytes == $size_bytes",
          "(.sha256 | length) == 64 and .sizeBytes > 0",
        ),
      "S3 backup control missing: .sha256 == $sha256 and .sizeBytes == $size_bytes",
    ],
    [
      "Object Lock check removed",
      (s) =>
        s.replace(
          "get-object-lock-configuration",
          "object-lock-check-removed",
        ),
      "S3 backup control missing: get-object-lock-configuration",
    ],
    [
      "GOVERNANCE default retention accepted",
      (s) =>
        s.replace(
          '$retention.Mode == "COMPLIANCE"',
          '$retention.Mode == "GOVERNANCE"',
        ),
      'S3 backup control missing: $retention.Mode == "COMPLIANCE"',
    ],
    [
      "redacted receipt key authority bypassed",
      (s) =>
        s.replace(
          "payload_key=\"$(jq -er '.payloadKey' \"${backup_receipt}\")\"",
          'payload_key="instructions/backups/${backup_id}/payload"',
        ),
      "S3 backup control missing: payload_key=",
    ],
    [
      "per-object head check removed",
      (s) => s.replace("aws s3api head-object", "aws s3api get-object"),
      "S3 backup control missing: aws s3api head-object",
    ],
    [
      "per-object COMPLIANCE check weakened",
      (s) =>
        s.replace(
          '.ObjectLockMode == "COMPLIANCE"',
          '.ObjectLockMode == "GOVERNANCE"',
        ),
      'S3 backup control missing: .ObjectLockMode == "COMPLIANCE"',
    ],
    [
      "per-object future retention check removed",
      (s) =>
        s.replace(
          "$retain_until_epoch > $now_epoch",
          "$retain_until_epoch >= 0",
        ),
      "S3 backup control missing: $retain_until_epoch > $now_epoch",
    ],
    [
      "payload version authority removed",
      (s) => s.replaceAll("--payload-version-id", "--omitted-payload-version-id"),
      "S3 backup control missing: --payload-version-id",
    ],
    [
      "version-pinned head removed",
      (s) => s.replace('--version-id "${object_version_id}"', '--no-version-authority'),
      "S3 backup control missing: --version-id",
    ],
    [
      "exact retained payload digest removed",
      (s) => s.replace('sha256sum "${versioned_payload}"', 'sha256sum "${PRE_DEPLOY_ARCHIVE}"'),
      "S3 backup control missing: sha256sum",
    ],
    [
      "deployment evidence payload version binding removed",
      (s) => s.replace(
        '--arg backup_payload_version_id "${{ steps.backup.outputs.payload_version_id }}"',
        '--arg omitted_payload_version_id "${{ steps.backup.outputs.payload_version_id }}"',
      ),
      "live verification missing: --arg backup_payload_version_id",
    ],
    [
      "deployment evidence backup binding removed",
      (s) =>
        s.replace(
          '--arg backup_size_bytes "${{ steps.backup.outputs.size_bytes }}"',
          '--arg omitted_backup_size "${{ steps.backup.outputs.size_bytes }}"',
        ),
      "live verification missing: --arg backup_size_bytes",
    ],
    [
      "exact domain integrity comparison removed",
      (s) =>
        s.replace(
          ".integrity == $pre[0].integrity",
          ".integrity.domain_sha256 | length > 0",
        ),
      "live verification missing: .integrity == $pre[0].integrity",
    ],
    [
      "rollback disabled",
      (s) =>
        s.replace(
          "failure() && steps.deploy.outputs.service_mutated == 'true'",
          "always()",
        ),
      "rollback must",
    ],
  ];
  for (const [label, mutate, expected] of mutations) {
    const changed = mutate(real);
    if (changed === real) failures.push(`${label}: mutation did not apply`);
    else if (
      !validateInstructionsDeploy(changed, ci, bun).some((e) =>
        e.includes(expected),
      )
    )
      failures.push(
        `${label}: negative control was not rejected for ${expected}`,
      );
  }
  return failures;
}

if (import.meta.main) {
  const root = process.cwd();
  if (process.argv.includes("--self-test")) {
    const failures = selfTestInstructionsDeploy(root);
    if (failures.length) {
      failures.forEach((f) => console.error(`  ${f}`));
      console.error(`instructions-deploy self-test: FAIL`);
      process.exit(1);
    }
    console.log(
      "instructions-deploy self-test: PASS — positive control accepted and 32 negative controls rejected",
    );
  }
  const errors = validateInstructionsDeploy(
    readFileSync(join(root, WORKFLOW), "utf8"),
    ciName(root),
    bunVersion(root),
  );
  if (errors.length) {
    errors.forEach((e) => console.error(`  ${e}`));
    console.error(`instructions-deploy: FAIL — ${errors.length} violation(s)`);
    process.exit(1);
  }
  console.log(
    "instructions-deploy: PASS — exact-ci, scoped, pre-OIDC scanned, target-pinned, complete-domain S3-backed-up, migrate-first, digest-pinned, rollback-ready, exact-domain-integrity verified",
  );
}
