#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const expectedRepository = "hasna/uptime";
const expectedRepositoryUrl = "git+https://github.com/hasna/uptime.git";
const requiredLegalFiles = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"];
const releaseWorkflowPath = ".github/workflows/release.yml";

// The approved release candidate is recorded inside the tree it approves, so
// HEAD is always at least one commit ahead of it: writing the commit changes the
// file, which changes HEAD. The gate therefore requires the recorded commit to
// be HEAD or an ancestor of HEAD whose only later changes are the decision
// record itself. Anything else means unapproved code is being published.
const releaseDecisionPaths = ["docs/oss-release-decision.json", "docs/oss-release-readiness.md"];

const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{80,}-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ["Stripe live key", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function command(commandName, args, cwd = root) {
  return execFileSync(commandName, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function check(condition, message, errors) {
  if (!condition) errors.push(message);
}

function parseBunLock(repositoryRoot = root) {
  const source = readFileSync(join(repositoryRoot, "bun.lock"), "utf8");
  return JSON.parse(source.replace(/,\s*([}\]])/g, "$1"));
}

function packageNameAndVersion(specifier) {
  const index = specifier.lastIndexOf("@");
  return { name: specifier.slice(0, index), version: specifier.slice(index + 1) };
}

export function runtimeDependencyClosure(lock) {
  const packages = lock.packages ?? {};
  const roots = Object.keys(lock.workspaces?.[""]?.dependencies ?? {});
  const pending = roots.map((name) => ({ key: name, name }));
  const visitedKeys = new Set();
  const result = new Set();

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visitedKeys.has(current.key)) continue;
    const entry = packages[current.key];
    if (!entry) throw new Error(`bun.lock has no runtime resolution for ${current.key}`);
    visitedKeys.add(current.key);
    const resolved = packageNameAndVersion(entry[0]);
    result.add(`${resolved.name}@${resolved.version}`);
    const dependencyGroups = [entry[2]?.dependencies, entry[2]?.optionalDependencies];
    for (const dependencies of dependencyGroups) {
      for (const dependencyName of Object.keys(dependencies ?? {})) {
        const nestedKey = `${current.key}/${dependencyName}`;
        const key = packages[nestedKey] ? nestedKey : dependencyName;
        pending.push({ key, name: dependencyName });
      }
    }
  }

  return [...result].sort();
}

export function thirdPartyNoticePackages(source) {
  return thirdPartyNoticeRows(source).map((row) => `${row.name}@${row.version}`).sort();
}

function thirdPartyNoticeRows(source) {
  const result = [];
  for (const line of source.split("\n")) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!match || match[1] === "Package" || match[1] === "---") continue;
    result.push({ name: match[1], version: match[2], license: match[3] });
  }
  return result;
}

function installedPackageLicenses(repositoryRoot) {
  const licenses = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      const manifestPath = join(path, "package.json");
      if (existsSync(manifestPath)) {
        const manifest = readJson(manifestPath);
        if (manifest.name && manifest.version) licenses.set(`${manifest.name}@${manifest.version}`, normalizeLicense(manifest.license ?? manifest.licenses));
      }
      visit(path);
    }
  };
  visit(join(repositoryRoot, "node_modules"));
  return licenses;
}

function normalizeLicense(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((license) => license?.type).filter(Boolean).join(" OR ");
  return "";
}

