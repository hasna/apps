// .claude/workflows/deploy-app-hasna-com.js
//
// NAME: basename == meta.name == 'deploy-app-hasna-com' — OWNER-NAMED EXCEPTION to the closed-verb
// taxonomy regex ^(audit|fix|generate|migrate|monitor|research|review|triage|verify)-...$ ('deploy' is
// not in the closed verb set). Kept as the owner named it; a reviewer may rule a rename, and basename
// + meta.name must then change together in one commit.
//
// [FACTS] this file depends on (measured 2026-08-26; documentation only — no value below is used by
// the script logic; every one is passed via args at runtime):
// - AWS org (admin profile 'hasna') has 15 accounts; hasna-products EXISTS (resolved at runtime from the org account list; never hardcoded) and NO
//   dedicated per-app account exists (all 15 names checked). OWNER RULING: no dedicated account ->
//   deploy to hasna-products (id via args.targetAccountId). Org-admin account id = <org-admin account, asserted via sts at runtime>
//   (via args.adminAccountId).
// - Credential route to the target (the only verified one; no station profile resolves it directly):
//   aws --profile <adminProfile> sts assume-role --role-arn arn:aws:iam::<targetId>:role/
//   OrganizationAccountAccessRole --role-session-name apps-deploy -> export creds -> sts
//   get-caller-identity MUST equal <targetId> before ANY resource call.
// - RUNTIME caps (code.claude.com/docs/en/workflows): no import() (fails pre-run); no fs/shell in
//   the script — subagents do all IO; up to 16 concurrent agents; 1000 agents TOTAL per run
//   (anti-runaway); agents inherit the SESSION model unless overridden — THIS FILE DECLARES NO MODEL
//   FIELDS (owner requirement); runs resumable in-session; saved workflows run as /<name>; args is a
//   global (undefined when omitted — checked below).
// - CONTINUITY model (fleet-measured): 'standing' = a BOUNDED pass loop in-script (args.passLimit,
//   default 3 — the 1000-agent cap forbids unbounded loops) + idle INSIDE the verify/census agent
//   (bash sleep min(args.idleMinutes*60,300)s — default 30min -> 300s, ONE re-check) + STANDING
//   continuity from the COORDINATOR re-launching this workflow from the 10-minute health loop.
//   Never a literal while(true) that spawns unbounded agents.
// - SAFETY pattern (fleet-measured): a subagent completing WITHOUT StructuredOutput makes agent()
//   throw; an uncaught throw killed an infinite run once (wf_b4894f28-d61, 37 agents / 2.7h). EVERY
//   agent() goes through safeAgent() (catch -> log -> null + failureFlag -> next pass's first agent
//   sleeps 300). agent() null (stopped / unrecoverable API error) is also a failure.
// - REPO law (hasna/apps): PR-first, worktree-only at $HOME/.hasna/repos/worktrees/apps/<name>;
//   public names only (@hasna/*, four surfaces); no secrets in the tree (staged scan before commits;
//   AWS creds from assume-role env inside agents, never this file); no @hasna-internal/internal strings
//   in published artifacts; commits end 'Agent: <name>'; bun run check before any PR. Tracking: todos
//   project 'hasna-apps', #hasna-apps, #git-deployments.
// - RECORDING V2 (owner requirement, EVERY workflow, EVERY agent prompt): see RECORD below.
// - API shapes used are the fleet-measured ones: agent(prompt, { label, phase, schema }),
//   parallel/pipeline([thunk, ...], opts), log(str). Phases are declared via the `phase` agent option
//   (no standalone phase() helper is measured in any fleet file), and nothing in this file shadows the
//   runtime globals (agent/parallel/pipeline/phase/log/args/meta) — a local `const agent` broke runs once.
// ==============================================================================

export const meta = {
  name: 'deploy-app-hasna-com',
  description: 'Deploy the hasna/apps app at appPath to app.hasna.com (first-ever) into the owner-ruled hasna-products account: read-only check (account resolution + provider-role table + domain state), create only missing roles (S3+CloudFront+ACM or ECS Fargate, smallest), build from main with hostname baked, [DEPLOY INTENT]/[DEPLOY-CONFIRM] on git-deployments, dual live-gate GO before confirm (NO_GO -> DEPLOY UNVERIFIED + bug), rollback + memento + todos (RECORDING V2); owner-authorized standing: bounded passes (passLimit, 1000-agent cap), idle inside the verify agent (sleep min(idleMinutes,300)s + one re-check), coordinator 10-min relaunch — never while(true).',
};

