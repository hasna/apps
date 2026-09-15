/** Static, two-sided policy gate for the protected Instructions production lane. */
import { readFileSync } from "node:fs";
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
  const backup = runOf(steps, NAMES.backup);
  for (const p of [
    "aws s3api head-bucket",
    "get-bucket-versioning",
    "get-public-access-block",
    "get-bucket-encryption",
    "dist/cli/index.js export",
    "storage backup push",
    "storage backup verify",
    "pre-deploy-${SOURCE_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}",
  ])
    if (!has(backup, p)) fail(`S3 backup control missing: ${p}`);
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
    '--header "x-api-key: ${client_key}"',
    ".count | numbers | select(. >= 1",
    "hasna.instructions.production_deploy.v1",
  ])
    if (!has(verify, p)) fail(`live verification missing: ${p}`);
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
      "instructions-deploy self-test: PASS — positive control accepted and 9 negative controls rejected",
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
    "instructions-deploy: PASS — exact-ci, scoped, pre-OIDC scanned, target-pinned, S3-backed-up, migrate-first, digest-pinned, rollback-ready, authenticated-data verified",
  );
}