export function auditStaticRepository(repositoryRoot = root) {
  const errors = [];
  const pkg = readJson(join(repositoryRoot, "package.json"));
  const decision = readJson(join(repositoryRoot, "docs/oss-release-decision.json"));
  const packageFiles = pkg.files ?? [];

  check(pkg.name === "@hasna/uptime", "package name must be @hasna/uptime", errors);
  check(pkg.license === "Apache-2.0", "package license must be Apache-2.0", errors);
  check(pkg.repository?.url === expectedRepositoryUrl, "package repository URL is not the expected GitHub repository", errors);
  check(pkg.homepage === "https://github.com/hasna/uptime#readme", "package homepage is not the expected GitHub README", errors);
  check(pkg.bugs?.url === "https://github.com/hasna/uptime/issues", "package bugs URL is not the expected GitHub issue tracker", errors);
  check(pkg.publishConfig?.access === "public", "publishConfig.access must explicitly be public", errors);
  check(pkg.publishConfig?.provenance === undefined, "publishConfig.provenance must not be set, because npm refuses to publish outside a supported CI provider when it is", errors);
  check(pkg.scripts?.prepublishOnly?.startsWith("node scripts/oss-release-gate.mjs &&"), "prepublishOnly must run the OSS release gate first", errors);

  const provenancePublishing = auditProvenancePublishing(repositoryRoot);
  errors.push(...provenancePublishing.errors);

  for (const file of requiredLegalFiles) {
    check(existsSync(join(repositoryRoot, file)), `${file} is missing`, errors);
    check(packageFiles.includes(file), `${file} is not included in the published package`, errors);
  }

  const license = readFileSync(join(repositoryRoot, "LICENSE"), "utf8");
  const notice = readFileSync(join(repositoryRoot, "NOTICE"), "utf8");
  const thirdPartyNotices = readFileSync(join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
  check(license.includes("Apache License\n                           Version 2.0, January 2004"), "LICENSE is not the Apache License 2.0 text", errors);
  check(license.includes("END OF TERMS AND CONDITIONS"), "LICENSE is incomplete", errors);
  check(notice.includes("Copyright 2026 Hasna, Inc."), "NOTICE is missing the project copyright", errors);
  check(notice.includes("THIRD_PARTY_NOTICES.md"), "NOTICE does not reference third-party notices", errors);

  try {
    const lock = parseBunLock(repositoryRoot);
    const runtime = runtimeDependencyClosure(lock);
    const noticed = thirdPartyNoticePackages(thirdPartyNotices);
    check(JSON.stringify(noticed) === JSON.stringify(runtime), "THIRD_PARTY_NOTICES.md does not match the bun.lock runtime dependency closure", errors);

    const nodeModules = join(repositoryRoot, "node_modules");
    check(existsSync(nodeModules), "node_modules is required to verify installed runtime dependency licenses", errors);
    if (existsSync(nodeModules)) {
      const installedLicenses = installedPackageLicenses(repositoryRoot);
      for (const row of thirdPartyNoticeRows(thirdPartyNotices)) {
        const installedLicense = installedLicenses.get(`${row.name}@${row.version}`);
        check(Boolean(installedLicense), `${row.name}@${row.version} is not installed for license verification`, errors);
        check(installedLicense === row.license, `${row.name}@${row.version} license does not match THIRD_PARTY_NOTICES.md`, errors);
      }
    }
  } catch (error) {
    errors.push(`could not verify runtime dependency notices: ${error.message}`);
  }

  const workflowAuthentication = auditReleaseWorkflowAuthentication(repositoryRoot);
  errors.push(...workflowAuthentication.errors);

  check(decision.schemaVersion === 1, "release decision schemaVersion must be 1", errors);
  check(decision.repository === expectedRepository, "release decision names the wrong repository", errors);
  check(decision.package === pkg.name, "release decision names the wrong package", errors);
  check(decision.releaseVersion === pkg.version, "release decision version does not match package.json", errors);
  check(["GO", "HOLD"].includes(decision.decision), "release decision must be GO or HOLD", errors);
  check(decision.observed?.npmPackagePublic === true, "release decision must record that the npm package is public", errors);
  check(decision.legal?.status === "PASS", "legal review is not recorded as PASS", errors);
  check(decision.secretScan?.status === "PASS", "secret scan is not recorded as PASS", errors);

  // Registry evidence is retrospective: it describes a release npm already
  // serves. The version being released is not on npm yet, so it can never be
  // the subject of that evidence.
  const registryVersion = decision.provenance?.registryVersion;
  check(
    registryVersion === null || typeof registryVersion === "string",
    "release decision must record provenance.registryVersion — the published version its registry evidence describes, or null before the first publication",
    errors,
  );

  return { decision, errors, package: pkg, provenancePublishing: provenancePublishing.configured };
}

// npm only generates a provenance attestation from a supported CI provider, so
// the request for one belongs on the workflow's publish command, not in
// publishConfig, where it makes every other publish path fail before it starts.
export function auditProvenancePublishing(repositoryRoot = root) {
  const workflowPath = join(repositoryRoot, releaseWorkflowPath);
  if (!existsSync(workflowPath)) {
    return { configured: false, errors: [`${releaseWorkflowPath} is missing, so no trusted-publishing workflow can generate npm provenance`] };
  }

  const errors = [];
  const workflow = readFileSync(workflowPath, "utf8");
  check(/^\s*id-token:\s*write\s*$/m.test(workflow), `${releaseWorkflowPath} does not request the id-token: write permission npm provenance requires`, errors);
  check(/npm publish[^\n]*--provenance/.test(workflow), `${releaseWorkflowPath} does not publish with --provenance`, errors);
  return { configured: errors.length === 0, errors };
}

// The gate shells out to `gh`, which refuses to run on a GitHub-hosted runner
// without GH_TOKEN in the environment. A release workflow that runs the gate
// without one fails on every tag push, so the gate refuses to certify it.
export function auditReleaseWorkflowAuthentication(repositoryRoot = root) {
  const workflowPath = join(repositoryRoot, releaseWorkflowPath);
  if (!existsSync(workflowPath)) {
    return { authenticated: false, errors: [`${releaseWorkflowPath} is missing, so no release workflow can run the gate`] };
  }

  const errors = [];
  const steps = releaseWorkflowGateSteps(readFileSync(workflowPath, "utf8"));
  check(steps.length > 0, `${releaseWorkflowPath} never runs the OSS release gate`, errors);
  for (const step of steps) {
    check(
      step.githubToken,
      `${releaseWorkflowPath} step "${step.name}" runs the OSS release gate without GH_TOKEN, so its \`gh\` calls cannot authenticate`,
      errors,
    );
  }
  return { authenticated: errors.length === 0, errors };
}

// A line-oriented reader rather than a YAML parser: the gate runs under plain
// Node, which has none, and adding a parser to publish a release is not worth
// the dependency. Any GH_TOKEN binding declared before the first step applies
// workflow- or job-wide, so it covers every step below it.
function releaseWorkflowGateSteps(workflow) {
  const stepMarker = /^(\s*)- (?:name|uses|run):/;
  const gateInvocation = /release:oss:|scripts\/oss-release-gate\.mjs|npm publish/;
  const githubTokenBinding = /^\s*(?:GH_TOKEN|GITHUB_TOKEN):\s*\S/;
  const lines = workflow.split("\n").filter((line) => !/^\s*#/.test(line));
  const stepIndent = lines.map((line) => line.match(stepMarker)?.[1].length).find((indent) => indent !== undefined);

  const steps = [];
  let current = null;
  let sharedToken = false;
  for (const line of lines) {
    if (line.match(stepMarker)?.[1].length === stepIndent) {
      current = { name: null, lines: [] };
      steps.push(current);
    }
    if (!current) {
      if (githubTokenBinding.test(line)) sharedToken = true;
      continue;
    }
    current.lines.push(line);
    const name = line.match(/^\s*(?:- )?name:\s*(.+)$/);
    if (name && current.name === null) current.name = name[1].trim();
  }

  return steps
    .filter((step) => step.lines.some((line) => gateInvocation.test(line)))
    .map((step) => ({
      name: step.name ?? "(unnamed)",
      githubToken: sharedToken || step.lines.some((line) => githubTokenBinding.test(line)),
    }));
}

function scanText(text, scope) {
  const findings = [];
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(`${label} pattern found in ${scope}`);
  }
  return findings;
}

function scanTrackedWorktree() {
  const findings = [];
  const files = command("git", ["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const file of files) {
    const content = readFileSync(join(root, file));
    if (content.includes(0)) continue;
    findings.push(...scanText(content.toString("utf8"), file));
  }
  return findings;
}

function scanGitHistory() {
  const history = command("git", ["log", "--all", "-p", "--full-history", "--no-ext-diff", "--no-textconv"]);
  return scanText(history, "Git history");
}

function runGitleaks() {
  command("gitleaks", ["git", "--redact", "--no-banner", "."]);
  command("gitleaks", ["dir", "--redact", "--no-banner", "."]);
}

export function inspectReleaseCandidate(recordedCommit, repositoryRoot = root) {
  const missing = { resolved: null, containedInHead: false, changedPaths: [] };
  if (!recordedCommit) return missing;

  let resolved;
  try {
    resolved = command("git", ["rev-parse", "--verify", "--quiet", `${recordedCommit}^{commit}`], repositoryRoot);
  } catch {
    return missing;
  }

  const head = command("git", ["rev-parse", "HEAD"], repositoryRoot);
  let containedInHead = resolved === head;
  if (!containedInHead) {
    try {
      command("git", ["merge-base", "--is-ancestor", resolved, head], repositoryRoot);
      containedInHead = true;
    } catch {
      containedInHead = false;
    }
  }

  const changedPaths = containedInHead
    ? command("git", ["diff", "--name-only", resolved, head], repositoryRoot).split("\n").filter(Boolean)
    : [];
  return { resolved, containedInHead, changedPaths };
}

// `npm view <name>@<version>` exits non-zero with E404 when the version is not
// published. For the version this gate is about to release that is the expected
// state, not a failure to reach the registry, so it must not become an audit
// error — treating it as one closes the gate against every new version.
function npmView(specifier) {
  let output;
  try {
    output = command("npm", ["view", specifier, "--json"]);
  } catch (error) {
    if (!isRegistryNotFound(error)) throw error;
    return { published: false, view: null };
  }
  if (output === "") return { published: false, view: null };
  const view = JSON.parse(output);
  if (view?.error) {
    if (view.error.code === "E404") return { published: false, view: null };
    throw new Error(`npm view ${specifier} failed: ${view.error.summary ?? view.error.code}`);
  }
  return { published: true, view };
}

function isRegistryNotFound(error) {
  return /\bE404\b/.test(`${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`);
}

function inspectOnlineState(pkg, decision) {
  const github = JSON.parse(command("gh", ["repo", "view", expectedRepository, "--json", "visibility,isPrivate"]));
  const registryVersion = decision.provenance?.registryVersion ?? null;
  const baseline = registryVersion ? npmView(`${pkg.name}@${registryVersion}`) : { published: false, view: null };
  if (registryVersion && !baseline.published) {
    throw new Error(`npm does not publish ${pkg.name}@${registryVersion}, so the recorded registry evidence cannot be verified`);
  }
  return {
    githubVisibility: github.visibility,
    githubPrivate: github.isPrivate,
    registry: baseline.view,
    releaseVersionPublished: npmView(`${pkg.name}@${decision.releaseVersion}`).published,
  };
}

// `candidate` is the Git view of the recorded release candidate, produced by
// inspectReleaseCandidate: { resolved, containedInHead, changedPaths }.
export function releaseCandidateBlockers(recordedCommit, candidate) {
  if (!recordedCommit) return ["release candidate commit is not recorded"];
  if (!/^[0-9a-f]{40}$/.test(recordedCommit)) return ["recorded release candidate commit is not a full 40-character commit SHA"];
  if (candidate?.resolved !== recordedCommit) return ["recorded release candidate commit does not exist in this repository"];
  if (!candidate.containedInHead) return ["recorded release candidate commit is neither HEAD nor an ancestor of HEAD"];

  const unapproved = (candidate.changedPaths ?? []).filter((path) => !releaseDecisionPaths.includes(path));
  if (unapproved.length > 0) {
    return [`HEAD changes ${unapproved.join(", ")} since the recorded release candidate commit, so the published tree is not the approved one`];
  }
  return [];
}

export function evaluateReleaseDecision({ decision, staticErrors = [], online, candidate, clean, provenancePublishing = false, secretFindings = [] }) {
  const auditErrors = [...staticErrors, ...secretFindings];
  const blockers = [];
  // `online.registry` is the npm record of the release npm already serves —
  // `provenance.registryVersion` — never the version being released, which does
  // not exist on the registry until this release publishes it.
  const registry = online.registry ?? null;
  const registryDist = registry?.dist ?? {};
  const registryRepositoryUrl = typeof registry?.repository === "string" ? registry.repository : registry?.repository?.url;
  const registryAttestations = Boolean(
    registryDist.attestations?.url
      && registryDist.attestations?.provenance?.predicateType === "https://slsa.dev/provenance/v1",
  );
  const registryGitHead = registry?.gitHead ?? null;
  const registrySignature = Array.isArray(registryDist.signatures) && registryDist.signatures.length > 0;

  check(online.githubVisibility === decision.observed.githubVisibility, "recorded GitHub visibility does not match GitHub", auditErrors);
  check(online.githubPrivate === (decision.observed.githubVisibility === "PRIVATE"), "recorded GitHub private state is inconsistent", auditErrors);

  if (registry) {
    check(registry.version === decision.provenance.registryVersion, "recorded npm registry version does not match the registry", auditErrors);
    check(registryRepositoryUrl === decision.observed.npmRepositoryUrl, "recorded npm repository URL does not match the registry", auditErrors);
    check(registryDist.integrity === decision.provenance.registryIntegrity, "recorded npm integrity does not match the registry", auditErrors);
    check(registrySignature === decision.provenance.registrySignature, "recorded npm registry-signature state does not match the registry", auditErrors);
    check(registryAttestations === decision.provenance.npmAttestations, "recorded npm attestation state does not match the registry", auditErrors);
    check(registryGitHead === decision.provenance.npmGitHead, "recorded npm gitHead does not match the registry", auditErrors);
  } else {
    // Nothing is published yet, so there is no registry evidence to record.
    check(decision.provenance.registryVersion === null, "release decision records npm registry evidence for a version npm does not publish", auditErrors);
    check(decision.provenance.registryIntegrity === null, "release decision records npm integrity with no published version to verify it against", auditErrors);
    check(decision.provenance.npmAttestations === false, "release decision records npm attestations with no published version to verify them against", auditErrors);
  }

  if (decision.decision !== "GO") blockers.push("recorded public-release decision is HOLD");
  if (decision.explicitPublicApproval !== true) blockers.push("explicit repository-public approval is absent");
  if (online.githubVisibility !== "PUBLIC") blockers.push("GitHub repository is not public, so public package metadata is unresolved");
  if (online.releaseVersionPublished === true) blockers.push("the release version is already published to npm");
  if (!clean) blockers.push("release candidate worktree is not clean");
  blockers.push(...releaseCandidateBlockers(decision.releaseCandidateCommit, candidate));

  const alternate = decision.provenance.alternateEvidence;
  const alternateValid = Boolean(
    alternate
      && decision.releaseCandidateCommit
      && alternate.sourceCommit === decision.releaseCandidateCommit
      && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(alternate.packageIntegrity ?? "")
      && alternate.approvedBy,
  );
  // An attestation for the version being released cannot exist before it is
  // released, so requiring one here would close the gate permanently. What is
  // checkable beforehand is the recorded verdict and the existence of a path
  // that will actually produce provenance; the release workflow asserts the
  // attestation itself once the version is on the registry.
  if (decision.provenance.status !== "VERIFIED") blockers.push("recorded provenance status is not VERIFIED");
  if (provenancePublishing !== true && !alternateValid) blockers.push("npm provenance publishing is not configured");
  if (auditErrors.length > 0) blockers.push("release audit has errors");

  return {
    auditErrors: [...new Set(auditErrors)],
    blockers: [...new Set(blockers)],
    releaseAllowed: blockers.length === 0,
  };
}

function printResult(result, decision) {
  console.log(`OSS release decision: ${decision.decision}`);
  console.log(`Release allowed: ${result.releaseAllowed ? "YES" : "NO"}`);
  for (const error of result.auditErrors) console.error(`AUDIT ERROR: ${error}`);
  for (const blocker of result.blockers) console.error(`BLOCKED: ${blocker}`);
}

// The attestation the pre-publish gate cannot require, asserted where it can
// exist: after `npm publish` has put the version on the registry.
export function publishedProvenanceErrors(view) {
  const errors = [];
  const attestations = view?.dist?.attestations;
  check(Boolean(attestations?.url), "the published release has no npm attestation bundle", errors);
  check(
    attestations?.provenance?.predicateType === "https://slsa.dev/provenance/v1",
    "the published release has no SLSA provenance attestation",
    errors,
  );
  return errors;
}

function verifyPublishedProvenance() {
  const pkg = readJson(join(root, "package.json"));
  const specifier = `${pkg.name}@${pkg.version}`;
  const published = npmView(specifier);
  const errors = published.published
    ? publishedProvenanceErrors(published.view)
    : [`${specifier} is not published, so its provenance cannot be verified`];

  for (const error of errors) console.error(`AUDIT ERROR: ${error}`);
  if (errors.length > 0) process.exitCode = 1;
  else console.log(`Published provenance verified for ${specifier}`);
}

function main() {
  if (process.argv.includes("--verify-published-provenance")) return verifyPublishedProvenance();

  const verifyRecordedState = process.argv.includes("--verify-recorded-state");
  const staticAudit = auditStaticRepository();
  let online;
  let candidate = { resolved: null, containedInHead: false, changedPaths: [] };
  let clean = false;
  const operationalErrors = [];
  const secretFindings = [];

  try {
    candidate = inspectReleaseCandidate(staticAudit.decision.releaseCandidateCommit);
    clean = command("git", ["status", "--porcelain=v1"]) === "";
    secretFindings.push(...scanTrackedWorktree(), ...scanGitHistory());
    if (staticAudit.decision.decision === "GO") runGitleaks();
  } catch (error) {
    operationalErrors.push(`could not inspect Git state: ${error.message}`);
  }

  try {
    online = inspectOnlineState(staticAudit.package, staticAudit.decision);
  } catch (error) {
    operationalErrors.push(`could not inspect GitHub/npm state: ${error.message}`);
    online = {
      githubVisibility: "UNKNOWN",
      githubPrivate: false,
      registry: null,
      releaseVersionPublished: false,
    };
  }

  const result = evaluateReleaseDecision({
    decision: staticAudit.decision,
    staticErrors: [...staticAudit.errors, ...operationalErrors],
    online,
    candidate,
    clean,
    provenancePublishing: staticAudit.provenancePublishing,
    secretFindings,
  });
  printResult(result, staticAudit.decision);

  if (verifyRecordedState && result.auditErrors.length === 0) return;
  if (!result.releaseAllowed) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? "") === scriptPath) main();