// ------------------- scope from args only; throw on missing required -------------------
if (!args || typeof args !== 'object') {
  throw new Error('no input: pass required args to /deploy-app-hasna-com (appPath, clonePath, agent, adminAccountId, targetAccountId)');
}
const REQUIRED_ARGS = ['appPath', 'clonePath', 'agent', 'adminAccountId', 'targetAccountId'];
const missingArgs = REQUIRED_ARGS.filter((key) => !args[key] || String(args[key]).trim() === '');
if (missingArgs.length > 0) {
  throw new Error('no input: pass ' + missingArgs.join(', ') + ' via args');
}
const app = String(args.app || String(args.appPath).split('/').filter(Boolean).pop()).trim();
const repo = String(args.repo || 'hasna/apps');
const domain = String(args.domain || 'app.hasna.com').replace(/\/+$/, '');
const adminProfile = String(args.adminProfile || 'hasna');
const adminAccountId = String(args.adminAccountId).trim();
const targetAccountId = String(args.targetAccountId).trim();
const agentName = String(args.agent).trim();
const dryRun = args.dryRun === true;
const idleMinutes = Number.isFinite(Number(args.idleMinutes)) && Number(args.idleMinutes) > 0 ? Number(args.idleMinutes) : 30;
const idleSleepSeconds = Math.min(idleMinutes * 60, 300); // fleet caps the in-agent idle wait at 300s
const passLimit = Math.max(1, Math.min(Number.isFinite(Number(args.passLimit)) && Number(args.passLimit) > 0 ? Number(args.passLimit) : 3, 8));
const versionRef = String(args.version || 'main');

// ------------------- RECORDING V2 (owner requirement) — interpolate into EVERY prompt -------------------
const RECORD = [
  'RECORDING V2 — mandatory, do it while you work (owner requirement):',
  '(1) conversations: claim + post to #hasna-apps at start (create first if missing: conversations channel create hasna-apps; "already exists" = proceed); milestone per phase; done at the end. The deploy lane additionally posts [DEPLOY INTENT] <app>@<version> -> <domain> to #git-deployments BEFORE the deploy and [DEPLOY-CONFIRM] IN-THREAD (reply to the intent id) AFTER — only on 2-live-gate GO.',
  '(2) todos: one task per work item (todos add --project hasna-apps "<title>"); comment with exact evidence as you go; start/complete only with proof (merged PR / verified live).',
  '(3) mementos: mementos save key apps-<topic> on every non-obvious root cause or decision.',
  '(4) knowledge: on durable doctrine file "KNOWLEDGE: <item>" follow-up (never a silent add).',
  '(5) skills: on a repeated procedure, file "SKILL: <name>" follow-up.',
  '(6) instructions: only when the workflow itself changes rules — file "INSTRUCTIONS: <config>".',
  'Cloud env (load once, never print values): for f in todos conversations mementos knowledge; do [ -f "$HOME/.hasna/cloud/$f.env" ] && set -a && . "$HOME/.hasna/cloud/$f.env" && set +a; done',
  'NEVER print a credential value.',
].join('\n');
const withRecord = (promptText) => promptText + '\n\n===== ' + RECORD + '\n=====';

// ------------------- safeAgent: EVERY agent() goes through this (fleet safety pattern) -------------------
let failureFlag = false; // a failure makes the NEXT pass's first agent sleep 300 first
async function safeAgent(a) {
  try {
    const r = await agent(a.prompt, { label: a.label, phase: a.phase, schema: a.schema });
    if (r === null) {
      failureFlag = true;
      log('agent null: ' + a.name + ' (stopped or unrecoverable API error)');
      return null;
    }
    return r;
  } catch (err) {
    failureFlag = true;
    log('agent FAIL: ' + a.name + ' -> ' + (err && err.message ? err.message : String(err)));
    return null;
  }
}

// ------------------- schemas (StructuredOutput contract per agent) -------------------
const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    resolution: { type: 'string', enum: ['dedicated', 'org-fallback'] },
    resolvedAccountId: { type: ['string', 'null'] },
    dedicatedMatches: { type: 'array', items: { type: 'string' } },
    adminVerified: { type: 'boolean' },
    targetVerified: { type: 'boolean' },
    accountFacts: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['resolution', 'resolvedAccountId', 'dedicatedMatches', 'adminVerified', 'targetVerified', 'accountFacts', 'evidence'],
};

const ROLES_SCHEMA = {
  type: 'object',
  properties: {
    servingTargetKind: { type: 'string', enum: ['static', 'dynamic'] },
    servingTarget: { type: 'string', enum: ['s3-cloudfront-acm', 'ecs-fargate'] },
    providerRoles: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, provider: { type: 'string' }, state: { type: 'string' } }, required: ['role', 'provider', 'state'] } },
    missingRoles: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, name: { type: 'string' }, plan: { type: 'string' } }, required: ['role', 'name', 'plan'] } },
    evidence: { type: 'string' },
  },
  required: ['servingTargetKind', 'servingTarget', 'providerRoles', 'missingRoles', 'evidence'],
};

const NET_SCHEMA = {
  type: 'object',
  properties: {
    domainState: { type: 'string' },
    records: { type: 'array', items: { type: 'string' } },
    problems: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
  required: ['domainState', 'records', 'problems', 'evidence'],
};

const CREATE_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    created: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, id: { type: 'string' }, evidence: { type: 'string' } }, required: ['role', 'id'] } },
    skipped: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, reason: { type: 'string' } }, required: ['role', 'reason'] } },
    asserts: { type: 'array', items: { type: 'object', properties: { check: { type: 'string' }, pass: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['check', 'pass'] } },
    evidence: { type: 'string' },
  },
  required: ['done', 'created', 'skipped', 'asserts', 'evidence'],
};

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    commitSha: { type: 'string' },
    version: { type: 'string' },
    artifactDir: { type: 'string' },
    gates: { type: 'array', items: { type: 'object', properties: { gate: { type: 'string' }, pass: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['gate', 'pass'] } },
    evidence: { type: 'string' },
  },
  required: ['done', 'commitSha', 'version', 'artifactDir', 'gates', 'evidence'],
};

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    posted: { type: 'boolean' },
    channel: { type: 'string' },
    messageId: { type: 'string' },
    text: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['posted', 'channel', 'messageId', 'text', 'evidence'],
};

const DEPLOY_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    deployedSha: { type: 'string' },
    method: { type: 'string' },
    resources: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, id: { type: 'string' } }, required: ['kind', 'id'] } },
    evidence: { type: 'string' },
  },
  required: ['done', 'deployedSha', 'method', 'resources', 'evidence'],
};

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    ready: { type: 'boolean' },
    https200: { type: 'boolean' },
    markerFound: { type: 'boolean' },
    contentMarker: { type: 'string' },
    nonRegression: { type: 'array', items: { type: 'object', properties: { page: { type: 'string' }, status: { type: 'number' } }, required: ['page', 'status'] } },
    idleWaited: { type: 'boolean' },
    evidence: { type: 'string' },
  },
  required: ['ready', 'https200', 'markerFound', 'contentMarker', 'nonRegression', 'idleWaited', 'evidence'],
};

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GO', 'NO_GO'] },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, claim: { type: 'string' } }, required: ['severity', 'claim'] } },
    evidence: { type: 'string' },
  },
  required: ['verdict', 'findings', 'evidence'],
};

const CONFIRM_SCHEMA = {
  type: 'object',
  properties: {
    posted: { type: 'boolean' },
    confirmMessageId: { type: 'string' },
    text: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['posted', 'confirmMessageId', 'text', 'evidence'],
};

const FAIL_SCHEMA = {
  type: 'object',
  properties: {
    recorded: { type: 'boolean' },
    unverifiedPost: { type: 'string' },
    bugTaskId: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['recorded', 'unverifiedPost', 'bugTaskId', 'evidence'],
};

const RECORD_SCHEMA = {
  type: 'object',
  properties: {
    mementoKey: { type: 'string' },
    milestonePost: { type: 'string' },
    rollbackDoc: { type: 'string' },
    followUps: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
  required: ['mementoKey', 'milestonePost', 'rollbackDoc', 'followUps', 'evidence'],
};

const ACCOUNT_PREAMBLE = [
  'ORG-ADMIN IDENTITY (first step, every AWS session): aws --profile ' + adminProfile + ' sts get-caller-identity --query Account --output text — MUST equal ' + adminAccountId + '. A mismatch = reassigned profile = P0 stop, not a deploy.',
  'TARGET CREDENTIAL ROUTE (the only verified one; no station profile resolves it): aws --profile ' + adminProfile + ' sts assume-role --role-arn arn:aws:iam::' + targetAccountId + ':role/OrganizationAccountAccessRole --role-session-name apps-deploy --query \'Credentials.{AccessKeyId,SecretAccessKey,SessionToken}\' --output json, export those, then ASSERT aws sts get-caller-identity --query Account --output text == ' + targetAccountId + ' before ANY resource call. Never print credential values. Re-assert at every phase boundary.',
].join('\n');

const RECORD_TASK = 'todos add --project hasna-apps';

// ------------------- prompt builders -------------------
function checkAccountPrompt(preSleepSeconds) {
  return withRecord(
    'CHECK PHASE 0a — account resolution (READ-ONLY; no resource creation, no DNS writes, no deploys). Target: first-ever deploy of ' + repo + ' app at ' + args.appPath + ' to ' + domain + '.\n'
    + (preSleepSeconds > 0 ? 'FIRST, before anything else: bash "sleep ' + preSleepSeconds + ' && echo slept-for-' + preSleepSeconds + '" (a previous pass flagged a failure) and log it.\n' : '')
    + '1. Org-admin identity: ' + ACCOUNT_PREAMBLE + '\n'
    + '2. Org account census (read-only): aws organizations list-accounts --profile ' + adminProfile + ' --query \'Accounts[].{Id,Name,Status}\' --output json. List the matching name/id pairs in dedicatedMatches ONLY when a name matches ^hasna-products-' + app + '(-|$) or ^hasna-apps(-|$).\n'
    + '3. Resolution: if exactly one ACTIVE dedicated match exists -> resolution="dedicated", resolvedAccountId=its Id. Otherwise (measured 2026-08-26: none) -> resolution="org-fallback", resolvedAccountId=null — owner-ruled target is the hasna-products org account passed in targetAccountId=' + targetAccountId + ' (verify it shows ACTIVE in the census).\n'
    + '4. Target identity: run the ACCOUNT_PREAMBLE assume-role + get-caller-identity assertion against the resolved/target id (read-only). targetVerified = (it equals the resolved id).\n'
    + '5. accountFacts: one block with the resolution, the target account id, the exact route (role ARN + session name), and the OWNER RULING (no dedicated account exists -> deploy to the hasna-products org account). Paste the raw lines in evidence.\n'
    + 'Return: resolution, resolvedAccountId, dedicatedMatches, adminVerified, targetVerified, accountFacts, evidence.'
  );
}

function rolesPrompt(accountId, checkFacts) {
  return withRecord(
    'CHECK PHASE 0b — provider-role table per the deploy-operator rule (READ-ONLY; identify and classify, create NOTHING). App: ' + repo + ' appPath ' + args.appPath + ', target host ' + domain + ', target account ' + accountId + '.' + (checkFacts ? '\nPhase 0a facts: ' + String(checkFacts).slice(0, 1500) : '') + '\n'
    + 'Run the target identity assertion first (' + ACCOUNT_PREAMBLE + ') before ANY AWS read. Then produce the table as providerRoles[] ({role, provider, state}):\n'
    + '- registrar: whois/dig NS for ' + domain + ' (read-only).\n'
    + '- authoritative DNS: provider holding the zone for ' + domain + ' (expect Cloudflare; verify via published NS records).\n'
    + '- certificate authority + validation-dns layer: for a CloudFront/ALB host the CA is ACM in the target account (us-east-1 for CloudFront); validation records land in the authoritative DNS zone.\n'
    + '- source repo + branch: github.com/' + repo + ' ' + versionRef + ' (read-only; git ls-remote, and the clone at ' + args.clonePath + ').\n'
    + '- serving target: READ the app at ' + args.clonePath + '/' + args.appPath + ' (package.json scripts/build, -serve/MCP/CLI bins — four public surfaces law, static export vs server entry) and classify: "static" -> s3-cloudfront-acm (S3 + CloudFront + ACM DNS-validation); "dynamic" -> ecs-fargate (ECS Fargate + ALB + ACM). Decided from repo evidence, never assumed.\n'
    + '- artifact + rollback: artifact = the build output of ' + args.appPath + ' from ' + versionRef + ' with https://' + domain + ' baked; rollback (first-ever deploy) = revert the Cloudflare records to today\'s state + disable/delete what this run created (recorded in Phase 5).\n'
    + '- existing-state (read-only, target account after identity assertion): aws acm list-certificates --region us-east-1, dig +short ' + domain + ' / dig NS ' + domain + ', S3/CloudFront/ECS candidates per the naming law (<workload>-<env>-<component>; hasna-<workload>-<env>-<purpose>-<accountId> for the S3 bucket). Whatever exists -> providerRoles state=exists, NOT missingRoles.\n'
    + 'missingRoles[] = ONLY roles genuinely missing (each {role, name: the exact resource name per the naming law, plan: one line on how to create it smallest-first}). Evidence = raw lines.'
  );
}

function netPrompt(domainStateHint) {
  return withRecord(
    'CHECK PHASE 0c — registry/network pre-checks (READ-ONLY). ' + (domainStateHint ? 'Phase 0a facts: ' + String(domainStateHint).slice(0, 800) : '') + '\n'
    + '1. Domain state: dig NS ' + domain + ', dig +short ' + domain + ' (and www.' + domain + '), curl -sS -o /dev/null -w \'%{http_code}\' https://' + domain + ' (first-ever deploy: 404/000 now is expected and is not a problem unless something was live before).\n'
    + '2. Registry/connectivity: git ls-remote https://github.com/' + repo + ' refs/heads/' + versionRef + ' (source reachable) and the clone at ' + args.clonePath + ' fetched recently from ' + versionRef + '.\n'
    + '3. PROBLEMS only for genuine conflicts: a live conflicting record/answer for ' + domain + ' (e.g. a record already serving a different site), delegation pointing elsewhere, or an unreachable source. Do NOT flag expected-first-deploy absence as a problem.\n'
    + 'Return: domainState (one paragraph), records[] (raw lines), problems[], evidence.'
  );
}

function createPrompt(accountId, roles, net) {
  return withRecord(
    'CREATE PHASE 1 — create ONLY the missing roles (skip existing; smallest production target; idempotent). App ' + repo + ' ' + args.appPath + ' -> ' + domain + ', target account ' + accountId + '.' + (dryRun ? ' DRY RUN: no mutations — report plan only.' : '') + '\n'
    + (roles ? 'Phase 0b: ' + JSON.stringify(roles).slice(0, 2500) : 'If Phase 0b data is absent, FIRST re-run the read-only checks yourself (identity assertion first — ' + ACCOUNT_PREAMBLE + ') to list missing roles; never create anything you have not just confirmed missing.')
    + (net ? '\nPhase 0c: ' + JSON.stringify(net).slice(0, 1200) : '') + '\n'
    + 'Rules: ' + ACCOUNT_PREAMBLE + '\n'
    + '- Only roles listed in missingRoles get created; everything else skipped={role, reason:"already exists / out of scope"}.\n'
    + '- static (s3-cloudfront-acm): S3 bucket (globally-unique name per the naming law) + OAC + bucket policy, ACM cert us-east-1 (DNS validation), CloudFront (OAC origin, TLS, alias ' + domain + ', root index.html), then DNS via the fleet domains CLI (read its --help first; never raw provider creds or invented vault keys; file a bug if it cannot do the record) — validation CNAMEs + app CNAME.\n'
    + '- dynamic (ecs-fargate): ECS Fargate cluster + one service + task def + ALB + listener + ACM + DNS via the domains CLI.\n'
    + '- ASSERT each create BEFORE and AFTER with a positive control (aws s3api head-bucket / aws cloudfront get-distribution --id / aws acm describe-certificate / dig the DNS record) so a pass is true only on read-backs; asserts[] = {check, pass, evidence}.\n'
    + 'Return: done, created[], skipped[], asserts[], evidence.'
  );
}

function buildPrompt(accountId, buildRole) {
  return withRecord(
    'BUILD PHASE 2 — artifact from the current ' + versionRef + ' with the final hostname https://' + domain + ' baked; run the repo gates. App ' + repo + ' ' + args.appPath + '.' + (dryRun ? ' DRY RUN: plan only (' + buildRole + '), no build executed.' : '') + '\n'
    + '1. Worktree-only (repo law; never mutate the shared clone): git -C ' + args.clonePath + ' fetch origin ' + versionRef + ' && git -C ' + args.clonePath + ' worktree add $HOME/.hasna/repos/worktrees/apps/' + app + '-deploy -b deploy/' + app + ' origin/' + versionRef + ' (reuse if they exist; root $HOME/.hasna/repos/worktrees/apps/<name>).\n'
    + '2. Find the app\'s hostname/public-url config at <worktree>/' + args.appPath + ' and set it to https://' + domain + ' via build args/env. If a tracked edit is required, do it in the worktree with repo gates: staged secrets scan (rc=0) -> commit ending "Agent: ' + agentName + '" (no Co-Authored-By) -> push -> PR referencing the hasna-apps task -> WAIT for merge. Never edit the shared clone; record the path taken.\n'
    + '3. Gates: run the app\'s install/check/build per its package.json (' + (buildRole || '') + ') (bun run check / test where declared), then produce the deployable artifact (static export dir or server bundle). Verify NO @hasna-internal/internal-only strings in it, and no secrets (staged scan before any commit).\n'
    + '4. commitSha = the exact base commit the artifact was built from (git rev-parse origin/' + versionRef + ').\n'
    + 'Return: done, commitSha, version (short sha or app version), artifactDir (the path INSIDE the worktree that the deploy phase uploads), gates[] ({gate, pass, evidence}), evidence.'
  );
}

function intentPrompt(build) {
  return withRecord(
    'DEPLOY PHASE 3a — announce intent BEFORE the deploy (no AWS work). ' + (dryRun ? 'DRY RUN: report the intent text only.' : '') + '\n'
    + '1. Ensure channels exist: conversations channel create git-deployments, conversations channel create hasna-apps ("already exists" = fine).\n'
    + '2. Post via conversations send git-deployments --from ' + agentName + ' the EXACT line: "[DEPLOY INTENT] ' + app + '@' + (build && build.version ? build.version : versionRef) + ' -> ' + domain + ' — first-ever deploy, account ' + targetAccountId + ', hostname baked https://' + domain + '; 2 independent live GO before confirm" and CAPTURE the message id (raw output; confirm with conversations show <id>).\n'
    + '3. [DEPLOY INTENT] must exist BEFORE any upload — an ordering gate.\n'
    + 'Return: posted, channel="git-deployments", messageId, text, evidence.'
  );
}

function deployPrompt(accountId, build, intent, roles) {
  return withRecord(
    'DEPLOY PHASE 3b — upload/publish (AFTER the intent post: ' + (intent && intent.messageId ? 'message ' + intent.messageId : '(missing/unknown — check the git-deployments channel first; DO NOT upload without an intent post from this run or a prior pass)') + '). ' + (dryRun ? 'DRY RUN: no upload; report the plan.' : '') + '\n'
    + 'TARGET: ' + domain + ', account ' + accountId + ', commit ' + (build ? build.commitSha : '(unknown)') + ', artifact ' + (build && build.artifactDir ? build.artifactDir : '(phase-2)') + '.' + (roles ? '\nServing target: ' + String(roles.servingTarget) : '') + '\n'
    + 'Rules: ' + ACCOUNT_PREAMBLE + ' (re-assert at the boundary).\n'
    + '- static: aws s3 sync <artifactDir> s3://<bucket> --delete (bucket from Phase 1), then aws cloudfront create-invalidation --distribution-id <id> --paths \'/*\'; positive-control read-back after each.\n'
    + '- dynamic: build the image, push to the ECR in account ' + accountId + ', update the ECS service with the new task def; positive-control read-back (describe-services shows the new def).\n'
    + 'deployedSha = ' + (build ? build.commitSha : '(from build)') + '; method + resources[] = {kind, id} (bucket, distribution id, cert arn, DNS record names actually created/used).\n'
    + 'Return: done, deployedSha, method, resources[], evidence.'
  );
}

function verifyPrompt(accountId, build) {
  return withRecord(
    'VERIFY PHASE 4a — live + non-regression + census idle wait (READ-ONLY; the one in-agent idle). ' + (dryRun ? 'DRY RUN: report the planned checks, ready=false.' : '') + '\n'
    + '1. curl -sS -o /dev/null -w \'%{http_code}\' https://' + domain + ' -> https200 = 2xx.\n'
    + '2. content marker: pick the marker from the built artifact ' + (build && build.artifactDir ? build.artifactDir : '(the worktree build)') + ' (app\'s own name/site-marker string); grep the served body; markerFound = present; contentMarker = the exact string.\n'
    + '3. non-regression: at least TWO other served routes of ' + domain + ' (index, health/robots/other; www.' + domain + ' keeps 200 or a documented redirect) each return 2xx. nonRegression[] = {page, status}.\n'
    + '4. CENSUS IDLE WAIT: if checks 1-3 are not all OK yet, run bash "sleep ' + idleSleepSeconds + ' && echo idle-waited" (max 300s, agent-side), then re-run checks 1-3 ONCE; idleWaited = true if the sleep ran. No loop beyond one sleep+recheck — the coordinator relaunches; never a while(true).\n'
    + 'ready = https200 && markerFound && all nonRegression 2xx. Evidence = raw lines.'
  );
}

function gatePrompt(gateName, accountId, build, verify) {
  return withRecord(
    'LIVE GATE ' + gateName + ' — INDEPENDENT adversarial live check of the deployed ' + domain + ' (default model). Run YOUR OWN fresh probes; do not trust the verify agent\'s result — you are the second instrument, and a single shared source is exactly the failure this gate exists to prevent.\n'
    + 'Run read-only probes: (1) curl -sS -IL https://' + domain + ' (final 2xx, no redirect loop, no error page); (2) TLS via openssl s_client -connect ' + domain + ':443 -servername ' + domain + ' (cert present, sane chain); (3) body: grep for ' + (verify && verify.contentMarker ? JSON.stringify(verify.contentMarker) : 'the app\'s marker string') + '; (4) one more route of ' + domain + '; (5) sanity: live content must trace to commit ' + (build && build.commitSha ? build.commitSha : '(unknown)') + ' and account ' + accountId + ', not a stale cache or different site.\n'
    + 'Attack the claim: evidence, not vibes. verdict = "GO" only when every probe passes with raw evidence quoted; "NO_GO" only for concrete, currently-reachable P0/P1 defects (blocked endpoint, wrong content, bad TLS, stale/other artifact). P2/P3 non-blocking. Evidence = raw lines.'
  );
}

function confirmPrompt(intent, build, verify, gate1, gate2) {
  return withRecord(
    'DEPLOY PHASE 4c — post [DEPLOY-CONFIRM] IN-THREAD (reply to the intent message ' + (intent && intent.messageId ? intent.messageId : '(missing!)') + ' on #git-deployments) — called ONLY after both independent live gates returned GO (gate evidence: ' + (gate1 && gate1.verdict) + '/' + (gate2 && gate2.verdict) + '). ' + (dryRun ? 'DRY RUN: report the confirm text only.' : '') + '\n'
    + 'Line: "[DEPLOY-CONFIRM] ' + app + '@' + (build && build.version ? build.version : versionRef) + ' -> ' + domain + ' — live gate GO: https 200, marker present, ' + (verify && verify.nonRegression ? verify.nonRegression.length + ' non-regression pages 2xx' : 'non-regression checked') + '; gates deploy-gate-1/2 GO" — in-thread reply (check the conversations CLI help for the reply mechanism), from ' + agentName + '. Capture the reply id.\n'
    + 'Return: posted, confirmMessageId, text, evidence.'
  );
}

function failPrompt(intent, verify, gate1, gate2) {
  return withRecord(
    'FAILURE RECORD — an independent live gate returned NO_GO (or failed to run); this deploy candidate is UNVERIFIED. ' + (dryRun ? 'DRY RUN: report the plan only.' : '') + '\n'
    + 'Evidence: gates ' + (gate1 ? JSON.stringify(gate1).slice(0, 700) : '(none)') + ' / ' + (gate2 ? JSON.stringify(gate2).slice(0, 700) : '(none)') + '; verify ' + (verify ? JSON.stringify(verify).slice(0, 700) : '(none)') + '; intent ' + (intent && intent.messageId ? intent.messageId : '(none)') + '.\n'
    + '1. Post IN-THREAD (reply to the intent id if present, else #git-deployments) from ' + agentName + ': "[DEPLOY UNVERIFIED] ' + app + '@' + versionRef + ' -> ' + domain + ' — live-gate FAIL: <concise facts + pointers>"; unverifiedPost = the message id.\n'
    + '2. File the bug task: ' + RECORD_TASK + ' "BUG: ' + app + ' deploy to ' + domain + ' gate NO_GO — <claim + evidence pointer>" and capture its id.\n'
    + '3. Post a milestone to #hasna-apps. Never claim the deploy verified. Return: recorded, unverifiedPost, bugTaskId, evidence.'
  );
}

function recordPrompt(terminal, accountId, build, verify, create) {
  return withRecord(
    'RECORD PHASE 5 — close the run + rollback documentation for ' + app + ' -> ' + domain + ' (terminal: ' + terminal + '). ' + (dryRun ? 'DRY RUN: record the plan only.' : '') + '\n'
    + '1. ROLLBACK DOC (mandatory; first-ever deploy has no prior state, so rollback = the documented teardown): rollbackDoc = one block naming the created resources (from Phase 1/3: ' + JSON.stringify({ create: create || null }).slice(0, 900) + ') with (a) revert sequence — Cloudflare records back to the pre-deploy state (record them), CloudFront disable then delete, S3 bucket delete, ACM cert delete, ECS stop-if-dynamic, (b) exact revert commands, (c) what "confirmed live again" means. Attach it to the hasna-apps todos task evidence.\n'
    + '2. mementos save key apps-deploy-' + app + ' "<one paragraph: account route (role ARN pattern, session apps-deploy), resolution rules (dedicated wins; owner-ruled fallback), serving target, dual-gate GO, bounded-pass + 300s idle + coordinator-relaunch model>" --tags ' + app + ',deploy,aws.\n'
    + '3. followUps per RECORDING V2: repeated procedure -> "' + RECORD_TASK + ' SKILL: deploy-' + app + '"; durable doctrine (account route, resolution, owner ruling) -> "' + RECORD_TASK + ' KNOWLEDGE: hasna-apps-first-deploy-facts"; rules changed by this workflow -> "' + RECORD_TASK + ' INSTRUCTIONS: <config>" (only if it changed rules, else skip with reason).\n'
    + '4. done post to #hasna-apps with the terminal outcome + pointer to the intent/confirm thread.\n'
    + 'Return: mementoKey, milestonePost, rollbackDoc, followUps[], evidence.'
  );
}

// ------------------- one bounded pass -------------------
async function runPass(pass) {
  log('pass ' + pass + '/' + passLimit + ' begin (failureFlag=' + failureFlag + ')');
  const preSleep = failureFlag ? 300 : 0;

  // PHASE 0a — account resolution (read-only)
  const check = await safeAgent({
    name: 'check-account',
    label: 'check-account:p' + pass,
    phase: '0a-account',
    prompt: checkAccountPrompt(preSleep),
    schema: CHECK_SCHEMA,
  });
  const accountId = check && check.resolution === 'dedicated' && check.resolvedAccountId ? String(check.resolvedAccountId) : targetAccountId;
  log('pass ' + pass + ': account=' + accountId + ' resolution=' + (check ? check.resolution : 'unknown'));

  // PHASE 0b + 0c — provider-role table + registry/network pre-checks (read-only, parallel)
  const pre = await parallel(
    [
      () => safeAgent({ name: 'check-roles', label: 'check-roles:p' + pass, phase: '0b-roles', prompt: rolesPrompt(accountId, check ? check.accountFacts : null), schema: ROLES_SCHEMA }),
      () => safeAgent({ name: 'check-network', label: 'check-network:p' + pass, phase: '0c-network', prompt: netPrompt(check ? check.accountFacts : null), schema: NET_SCHEMA }),
    ],
    { maxConcurrency: 2 }
  );
  const roles = pre[0];
  const net = pre[1];
  log('pass ' + pass + ': roles=' + (roles ? roles.servingTarget : 'FAIL') + ' net=' + (net ? net.problems.length + ' problems' : 'FAIL'));

  if (dryRun) {
    return { pass, check, accountId, roles, net, create: null, build: null, intent: null, deploy: null, verify: null, gate1: null, gate2: null, confirm: null, failrec: null, record: null, outcome: 'dry-run' };
  }

  // PHASE 1 — create ONLY missing roles (idempotent; smallest production target)
  const create = await safeAgent({
    name: 'create-roles',
    label: 'create-roles:p' + pass,
    phase: '1-create',
    prompt: createPrompt(accountId, roles, net),
    schema: CREATE_SCHEMA,
  });
  log('pass ' + pass + ': create=' + (create ? create.created.length + ' created / ' + create.skipped.length + ' skipped' : 'FAIL'));

  // PHASE 2 — build from current main with the hostname baked
  const build = await safeAgent({
    name: 'build-artifact',
    label: 'build-artifact:p' + pass,
    phase: '2-build',
    prompt: buildPrompt(accountId, roles ? roles.servingTarget : null),
    schema: BUILD_SCHEMA,
  });
  log('pass ' + pass + ': build=' + (build ? build.done + ' sha=' + String(build.commitSha).slice(0, 7) : 'FAIL'));

  // PHASE 3a — [DEPLOY INTENT] before any upload (ordering gate)
  const intent = await safeAgent({
    name: 'deploy-intent',
    label: 'deploy-intent:p' + pass,
    phase: '3a-intent',
    prompt: intentPrompt(build),
    schema: INTENT_SCHEMA,
  });
  log('pass ' + pass + ': intent=' + (intent && intent.posted ? intent.messageId : 'FAIL'));

  // PHASE 3b — upload/publish
  const deploy = await safeAgent({
    name: 'deploy-upload',
    label: 'deploy-upload:p' + pass,
    phase: '3b-deploy',
    prompt: deployPrompt(accountId, build, intent, roles),
    schema: DEPLOY_SCHEMA,
  });
  log('pass ' + pass + ': deploy=' + (deploy && deploy.done ? deploy.deployedSha : 'FAIL'));

  // PHASE 4a — live + non-regression + census idle wait
  const verify = await safeAgent({
    name: 'verify-live',
    label: 'verify-live:p' + pass,
    phase: '4a-verify',
    prompt: verifyPrompt(accountId, build),
    schema: VERIFY_SCHEMA,
  });
  log('pass ' + pass + ': verify=' + (verify ? (verify.ready ? 'READY' : 'not-ready') : 'FAIL') + ' idle=' + (verify ? verify.idleWaited : '-'));

  // PHASE 4b — two independent live gates (pipeline over the two gate names)
  let gate1 = null;
  let gate2 = null;
  if (verify && verify.ready) {
    const gates = await pipeline([
      () => safeAgent({ name: 'deploy-gate-1', label: 'deploy-gate-1:p' + pass, phase: '4b-gate', prompt: gatePrompt('deploy-gate-1', accountId, build, verify), schema: GATE_SCHEMA }),
      () => safeAgent({ name: 'deploy-gate-2', label: 'deploy-gate-2:p' + pass, phase: '4b-gate', prompt: gatePrompt('deploy-gate-2', accountId, build, verify), schema: GATE_SCHEMA }),
    ]);
    gate1 = gates[0];
    gate2 = gates[1];
    log('pass ' + pass + ': gates=' + (gate1 ? gate1.verdict : '-') + '/' + (gate2 ? gate2.verdict : '-'));
  }

  // PHASE 4c — confirm in-thread ONLY on both GO; otherwise record UNVERIFIED + bug
  let confirm = null;
  let failrec = null;
  let outcome = null;
  if (verify && verify.ready && gate1 && gate2 && gate1.verdict === 'GO' && gate2.verdict === 'GO') {
    confirm = await safeAgent({
      name: 'deploy-confirm',
      label: 'deploy-confirm:p' + pass,
      phase: '4c-confirm',
      prompt: confirmPrompt(intent, build, verify, gate1, gate2),
      schema: CONFIRM_SCHEMA,
    });
    outcome = confirm && confirm.posted ? 'confirmed' : 'blocked';
    log('pass ' + pass + ': confirm=' + (confirm && confirm.posted ? confirm.confirmMessageId : 'FAIL'));
  } else if (verify && verify.ready) {
    // gates ran (or failed to run) and at least one is not GO — terminal per requirement
    failrec = await safeAgent({
      name: 'deploy-fail',
      label: 'deploy-fail:p' + pass,
      phase: '4c-fail',
      prompt: failPrompt(intent, verify, gate1, gate2),
      schema: FAIL_SCHEMA,
    });
    outcome = failrec && failrec.recorded ? 'unverified' : 'blocked';
    log('pass ' + pass + ': fail-rec recorded=' + (failrec && failrec.recorded));
  }

  return { pass, check, accountId, roles, net, create, build, intent, deploy, verify, gate1, gate2, confirm, failrec, record: null, outcome };
}

// ------------------- bounded pass loop (standing model: coordinator relaunches after the run) -------------------
const passResults = [];
let lastPass = null;
for (let pass = 1; pass <= passLimit; pass += 1) {
  lastPass = await runPass(pass);
  passResults.push(lastPass);
  if (lastPass.outcome === 'confirmed' || lastPass.outcome === 'unverified' || lastPass.outcome === 'dry-run' || lastPass.outcome === 'blocked') {
    break;
  }
  // No terminal outcome and this was the final bounded pass: the deploy DID run (or was attempted),
  // so the honest terminal is an UNVERIFIED record + bug when a live state exists, else BLOCKED.
  if (pass >= passLimit) {
    if (lastPass.deploy && lastPass.deploy.done) {
      const failrec = await safeAgent({
        name: 'deploy-fail',
        label: 'deploy-fail:final',
        phase: '4c-fail',
        prompt: failPrompt(lastPass.intent, lastPass.verify, lastPass.gate1, lastPass.gate2),
        schema: FAIL_SCHEMA,
      });
      lastPass.failrec = failrec;
      lastPass.outcome = failrec && failrec.recorded ? 'unverified' : 'blocked';
    } else {
      lastPass.outcome = 'blocked';
    }
    log('pass ' + pass + ' final: outcome=' + lastPass.outcome);
  }
}

// PHASE 5 — record + rollback documentation (always, after a terminal outcome)
const recordAgentResult = await safeAgent({
  name: 'record-close',
  label: 'record-close',
  phase: '5-record',
  prompt: recordPrompt(lastPass.outcome, lastPass.accountId, lastPass.build, lastPass.verify, lastPass.create),
  schema: RECORD_SCHEMA,
});
lastPass.record = recordAgentResult;

const summary = {
  app, repo, domain,
  accountId: lastPass.accountId,
  outcome: lastPass.outcome,
  passes: passResults.length,
  failureFlag,
  evidence: {
    account: lastPass.check && lastPass.check.evidence,
    roles: lastPass.roles && lastPass.roles.evidence,
    createDone: lastPass.create && lastPass.create.done,
    buildSha: lastPass.build && lastPass.build.commitSha,
    intent: lastPass.intent && lastPass.intent.messageId,
    deployDone: lastPass.deploy && lastPass.deploy.done,
    verifyReady: lastPass.verify && lastPass.verify.ready,
    gate1: lastPass.gate1 && lastPass.gate1.verdict,
    gate2: lastPass.gate2 && lastPass.gate2.verdict,
    confirmPosted: lastPass.confirm && lastPass.confirm.posted,
    unverifiedRecorded: !!(lastPass.failrec && lastPass.failrec.recorded),
    recordMemento: recordAgentResult && recordAgentResult.mementoKey,
  },
};
log('deploy-app-hasna-com complete: outcome=' + lastPass.outcome + ' passes=' + passResults.length + ' account=' + lastPass.accountId + ' gates=' + (lastPass.gate1 ? lastPass.gate1.verdict : '-') + '/' + (lastPass.gate2 ? lastPass.gate2.verdict : '-') + ' record=' + (recordAgentResult ? recordAgentResult.mementoKey : 'FAIL'));
return summary;
