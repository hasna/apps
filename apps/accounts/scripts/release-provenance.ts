#!/usr/bin/env bun

import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { gunzipSync } from "node:zlib";
import type { Bundle as SigstoreBundle } from "@sigstore/bundle";
import { compare, prerelease, valid } from "semver";

export const RELEASE_WORKFLOW = ".github/workflows/release.yml";
export const RELEASE_REVIEW_TRUST_PATH = "config/release-review-trust.json";
export const RELEASE_REVIEW_TRUST_SCHEMA = "hasna.release-review-trust/v1";
export const RELEASE_REVIEW_TRUST_ROTATION_SCHEMA =
  "hasna.release-review-trust-rotation/v1";
export const RELEASE_REVIEW_RECEIPT_SCHEMA =
  "hasna.signed-release-review-receipt/v1";
export const RELEASE_REVIEW_PAYLOAD_SCHEMA = "hasna.release-review/v1";
export const RELEASE_REVIEW_BOOTSTRAP_VERSION = "0.2.42";
export const RELEASE_REVIEW_BOOTSTRAP_REVIEWER_AGENT = "Rawls";
export const RELEASE_REVIEW_BOOTSTRAP_REVIEWER_ID =
  "019fe5d3-a6dc-71a0-b6cc-243ea32513b6";
export const RELEASE_REVIEW_BOOTSTRAP_PUBLIC_KEY =
  "MCowBQYDK2VwAyEA1trfyZBjRZgzYg3oov1AxW+Js5K6Tc/1b1hv/TpJniA=";
export const RELEASE_REVIEW_BOOTSTRAP_PUBLIC_KEY_SHA256 =
  "4e5e4d72beb074d44779c0f26dd2cd38c9ed5129131fd1432259f82943273da6";
export const RELEASE_REVIEW_SIGNING_SECRET_REF =
  "hasna/accounts/npm-release/reviewer-ed25519-private-key";
export const PUBLISH_PREDICATE =
  "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";
export const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";
const pinnedToolchain = JSON.parse(
  readFileSync(new URL("./release-toolchain.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
export const RELEASE_NODE_VERSION = text(pinnedToolchain.node, "pinned Node version");
export const RELEASE_NPM_VERSION = text(pinnedToolchain.npm, "pinned npm version");
export const RELEASE_BUN_VERSION = text(pinnedToolchain.bun, "pinned Bun version");
// Break-glass: the ONLY way to publish without the verified release workflow.
// Deliberately unguessable and reason-bearing so it cannot be enabled by reflex,
// and refused inside GitHub Actions so automation can never route around
// provenance. See docs/RELEASING.md, "Break-glass direct publish".
export const BREAK_GLASS_ENV = "ACCOUNTS_RELEASE_BREAK_GLASS";
export const BREAK_GLASS_TOKEN = "i-am-publishing-without-release-verification";
export const BREAK_GLASS_REASON_ENV = "ACCOUNTS_RELEASE_BREAK_GLASS_REASON";
export const BREAK_GLASS_MIN_REASON_LENGTH = 24;
export const MAX_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_TARBALL_BYTES = 32 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 512;
export const MAX_ARCHIVE_ENTRY_BYTES = 16 * 1024 * 1024;
export const MAX_ARCHIVE_UNPACKED_BYTES = 64 * 1024 * 1024;
export const MAX_PROMOTION_ATTEMPTS = 6;
export const FETCH_TIMEOUT_MS = 15_000;
export const COMMAND_TIMEOUT_MS = 180_000;
export const INSTALL_VISIBILITY_TIMEOUT_MS = 120_000;
export const INSTALL_VISIBILITY_POLL_MS = 2_000;

/**
 * The Accept header npm sends when it resolves an install. The registry varies
 * on it, so this is a different CDN cache entry from the full document every
 * other read in this file uses.
 */
export const NPM_INSTALL_ACCEPT = "application/vnd.npm.install-v1+json";

const REGISTRY = "https://registry.npmjs.org";
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const RELEASE_TAG_PATTERN = "refs/tags/npm/accounts/v*";
const RELEASE_ENVIRONMENT = "npm-release";
const RELEASE_ENVIRONMENT_TAG_PATTERN = "npm/accounts/v*";
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_TAR_STREAM_BYTES =
  MAX_ARCHIVE_UNPACKED_BYTES + MAX_ARCHIVE_ENTRIES * 1024 + 1024 * 1024;
const SIGSTORE_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const DSSE_IN_TOTO_PAYLOAD_TYPE = "application/vnd.in-toto+json";
const IN_TOTO_STATEMENT_V1 = "https://in-toto.io/Statement/v1";
const IN_TOTO_STATEMENT_V01 = "https://in-toto.io/Statement/v0.1";

/**
 * The two attestations npm returns are published against DIFFERENT in-toto
 * statement versions, and that is npm's spec rather than a defect to tolerate:
 *
 *   npm publish attestation  -> https://in-toto.io/Statement/v0.1
 *   SLSA provenance          -> https://in-toto.io/Statement/v1
 *
 * Measured on the live registry for @hasna/accounts@0.2.38, the first release
 * this repository ever published with attestations:
 *
 *   predicateType .../npm/attestation/tree/main/specs/publish/v0.1
 *     statement _type  https://in-toto.io/Statement/v0.1
 *   predicateType https://slsa.dev/provenance/v1
 *     statement _type  https://in-toto.io/Statement/v1
 *
 * Requiring v1 of BOTH — which this file did until now — is unsatisfiable by
 * construction, so `verify-registry --phase staged` rejected every attested
 * release after the tarball had already been published, leaving the intended
 * dist-tag unpromoted and requiring a manual repair. Release run 31185413057
 * failed exactly there on 0.2.38.
 *
 * This maps each predicate to the ONE statement version it is allowed to carry
 * rather than accepting either version for either predicate. That is strictly
 * tighter than the check it replaces in the dimension that matters: an unknown
 * predicate type now fails closed instead of being silently admitted, and a
 * provenance statement downgraded to v0.1 is still rejected.
 */
const REQUIRED_STATEMENT_TYPE = new Map<string, string>([
  [PUBLISH_PREDICATE, IN_TOTO_STATEMENT_V01],
  [PROVENANCE_PREDICATE, IN_TOTO_STATEMENT_V1],
]);

interface SigstoreVerifyOptions {
  certificateIdentityURI: string;
  certificateIssuer: string;
  ctLogThreshold?: number;
  tlogThreshold?: number;
}

interface Manifest {
  name: string;
  version: string;
  repository: string | { url: string };
  publishConfig?: { registry?: string; access?: string; tag?: string };
}

export interface PackResult {
  name: string;
  version: string;
  filename: string;
  shasum: string;
  integrity: string;
  size: number;
  files: Array<{ path: string; size: number; mode: number }>;
}

interface PackedArtifact {
  result: PackResult;
  bytes: Buffer;
}

interface StagedPackSource {
  root: string;
  preview: PackResult;
}

export interface ReleaseCandidate {
  schema: "hasna.accounts.release-candidate/v3";
  name: string;
  version: string;
  tag: string;
  commit: string;
  repository: string;
  workflow: typeof RELEASE_WORKFLOW;
  integrity: string;
  shasum: string;
  filename: string;
  size: number;
  fileCount: number;
  unpackedBytes: number;
  artifactPath: string;
  stagingTag: string;
  intendedTag: string;
}

export interface GitEvidence {
  head: string;
  tagObjectType?: string;
  tagCommit?: string;
  mainContainsCommit: boolean;
  status: string;
}

export interface ReleaseTagAuthorization {
  reviewCommentId: number;
  publisherAgent: string;
}

interface ReleaseGitAuthorization extends ReleaseTagAuthorization {
  workflowRevision: string;
}

export interface ReleaseReviewExpectation {
  commentId: number;
  repository: string;
  commit: string;
  packageName: string;
  version: string;
  tag: string;
  workflow: string;
  workflowRevision: string;
  trustPath: string;
  trustRevision: string;
  registry: string;
  reviewerAgent: string;
  reviewerAgentId: string;
  publisherAgent: string;
}

export interface ReleaseReviewTrust {
  schema: typeof RELEASE_REVIEW_TRUST_SCHEMA;
  generation: number;
  repository: string;
  reviewer: {
    type: "coding-agent";
    agent: string;
    id: string;
  };
  publicKey: {
    algorithm: "ed25519";
    encoding: "base64-spki-der";
    value: string;
    sha256: string;
  };
  signer: {
    secretRef: string;
  };
  rotation: null | {
    payload: string;
    signature: {
      algorithm: "ed25519";
      value: string;
    };
  };
}

export interface PriorReleaseReviewTrust {
  version: string;
  trustBytes: Uint8Array;
}

export type RegistryPhase = "staged" | "promoted";
type RecordValue = Record<string, unknown>;

export interface RegistryPromotionSnapshot {
  latest?: string;
  versions: string[];
  distTags: Array<[name: string, version: string]>;
  highestStable?: string;
}

export interface PromotionRegistry {
  readPackage: () => Promise<unknown>;
  setLatest: (version: string) => Promise<void>;
}

export type OriginPackumentFetcher = (
  url: URL,
  init: RequestInit,
) => Promise<Response>;

export interface OriginPackumentReaderOptions {
  nonce?: () => string;
  fetcher?: OriginPackumentFetcher;
}

export interface RegistryReleaseAttemptOperations {
  readVersionMetadata: () => Promise<unknown>;
  readPackageMetadata: () => Promise<unknown>;
  readTarball: (url: URL) => Promise<Uint8Array>;
  awaitInstallVisibility: () => Promise<void>;
  verifyConsumer: () => unknown[];
  verifyCryptographically: (bundles: unknown[]) => Promise<void>;
  verifySemantically: (bundles: unknown[]) => void;
}

export interface ArchiveSummary {
  fileCount: number;
  unpackedBytes: number;
  files: Array<{ path: string; size: number }>;
}

interface ParsedArchive {
  summary: ArchiveSummary;
  packageManifest?: Buffer;
  releaseReviewTrust?: Buffer;
}

type SigstoreVerifier = (
  bundle: SigstoreBundle,
  options?: SigstoreVerifyOptions,
) => Promise<void>;

interface ToolchainVersions {
  node: string;
  npm: string;
  bun: string;
}

interface RunOptions {
  inherit?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, label: string): RecordValue {
  check(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as RecordValue;
}

function exactObjectKeys(value: RecordValue, keys: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} fields must be exactly ${expected.join(", ")}`,
  );
}

function text(value: unknown, label: string): string {
  check(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
  return value;
}

function integer(value: unknown, label: string): number {
  check(Number.isInteger(value) && (value as number) >= 0, `${label} must be a non-negative integer`);
  return value as number;
}

function runResult(
  executable: string,
  args: string[],
  cwd: string,
  options: RunOptions = {},
) {
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    stdio: options.inherit ? "inherit" : "pipe",
    env: {
      ...process.env,
      ...options.env,
      NO_UPDATE_NOTIFIER: "1",
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_FUND: "false",
    },
    input: options.input,
  };
  return spawnSync(executable, args, spawnOptions);
}

function run(
  executable: string,
  args: string[],
  cwd: string,
  options: RunOptions = {},
): string {
  const result = runResult(executable, args, cwd, options);
  check(!result.error, `could not run ${executable}: ${result.error?.message}`);
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  check(
    result.status === 0,
    `${executable} ${args.join(" ")} failed with exit ${result.status}${detail ? `:\n${detail}` : ""}`,
  );
  return result.stdout ?? "";
}

function loadManifest(root: string): Manifest {
  const value = record(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), "package.json");
  const repository = value.repository;
  check(
    typeof repository === "string" ||
      (repository && typeof repository === "object" && !Array.isArray(repository) &&
        typeof (repository as RecordValue).url === "string"),
    "package.json repository must contain a URL",
  );
  return {
    name: text(value.name, "package name"),
    version: text(value.version, "package version"),
    repository: repository as Manifest["repository"],
    publishConfig: value.publishConfig as Manifest["publishConfig"],
  };
}

export function repositorySlug(manifest: Manifest): string {
  const url = typeof manifest.repository === "string" ? manifest.repository : manifest.repository.url;
  const match = url.match(
    /^(?:git\+)?(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/#]+?)(?:\.git)?$/,
  );
  check(match?.[1], `repository is not canonical GitHub metadata: ${url}`);
  return match[1];
}

export function releaseTag(manifest: Pick<Manifest, "name" | "version">): string {
  const slug = manifest.name.split("/").at(-1);
  check(slug?.match(/^[a-z0-9][a-z0-9._-]*$/), `invalid package name: ${manifest.name}`);
  check(
    manifest.version.match(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
    `invalid package version: ${manifest.version}`,
  );
  return `npm/${slug}/v${manifest.version}`;
}

export function parseReleaseTagAuthorization(message: string): ReleaseTagAuthorization {
  const lines = message.split(/\r?\n/);
  const commentIds = lines.flatMap((line) => {
    const match = line.match(/^Release-Review-Comment: ([1-9]\d*)$/);
    return match?.[1] ? [match[1]] : [];
  });
  const publisherAgents = lines.flatMap((line) => {
    const match = line.match(/^Agent: ([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/);
    return match?.[1] ? [match[1]] : [];
  });
  check(
    commentIds.length === 1,
    "tag annotation must contain exactly one Release-Review-Comment: <id> trailer",
  );
  check(
    publisherAgents.length === 1,
    "tag annotation must contain exactly one Agent: <publisher-agent> trailer",
  );
  const reviewCommentId = Number(commentIds[0]);
  check(
    Number.isSafeInteger(reviewCommentId) && reviewCommentId > 0,
    "Release-Review-Comment must be a positive safe integer",
  );
  return {
    reviewCommentId,
    publisherAgent: publisherAgents[0]!,
  };
}

function assertDistTag(value: string, label: string): string {
  check(
    value.match(/^[a-z][a-z0-9._-]{0,127}$/) && !value.match(/^v?\d+(?:\.\d+){1,2}(?:[-+].*)?$/),
    `${label} is not a safe npm dist-tag: ${value}`,
  );
  return value;
}

export function stagingDistTag(version: string): string {
  return assertDistTag(`release-candidate-${version.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}`, "staging tag");
}

function intendedDistTag(manifest: Manifest): string {
  const tag = assertDistTag(manifest.publishConfig?.tag ?? "latest", "intended tag");
  check(tag === "latest", "Accounts releases must promote only the latest dist-tag");
  return tag;
}

export function packagePurl(name: string, version: string): string {
  if (!name.startsWith("@")) return `pkg:npm/${name}@${version}`;
  const [scope, packageName, extra] = name.split("/");
  check(scope && packageName && !extra, `invalid scoped package name: ${name}`);
  return `pkg:npm/${encodeURIComponent(scope)}/${packageName}@${version}`;
}

function parsePack(stdout: string): PackResult {
  const start = stdout.indexOf("[");
  check(start !== -1, "npm pack did not produce JSON");
  const values = JSON.parse(stdout.slice(start)) as unknown;
  check(Array.isArray(values) && values.length === 1, "npm pack must describe one package");
  const value = record(values[0], "npm pack result");
  check(Array.isArray(value.files) && value.files.length > 0, "npm pack reported no files");
  return {
    name: text(value.name, "pack name"),
    version: text(value.version, "pack version"),
    filename: text(value.filename, "pack filename"),
    shasum: text(value.shasum, "pack shasum"),
    integrity: text(value.integrity, "pack integrity"),
    size: integer(value.size, "pack size"),
    files: value.files.map((entry, index) => {
      const file = record(entry, `pack file ${index}`);
      return {
        path: text(file.path, `pack file ${index} path`),
        size: integer(file.size, `pack file ${index} size`),
        mode: integer(file.mode, `pack file ${index} mode`),
      };
    }),
  };
}

function tarText(header: Buffer, offset: number, length: number, label: string): string {
  const field = header.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  const value = field.subarray(0, nul === -1 ? field.length : nul).toString("utf8");
  check(!value.match(/[\u0000-\u001f\u007f]/), `${label} contains control characters`);
  return value;
}

function tarOctal(header: Buffer, offset: number, length: number, label: string): number {
  const raw = header.subarray(offset, offset + length).toString("ascii").replace(/\0.*$/, "").trim();
  check(raw.match(/^[0-7]+$/), `${label} is not canonical octal`);
  const value = Number.parseInt(raw, 8);
  check(Number.isSafeInteger(value) && value >= 0, `${label} exceeds safe integer range`);
  return value;
}

function assertTarChecksum(header: Buffer): void {
  const expected = tarOctal(header, 148, 8, "archive header checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index++) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]!;
  }
  check(actual === expected, "archive header checksum disagrees");
}

function archivePath(header: Buffer): string {
  const name = tarText(header, 0, 100, "archive entry name");
  const prefix = tarText(header, 345, 155, "archive entry prefix");
  const path = prefix ? `${prefix}/${name}` : name;
  check(
    path.startsWith("package/") &&
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.match(/(?:^|\/)\.{1,2}(?:\/|$)/) &&
      posix.normalize(path) === path,
    `unsafe archive path: ${path || "<empty>"}`,
  );
  return path.slice("package/".length);
}

function parseArchive(bytes: Uint8Array): ParsedArchive {
  let tar: Buffer;
  try {
    tar = gunzipSync(Buffer.from(bytes), { maxOutputLength: MAX_TAR_STREAM_BYTES });
  } catch (error) {
    throw new Error(
      `archive gzip stream is invalid or exceeds ${MAX_TAR_STREAM_BYTES} bytes: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  check(tar.length % 512 === 0, "archive tar stream is not block aligned");
  const files: ArchiveSummary["files"] = [];
  let packageManifest: Buffer | undefined;
  let releaseReviewTrust: Buffer | undefined;
  const seen = new Set<string>();
  let unpackedBytes = 0;
  let entries = 0;
  let offset = 0;
  let endBlocks = 0;
  while (offset < tar.length) {
    const header = tar.subarray(offset, offset + 512);
    check(header.length === 512, "archive header is truncated");
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      endBlocks++;
      if (endBlocks === 2) {
        check(
          tar.subarray(offset).every((byte) => byte === 0),
          "archive contains data after its terminal blocks",
        );
        break;
      }
      continue;
    }
    check(endBlocks === 0, "archive contains a single zero block before data");
    assertTarChecksum(header);
    check(
      tarText(header, 257, 6, "archive format") === "ustar",
      "archive must use the ustar format",
    );
    entries++;
    check(entries <= MAX_ARCHIVE_ENTRIES, `archive entry count exceeds ${MAX_ARCHIVE_ENTRIES}`);
    const type = String.fromCharCode(header[156] ?? 0);
    check(
      type === "\0" || type === "0" || type === "5",
      `unsupported archive entry type ${JSON.stringify(type)}`,
    );
    const path = archivePath(header);
    check(!seen.has(path), `archive contains duplicate path: ${path}`);
    seen.add(path);
    const size = tarOctal(header, 124, 12, "archive entry size");
    if (type === "5") {
      check(size === 0, "archive directory entry must be empty");
      continue;
    }
    check(
      size <= MAX_ARCHIVE_ENTRY_BYTES,
      `archive individual entry exceeds ${MAX_ARCHIVE_ENTRY_BYTES} bytes`,
    );
    unpackedBytes += size;
    check(
      unpackedBytes <= MAX_ARCHIVE_UNPACKED_BYTES,
      `archive total unpacked bytes exceed ${MAX_ARCHIVE_UNPACKED_BYTES}`,
    );
    const padded = Math.ceil(size / 512) * 512;
    check(offset + padded <= tar.length, `archive entry ${path} is truncated`);
    if (path === "package.json") {
      packageManifest = Buffer.from(tar.subarray(offset, offset + size));
    }
    if (path === RELEASE_REVIEW_TRUST_PATH) {
      releaseReviewTrust = Buffer.from(tar.subarray(offset, offset + size));
    }
    offset += padded;
    files.push({ path, size });
  }
  check(endBlocks === 2, "archive is missing two terminal zero blocks");
  check(files.length > 0, "archive contains no regular files");
  return {
    summary: { fileCount: files.length, unpackedBytes, files },
    packageManifest,
    releaseReviewTrust,
  };
}

export function verifyArchive(bytes: Uint8Array): ArchiveSummary {
  return parseArchive(bytes).summary;
}

function exactCommit(value: string, label: string): string {
  check(value.match(/^[0-9a-f]{40}$/), `${label} must be an exact 40-character lowercase git SHA`);
  return value;
}

function verifyPackedManifest(
  archive: ParsedArchive,
  expected: Pick<ReleaseCandidate, "name" | "version" | "commit">,
): void {
  const bytes = archive.packageManifest;
  check(bytes, "packed archive is missing package.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `packed package.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const manifest = record(parsed, "packed package.json");
  check(
    manifest.name === expected.name && manifest.version === expected.version,
    "packed package.json identity disagrees with the release candidate",
  );
  check(
    manifest.gitHead === exactCommit(expected.commit, "expected gitHead"),
    "packed package.json gitHead disagrees with the release commit",
  );
}

function verifyArtifactBytes(
  pack: PackResult,
  bytes: Buffer,
  expectedCommit: string,
): void {
  check(bytes.length === pack.size, "npm pack size does not match the tarball bytes");
  check(bytes.length <= MAX_TARBALL_BYTES, `tarball exceeds ${MAX_TARBALL_BYTES} bytes`);
  check(
    createHash("sha1").update(bytes).digest("hex") === pack.shasum &&
      `sha512-${createHash("sha512").update(bytes).digest("base64")}` === pack.integrity,
    "npm pack metadata does not match the tarball bytes",
  );
  const archive = parseArchive(bytes);
  const summary = archive.summary;
  const expectedFiles = pack.files
    .map(({ path, size }) => ({ path, size }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const archiveFiles = [...summary.files].sort((left, right) => left.path.localeCompare(right.path));
  check(
    JSON.stringify(archiveFiles) === JSON.stringify(expectedFiles),
    "archive entries disagree with npm pack metadata",
  );
  verifyPackedManifest(archive, {
    name: pack.name,
    version: pack.version,
    commit: expectedCommit,
  });
}

export function assertDeterministicPacks(
  first: PackResult,
  second: PackResult,
  firstBytes?: Uint8Array,
  secondBytes?: Uint8Array,
): void {
  check(
    JSON.stringify(first) === JSON.stringify(second),
    "two clean build-and-pack runs produced different artifacts; refusing release",
  );
  if (firstBytes || secondBytes) {
    check(firstBytes && secondBytes, "both packed byte streams are required");
    check(
      Buffer.from(firstBytes).equals(Buffer.from(secondBytes)),
      "two clean build-and-pack runs produced different tarball bytes; refusing release",
    );
  }
}

function safePackPath(root: string, path: string): {
  source: string;
  relativePath: string;
} {
  check(
    !isAbsolute(path) &&
      !path.includes("\\") &&
      !path.match(/(?:^|\/)\.{1,2}(?:\/|$)/) &&
      posix.normalize(path) === path,
    `npm pack returned an unsafe file path: ${path}`,
  );
  const source = resolve(root, ...path.split("/"));
  const relativePath = relative(root, source);
  check(
    relativePath && relativePath !== ".." && !relativePath.startsWith(`..${sep}`),
    `npm pack file escapes the package root: ${path}`,
  );
  return { source, relativePath };
}

function stagePackSource(root: string, expectedCommit: string): StagedPackSource {
  const preview = parsePack(run("npm", [
    "pack", "--ignore-scripts", "--json", "--dry-run",
  ], root));
  const staged = mkdtempSync(join(tmpdir(), "accounts-pack-source-"));
  for (const file of preview.files) {
    const { source, relativePath } = safePackPath(root, file.path);
    const stat = lstatSync(source);
    check(
      stat.isFile() && !stat.isSymbolicLink(),
      `npm pack source must be a regular non-symlink file: ${file.path}`,
    );
    const destination = join(staged, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    chmodSync(destination, file.mode);
  }
  const manifestPath = join(staged, "package.json");
  const manifest = record(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    "staged package.json",
  );
  check(
    manifest.gitHead === undefined,
    "source package.json must not contain generated gitHead metadata",
  );
  manifest.gitHead = exactCommit(expectedCommit, "release commit");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "w",
    mode: 0o644,
  });
  return { root: staged, preview };
}

function verifyStagedPackFileSet(preview: PackResult, packed: PackResult): void {
  check(
    preview.name === packed.name && preview.version === packed.version,
    "staged pack identity changed after gitHead injection",
  );
  const fileShape = (pack: PackResult) =>
    pack.files
      .map(({ path, size, mode }) => ({
        path,
        size: path === "package.json" ? "<generated-gitHead>" : size,
        mode,
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
  check(
    JSON.stringify(fileShape(preview)) === JSON.stringify(fileShape(packed)),
    "staged pack file set changed after gitHead injection",
  );
}

function buildAndPack(root: string, expectedCommit: string): PackedArtifact {
  run("bun", ["run", "build"], root, { inherit: true, timeoutMs: 300_000 });
  const staged = stagePackSource(root, expectedCommit);
  const destination = mkdtempSync(join(tmpdir(), "accounts-pack-"));
  try {
    const pack = parsePack(run("npm", [
      "pack", "--ignore-scripts", "--json", "--pack-destination", destination,
    ], staged.root));
    verifyStagedPackFileSet(staged.preview, pack);
    check(basename(pack.filename) === pack.filename, "npm pack returned an unsafe filename");
    const bytes = readFileSync(join(destination, pack.filename));
    verifyArtifactBytes(pack, bytes, expectedCommit);
    return { result: pack, bytes };
  } finally {
    rmSync(staged.root, { recursive: true, force: true });
    rmSync(destination, { recursive: true, force: true });
  }
}

export function verifyDeterministicPack(
  root: string,
  artifactPath?: string,
  expectedCommit = run("git", ["rev-parse", "HEAD"], root).trim(),
): PackResult {
  exactCommit(expectedCommit, "release commit");
  const first = buildAndPack(root, expectedCommit);
  const second = buildAndPack(root, expectedCommit);
  assertDeterministicPacks(first.result, second.result, first.bytes, second.bytes);
  if (artifactPath) {
    const output = resolve(artifactPath);
    writeFileSync(output, second.bytes, { flag: "wx", mode: 0o600 });
  }
  console.log(
    `verified deterministic package ${second.result.name}@${second.result.version}: ` +
      `${second.result.files.length} files, ${second.result.size} bytes, ${second.result.integrity}`,
  );
  return second.result;
}

function workflowIdentity(
  manifest: Manifest,
  env: NodeJS.ProcessEnv,
): { repository: string; tag: string; sha: string } {
  const repository = repositorySlug(manifest);
  const tag = releaseTag(manifest);
  const expected: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: `refs/tags/${tag}`,
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: tag,
    GITHUB_REF_PROTECTED: "true",
    GITHUB_REPOSITORY: repository,
    GITHUB_WORKFLOW_REF: `${repository}/${RELEASE_WORKFLOW}@refs/tags/${tag}`,
  };
  for (const [name, value] of Object.entries(expected)) {
    check(env[name] === value, `${name} must be ${value}; received ${env[name] ?? "<unset>"}`);
  }
  const sha = text(env.GITHUB_SHA, "GITHUB_SHA");
  check(sha.match(/^[0-9a-f]{40}$/), "GITHUB_SHA must be a full commit SHA");
  check(
    env.NPM_DIST_TAG_TOKEN_CONFIGURED === "true",
    "NPM_DIST_TAG_TOKEN is not configured in the protected release environment",
  );
  // The preflight's administration credential is MINTED per run from a GitHub
  // App, so the thing that can be missing from the environment is the App's
  // credentials — not a token. Asserting the old
  // RELEASE_GITHUB_ADMIN_TOKEN_CONFIGURED here would fail every run with a
  // message naming a secret the design deliberately no longer stores, which is
  // a false report of the cause rather than an honest one.
  check(
    env.RELEASE_APP_ID_CONFIGURED === "true",
    "RELEASE_APP_ID is not configured in the protected release environment",
  );
  check(
    env.RELEASE_APP_PRIVATE_KEY_CONFIGURED === "true",
    "RELEASE_APP_PRIVATE_KEY is not configured in the protected release environment",
  );
  check(manifest.publishConfig?.registry === REGISTRY, `publish registry must be ${REGISTRY}`);
  check(manifest.publishConfig?.access === "public", "publish access must be public");
  return { repository, tag, sha };
}

function assertExactToolchain(versions: ToolchainVersions): void {
  check(versions.node.trim() === `v${RELEASE_NODE_VERSION}`, `Node ${RELEASE_NODE_VERSION} is required`);
  check(versions.npm.trim() === RELEASE_NPM_VERSION, `npm ${RELEASE_NPM_VERSION} is required`);
  check(versions.bun.trim() === RELEASE_BUN_VERSION, `Bun ${RELEASE_BUN_VERSION} is required`);
}

export function assertTrustedPublishEnvironment(
  manifest: Manifest,
  env: NodeJS.ProcessEnv,
  versions: ToolchainVersions,
): void {
  workflowIdentity(manifest, env);
  assertExactToolchain(versions);
  check(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, "GitHub OIDC is missing");
  const credentialKeys = Object.entries(env)
    .filter(([name, value]) =>
      Boolean(value) &&
      /^(?:NODE_AUTH_TOKEN|NPM_TOKEN|NPM_CONFIG_.*(?:AUTH|TOKEN))/i.test(name)
    )
    .map(([name]) => name);
  check(
    credentialKeys.length === 0,
    "long-lived npm publish tokens are forbidden during trusted publication",
  );
}

function assertPromotionEnvironment(
  manifest: Manifest,
  env: NodeJS.ProcessEnv,
  versions: ToolchainVersions,
): void {
  workflowIdentity(manifest, env);
  assertExactToolchain(versions);
  check(env.NODE_AUTH_TOKEN, "the scoped npm dist-tag promotion token is missing");
  const credentialKeys = Object.entries(env)
    .filter(([name, value]) =>
      Boolean(value) &&
      /^(?:NODE_AUTH_TOKEN|NPM_TOKEN|NPM_CONFIG_.*(?:AUTH|TOKEN))/i.test(name)
    )
    .map(([name]) => name);
  check(
    credentialKeys.length === 1 && credentialKeys[0] === "NODE_AUTH_TOKEN",
    "unexpected npm credential source",
  );
}

function currentToolchain(root: string): ToolchainVersions {
  return {
    node: run("node", ["--version"], root).trim(),
    npm: run("npm", ["--version"], root).trim(),
    bun: run("bun", ["--version"], root).trim(),
  };
}

export function assertGitEvidence(
  manifest: Manifest,
  sha: string,
  evidence: GitEvidence,
): void {
  const tag = releaseTag(manifest);
  check(evidence.head === sha, "HEAD does not match GITHUB_SHA");
  check(evidence.tagObjectType !== undefined, `${tag} is missing`);
  check(evidence.tagObjectType === "tag", `${tag} is not annotated`);
  check(evidence.tagCommit === sha, `${tag} does not resolve to HEAD`);
  check(evidence.mainContainsCommit, `${sha} is not contained in origin/main`);
  check(!evidence.status.trim(), "release checkout is dirty");
}

function optionalGit(root: string, args: string[]): string | undefined {
  const result = runResult("git", args, root);
  if (result.error || result.status !== 0) return undefined;
  return result.stdout?.trim();
}

function assertGitContext(
  root: string,
  manifest: Manifest,
  env: NodeJS.ProcessEnv,
): ReleaseGitAuthorization {
  const sha = text(env.GITHUB_SHA, "GITHUB_SHA");
  const tag = releaseTag(manifest);
  const mainResult = runResult("git", ["merge-base", "--is-ancestor", sha, "origin/main"], root);
  assertGitEvidence(manifest, sha, {
    head: run("git", ["rev-parse", "HEAD"], root).trim(),
    tagObjectType: optionalGit(root, ["cat-file", "-t", `refs/tags/${tag}`]),
    tagCommit: optionalGit(root, ["rev-parse", `${tag}^{commit}`]),
    mainContainsCommit: !mainResult.error && mainResult.status === 0,
    status: run("git", ["status", "--porcelain", "--untracked-files=all"], root),
  });
  const authorization = parseReleaseTagAuthorization(
    run("git", ["for-each-ref", "--format=%(contents)", `refs/tags/${tag}`], root).trim(),
  );
  return {
    ...authorization,
    workflowRevision: exactCommit(
      run("git", ["rev-parse", `${sha}:${RELEASE_WORKFLOW}`], root).trim(),
      "release workflow revision",
    ),
  };
}

function refConditionIncludesReleaseTag(value: unknown): boolean {
  const conditions = record(value, "ruleset conditions");
  const refName = record(conditions.ref_name, "ruleset ref_name condition");
  check(Array.isArray(refName.include), "ruleset ref includes must be an array");
  check(Array.isArray(refName.exclude), "ruleset ref excludes must be an array");
  return refName.include.length === 1 &&
    refName.include[0] === RELEASE_TAG_PATTERN &&
    refName.exclude.length === 0;
}

export function verifyReleaseRulesets(input: unknown): { id: number; name: string } {
  check(Array.isArray(input), "GitHub rulesets response must be an array");
  for (const entry of input) {
    const ruleset = record(entry, "GitHub ruleset");
    if (
      ruleset.target !== "tag" ||
      ruleset.enforcement !== "active" ||
      !refConditionIncludesReleaseTag(ruleset.conditions)
    ) continue;
    check(Array.isArray(ruleset.rules), "ruleset rules must be an array");
    const types = ruleset.rules.map((rule, index) =>
      text(record(rule, `ruleset rule ${index}`).type, `ruleset rule ${index} type`)
    );
    check(
      types.length === 3 &&
        new Set(types).size === 3 &&
        ["creation", "update", "deletion"].every((type) => types.includes(type)),
      "release tag rules must be exactly creation, update, and deletion",
    );
    // This once required `bypass_actors` to be exactly one OrganizationAdmin
    // always-bypass. That check is NOT satisfiable by a credential fit to make
    // it: GitHub withholds `bypass_actors` from `administration: read` and
    // returns it only to `administration: write` — measured on this repository,
    // same ruleset, permission the only variable. And a write-capable token was
    // measured CREATING a ruleset (HTTP 201; a read-only token got 403), which
    // makes the attestation tautological — it would prove the protections exist
    // and that the reader could have authored them. A credential that can write
    // the artifact it certifies is not a verification credential.
    //
    // So the release verifies what a read-only credential can honestly prove:
    // that IT cannot bypass this ruleset. `current_user_can_bypass` is returned
    // at read level and fails closed here on any value but "never".
    //
    // What this deliberately no longer proves IN-RUN: that no OTHER actor holds
    // a bypass. That is a property of the org's ruleset configuration rather
    // than of a release, it cannot be read without write authority, and it is
    // therefore audited out-of-band instead of by the credential under test.
    check(
      ruleset.current_user_can_bypass !== undefined,
      "release tag ruleset bypass posture is unavailable; administration-read authority is required",
    );
    check(
      ruleset.current_user_can_bypass === "never",
      "the release credential must not be able to bypass the release tag ruleset",
    );
    return {
      id: integer(ruleset.id, "ruleset id"),
      name: text(ruleset.name, "ruleset name"),
    };
  }
  throw new Error(
    `no active tag ruleset protects only ${RELEASE_TAG_PATTERN} with creation, update, and deletion restrictions`,
  );
}

// The administration credential is a GitHub App installation token minted for
// this run, so it has no user identity: `GET /user` answers 403 "Resource not
// accessible by integration" for any installation token. The binding this
// asserts instead is the credential's SCOPE — it must reach exactly this one
// repository and nothing else. That is narrower than the personal token it
// replaces, which necessarily carried everything its owner could reach.
//
// Administration-read authority is proven separately and already fails closed:
// GitHub omits `bypass_actors` from a ruleset read without it, and
// verifyReleaseRulesets() rejects a ruleset whose bypass actors are absent.
export function verifyReleaseEnvironment(
  environmentInput: unknown,
  policiesInput: unknown,
  actorPermissionInput: unknown,
  administrationScopeInput: unknown,
  repositoryInput: unknown,
): void {
  const environment = record(environmentInput, "GitHub release environment");
  const actorPermission = record(actorPermissionInput, "GitHub release actor permission");
  record(actorPermission.user, "GitHub release actor");
  const repository = text(repositoryInput, "release repository");
  const administrationScope = record(
    administrationScopeInput,
    "GitHub administration credential scope",
  );
  check(actorPermission.permission === "admin", "release actor must have repository admin permission");
  check(
    Array.isArray(administrationScope.repositories),
    "administration credential scope must list its repositories",
  );
  check(
    administrationScope.total_count === 1 && administrationScope.repositories.length === 1,
    "administration credential must be scoped to exactly one repository",
  );
  check(
    text(
      record(administrationScope.repositories[0], "administration credential repository").full_name,
      "administration credential repository full name",
    ) === repository,
    "administration credential must be scoped to the release repository",
  );
  check(environment.name === RELEASE_ENVIRONMENT, `release environment must be ${RELEASE_ENVIRONMENT}`);
  check(Array.isArray(environment.protection_rules), "release environment protection rules must be an array");
  const rules = environment.protection_rules.map((entry, index) =>
    record(entry, `environment protection rule ${index}`)
  );
  check(
    !rules.some((rule) => rule.type === "required_reviewers"),
    "release environment must have zero required reviewers; human/manual approval is forbidden",
  );
  check(rules.some((rule) => rule.type === "branch_policy"), "release environment needs a tag policy");
  const deployment = record(environment.deployment_branch_policy, "deployment branch policy");
  check(
    deployment.protected_branches === false && deployment.custom_branch_policies === true,
    "release environment must use custom deployment policies only",
  );
  const policies = record(policiesInput, "deployment tag policies");
  check(Array.isArray(policies.branch_policies), "deployment tag policies must be an array");
  check(
    policies.branch_policies.length === 1,
    "release environment must have exactly one deployment tag policy",
  );
  check(
    record(policies.branch_policies[0], "deployment tag policy").name ===
        RELEASE_ENVIRONMENT_TAG_PATTERN &&
      record(policies.branch_policies[0], "deployment tag policy").type === "tag",
    `release environment must use the exact ${RELEASE_ENVIRONMENT_TAG_PATTERN} tag policy`,
  );
}

function releaseReviewPublicKey(
  trust: Pick<ReleaseReviewTrust, "publicKey">,
): ReturnType<typeof createPublicKey> {
  const publicKeyBytes = decodeBase64(
    trust.publicKey.value,
    "release review trust public key",
  );
  check(
    createHash("sha256").update(publicKeyBytes).digest("hex") ===
      trust.publicKey.sha256,
    "release review trust public key SHA-256 disagrees",
  );
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey({
      key: publicKeyBytes,
      format: "der",
      type: "spki",
    });
  } catch (error) {
    throw new Error(
      `release review trust public key is not valid SPKI DER: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  check(
    publicKey.asymmetricKeyType === "ed25519",
    "release review trust public key must be Ed25519",
  );
  return publicKey;
}

function releaseReviewTrustCore(trust: ReleaseReviewTrust) {
  return {
    schema: trust.schema,
    generation: trust.generation,
    repository: trust.repository,
    reviewer: trust.reviewer,
    publicKey: trust.publicKey,
    signer: trust.signer,
  };
}

export function parseReleaseReviewTrust(input: Uint8Array | string | unknown): ReleaseReviewTrust {
  let value: unknown = input;
  if (typeof input === "string" || input instanceof Uint8Array) {
    try {
      value = JSON.parse(
        typeof input === "string" ? input : Buffer.from(input).toString("utf8"),
      ) as unknown;
    } catch (error) {
      throw new Error(
        `release review trust document is invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const document = record(value, "release review trust document");
  exactObjectKeys(document, [
    "schema",
    "generation",
    "repository",
    "reviewer",
    "publicKey",
    "signer",
    "rotation",
  ], "release review trust document");
  check(
    document.schema === RELEASE_REVIEW_TRUST_SCHEMA,
    `release review trust schema must be ${RELEASE_REVIEW_TRUST_SCHEMA}`,
  );
  const generation = integer(document.generation, "release review trust generation");
  check(generation > 0, "release review trust generation must be positive");
  const reviewerInput = record(document.reviewer, "release review trust reviewer");
  exactObjectKeys(reviewerInput, ["type", "agent", "id"], "release review trust reviewer");
  check(
    reviewerInput.type === "coding-agent",
    "release review trust reviewer must be a coding-agent",
  );
  const reviewer = {
    type: "coding-agent" as const,
    agent: text(reviewerInput.agent, "release review trust reviewer agent"),
    id: text(reviewerInput.id, "release review trust reviewer id"),
  };
  check(
    reviewer.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    "release review trust reviewer id must be a lowercase UUID",
  );
  const publicKeyInput = record(document.publicKey, "release review trust public key");
  exactObjectKeys(
    publicKeyInput,
    ["algorithm", "encoding", "value", "sha256"],
    "release review trust public key",
  );
  check(
    publicKeyInput.algorithm === "ed25519" &&
      publicKeyInput.encoding === "base64-spki-der",
    "release review trust public key must be base64 SPKI DER Ed25519",
  );
  const publicKey = {
    algorithm: "ed25519" as const,
    encoding: "base64-spki-der" as const,
    value: text(publicKeyInput.value, "release review trust public key value"),
    sha256: text(publicKeyInput.sha256, "release review trust public key SHA-256"),
  };
  check(
    publicKey.sha256.match(/^[0-9a-f]{64}$/),
    "release review trust public key SHA-256 must be lowercase hex",
  );
  const signerInput = record(document.signer, "release review trust signer");
  exactObjectKeys(signerInput, ["secretRef"], "release review trust signer");
  const signer = {
    secretRef: text(signerInput.secretRef, "release review trust signer secret reference"),
  };
  let rotation: ReleaseReviewTrust["rotation"] = null;
  if (document.rotation !== null) {
    const rotationInput = record(document.rotation, "release review trust rotation");
    exactObjectKeys(rotationInput, ["payload", "signature"], "release review trust rotation");
    const signatureInput = record(
      rotationInput.signature,
      "release review trust rotation signature",
    );
    exactObjectKeys(
      signatureInput,
      ["algorithm", "value"],
      "release review trust rotation signature",
    );
    check(
      signatureInput.algorithm === "ed25519",
      "release review trust rotation signature algorithm must be ed25519",
    );
    rotation = {
      payload: text(rotationInput.payload, "release review trust rotation payload"),
      signature: {
        algorithm: "ed25519",
        value: text(
          signatureInput.value,
          "release review trust rotation signature value",
        ),
      },
    };
  }
  const trust: ReleaseReviewTrust = {
    schema: RELEASE_REVIEW_TRUST_SCHEMA,
    generation,
    repository: text(document.repository, "release review trust repository"),
    reviewer,
    publicKey,
    signer,
    rotation,
  };
  releaseReviewPublicKey(trust);
  return trust;
}

export function buildReleaseReviewTrustRotationPayload(
  nextTrustInput: unknown,
  previousReleaseInput: unknown,
) {
  const nextTrust = parseReleaseReviewTrust({
    ...record(nextTrustInput, "next release review trust"),
    rotation: null,
  });
  const previousRelease = record(previousReleaseInput, "previous release trust anchor");
  exactObjectKeys(
    previousRelease,
    ["package", "version", "registry", "trustSha256"],
    "previous release trust anchor",
  );
  const version = text(previousRelease.version, "previous release trust version");
  check(valid(version) === version, "previous release trust version must be exact SemVer");
  const trustSha256 = text(
    previousRelease.trustSha256,
    "previous release trust SHA-256",
  );
  check(
    trustSha256.match(/^[0-9a-f]{64}$/),
    "previous release trust SHA-256 must be lowercase hex",
  );
  return {
    schema: RELEASE_REVIEW_TRUST_ROTATION_SCHEMA,
    previousRelease: {
      package: text(previousRelease.package, "previous release trust package"),
      version,
      registry: text(previousRelease.registry, "previous release trust registry"),
      trustSha256,
    },
    nextTrust: releaseReviewTrustCore(nextTrust),
  };
}

export function verifyReleaseReviewTrustChain(
  currentTrustBytesInput: Uint8Array,
  currentVersion: string,
  prior?: PriorReleaseReviewTrust,
): ReleaseReviewTrust {
  const currentTrustBytes = Buffer.from(currentTrustBytesInput);
  const current = parseReleaseReviewTrust(currentTrustBytes);
  check(current.repository === "hasna/accounts", "release review trust repository disagrees");
  if (current.generation === 1 && !prior) {
    check(
      currentVersion === RELEASE_REVIEW_BOOTSTRAP_VERSION,
      `generation 1 bootstrap is allowed only for @hasna/accounts@${RELEASE_REVIEW_BOOTSTRAP_VERSION}`,
    );
    check(current.rotation === null, "generation 1 bootstrap must not contain rotation authorization");
    check(
      current.reviewer.agent === RELEASE_REVIEW_BOOTSTRAP_REVIEWER_AGENT &&
        current.reviewer.id === RELEASE_REVIEW_BOOTSTRAP_REVIEWER_ID,
      "generation 1 bootstrap reviewer must be the fixed Rawls identity",
    );
    check(
      current.publicKey.value === RELEASE_REVIEW_BOOTSTRAP_PUBLIC_KEY &&
        current.publicKey.sha256 === RELEASE_REVIEW_BOOTSTRAP_PUBLIC_KEY_SHA256,
      "generation 1 bootstrap public key must be the Rawls-reviewed trust root",
    );
    check(
      current.signer.secretRef === RELEASE_REVIEW_SIGNING_SECRET_REF,
      "generation 1 bootstrap signer reference disagrees",
    );
    return current;
  }

  check(prior, "release review trust rotation requires immutable prior release trust bytes");
  const priorBytes = Buffer.from(prior.trustBytes);
  const previous = parseReleaseReviewTrust(priorBytes);
  if (currentTrustBytes.equals(priorBytes)) {
    check(
      current.generation === previous.generation,
      "byte-identical prior release trust generation disagrees",
    );
    return current;
  }
  check(
    current.generation === previous.generation + 1,
    "release review trust rotation must increment generation exactly once",
  );
  check(current.rotation, "changed release review trust requires rotation authorization");
  const expectedPayload = buildReleaseReviewTrustRotationPayload(
    releaseReviewTrustCore(current),
    {
      package: "@hasna/accounts",
      version: prior.version,
      registry: REGISTRY,
      trustSha256: createHash("sha256").update(priorBytes).digest("hex"),
    },
  );
  const payloadBytes = decodeBase64(
    current.rotation.payload,
    "release review trust rotation payload",
  );
  check(
    payloadBytes.toString("utf8") === JSON.stringify(expectedPayload),
    "release review rotation payload disagrees with immutable prior release trust bytes",
  );
  const signatureBytes = decodeBase64(
    current.rotation.signature.value,
    "release review trust rotation signature",
  );
  check(signatureBytes.length === 64, "release review trust rotation signature must be 64 bytes");
  check(
    verifySignature(null, payloadBytes, releaseReviewPublicKey(previous), signatureBytes),
    "release review trust rotation is not authorized by the prior trust root",
  );
  return current;
}

export function buildReleaseReviewPayload(expected: ReleaseReviewExpectation) {
  return {
    schema: RELEASE_REVIEW_PAYLOAD_SCHEMA,
    repository: expected.repository,
    commit: expected.commit,
    package: {
      name: expected.packageName,
      version: expected.version,
    },
    tag: expected.tag,
    workflow: {
      path: expected.workflow,
      revision: expected.workflowRevision,
    },
    trust: {
      path: expected.trustPath,
      revision: expected.trustRevision,
    },
    registry: expected.registry,
    reviewer: {
      type: "coding-agent",
      agent: expected.reviewerAgent,
      id: expected.reviewerAgentId,
    },
    publisher: {
      type: "coding-agent",
      agent: expected.publisherAgent,
    },
    verdict: "GO",
    openReachableInScopeBlockers: {
      p0: 0,
      p1: 0,
    },
  };
}

export function verifyReleaseReviewReceipt(
  commentInput: unknown,
  expected: ReleaseReviewExpectation,
  trust: ReleaseReviewTrust,
): void {
  check(
    expected.reviewerAgent === trust.reviewer.agent &&
      expected.reviewerAgentId === trust.reviewer.id,
    "release review expectation disagrees with candidate-pinned reviewer identity",
  );
  const comment = record(commentInput, "release review comment");
  check(
    integer(comment.id, "release review comment id") === expected.commentId,
    "release review comment id disagrees with the tag",
  );
  check(
    exactCommit(text(comment.commit_id, "release review commit id"), "release review commit id") ===
      expected.commit,
    "release review commit disagrees with the tagged candidate",
  );
  const createdAt = text(comment.created_at, "release review created_at");
  const updatedAt = text(comment.updated_at, "release review updated_at");
  check(createdAt === updatedAt, "release review comment must not be edited");

  let receiptInput: unknown;
  try {
    receiptInput = JSON.parse(text(comment.body, "release review comment body")) as unknown;
  } catch (error) {
    throw new Error(
      `release review comment body is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const receipt = record(receiptInput, "signed release review receipt");
  exactObjectKeys(receipt, ["schema", "payload", "signature"], "signed release review receipt");
  check(
    receipt.schema === RELEASE_REVIEW_RECEIPT_SCHEMA,
    `signed release review receipt schema must be ${RELEASE_REVIEW_RECEIPT_SCHEMA}`,
  );
  const payloadBytes = decodeBase64(receipt.payload, "release review payload");
  const signature = record(receipt.signature, "release review signature");
  exactObjectKeys(signature, ["algorithm", "value"], "release review signature");
  check(signature.algorithm === "ed25519", "release review signature algorithm must be ed25519");
  const signatureBytes = decodeBase64(signature.value, "release review signature value");
  check(signatureBytes.length === 64, "release review Ed25519 signature must be 64 bytes");

  check(
    verifySignature(null, payloadBytes, releaseReviewPublicKey(trust), signatureBytes),
    "release review signature is invalid",
  );

  let payloadInput: unknown;
  try {
    payloadInput = JSON.parse(payloadBytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `release review payload is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const payload = record(payloadInput, "release review payload");
  exactObjectKeys(payload, [
    "schema",
    "repository",
    "commit",
    "package",
    "tag",
    "workflow",
    "trust",
    "registry",
    "reviewer",
    "publisher",
    "verdict",
    "openReachableInScopeBlockers",
  ], "release review payload");
  check(
    payload.schema === RELEASE_REVIEW_PAYLOAD_SCHEMA,
    `release review payload schema must be ${RELEASE_REVIEW_PAYLOAD_SCHEMA}`,
  );
  check(payload.repository === expected.repository, "release review repository disagrees");
  check(
    exactCommit(text(payload.commit, "release review commit"), "release review commit") ===
      expected.commit,
    "release review commit disagrees",
  );
  const reviewedPackage = record(payload.package, "release review package");
  exactObjectKeys(reviewedPackage, ["name", "version"], "release review package");
  check(
    reviewedPackage.name === expected.packageName,
    "release review package name disagrees",
  );
  check(
    reviewedPackage.version === expected.version,
    "release review package version disagrees",
  );
  check(payload.tag === expected.tag, "release review tag disagrees");
  const workflow = record(payload.workflow, "release review workflow");
  exactObjectKeys(workflow, ["path", "revision"], "release review workflow");
  check(workflow.path === expected.workflow, "release review workflow path disagrees");
  check(
    exactCommit(
      text(workflow.revision, "release review workflow revision"),
      "release review workflow revision",
    ) === expected.workflowRevision,
    "release review workflow revision disagrees",
  );
  const reviewedTrust = record(payload.trust, "release review trust binding");
  exactObjectKeys(reviewedTrust, ["path", "revision"], "release review trust binding");
  check(reviewedTrust.path === expected.trustPath, "release review trust path disagrees");
  check(
    exactCommit(
      text(reviewedTrust.revision, "release review trust revision"),
      "release review trust revision",
    ) === expected.trustRevision,
    "release review trust revision disagrees",
  );
  check(payload.registry === expected.registry, "release review registry disagrees");
  const reviewer = record(payload.reviewer, "release reviewer");
  exactObjectKeys(reviewer, ["type", "agent", "id"], "release reviewer");
  check(reviewer.type === "coding-agent", "release reviewer must be a coding-agent");
  const publisher = record(payload.publisher, "release publisher");
  exactObjectKeys(publisher, ["type", "agent"], "release publisher");
  check(publisher.type === "coding-agent", "release publisher must be a coding-agent");
  check(
    reviewer.agent !== publisher.agent,
    "release review must be independent from the publishing agent",
  );
  check(reviewer.agent === expected.reviewerAgent, "release reviewer agent disagrees");
  check(reviewer.id === expected.reviewerAgentId, "release reviewer id disagrees");
  check(publisher.agent === expected.publisherAgent, "release publisher agent disagrees");
  check(payload.verdict === "GO", "release review verdict must be GO");
  const blockers = record(
    payload.openReachableInScopeBlockers,
    "release review open reachable in-scope blockers",
  );
  exactObjectKeys(
    blockers,
    ["p0", "p1"],
    "release review open reachable in-scope blockers",
  );
  check(
    integer(blockers.p0, "release review open P0 blockers") === 0 &&
      integer(blockers.p1, "release review open P1 blockers") === 0,
    "release review must have zero open reachable in-scope P0/P1 blockers",
  );
}

export async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    check(Number.isSafeInteger(length) && length >= 0, "response has an invalid content-length");
    check(length <= maxBytes, `response exceeds ${maxBytes} bytes`);
  }
  check(response.body, "response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks, total);
}

async function fetchLimited(
  url: URL,
  maxBytes: number,
  headers: Record<string, string> = {},
  fetcher: OriginPackumentFetcher = (input, init) => fetch(input, init),
): Promise<Buffer> {
  const response = await fetcher(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  check(response.ok, `GET ${url.origin}${url.pathname} returned ${response.status}`);
  return readLimited(response, maxBytes);
}

async function fetchJson(
  url: URL,
  maxBytes = MAX_JSON_BYTES,
  headers: Record<string, string> = {},
  fetcher?: OriginPackumentFetcher,
): Promise<unknown> {
  const bytes = await fetchLimited(
    url,
    maxBytes,
    { accept: "application/json", ...headers },
    fetcher,
  );
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

function githubUrl(path: string): URL {
  const url = new URL(path, GITHUB_API);
  check(url.origin === GITHUB_API, "unsafe GitHub API URL");
  return url;
}

export interface ResolvedReleaseReviewTrust {
  trust: ReleaseReviewTrust;
  trustRevision: string;
}

function committedFile(root: string, commit: string, path: string): Buffer {
  exactCommit(commit, "release review trust commit");
  return Buffer.from(run("git", ["show", `${commit}:${path}`], root));
}

function committedBlob(root: string, commit: string, path: string): string {
  return exactCommit(
    run("git", ["rev-parse", `${commit}:${path}`], root).trim(),
    `${path} blob revision`,
  );
}

function priorVerifiedReleaseVersion(input: unknown, currentVersion: string): string {
  check(valid(currentVersion) === currentVersion, "release version must be exact SemVer");
  const metadata = record(input, "registry package metadata");
  const versions = record(metadata.versions, "registry versions");
  const tags = record(metadata["dist-tags"], "registry dist-tags");
  const prior = text(tags.latest, "prior verified release latest dist-tag");
  check(
    valid(prior) === prior && compare(prior, currentVersion) < 0 && prior in versions,
    `no prior promoted @hasna/accounts release exists before ${currentVersion}`,
  );
  return prior;
}

async function readPriorPublishedReleaseTrust(
  manifest: Manifest,
  fetcher?: OriginPackumentFetcher,
): Promise<PriorReleaseReviewTrust> {
  const packageMetadata = await fetchJson(
    packageUrl(manifest.name),
    MAX_JSON_BYTES,
    {},
    fetcher,
  );
  const version = priorVerifiedReleaseVersion(packageMetadata, manifest.version);
  const versionMetadata = record(
    await fetchJson(packageUrl(manifest.name, version), MAX_JSON_BYTES, {}, fetcher),
    "prior release registry metadata",
  );
  check(
    versionMetadata.name === manifest.name && versionMetadata.version === version,
    "prior release registry identity disagrees",
  );
  exactCommit(text(versionMetadata.gitHead, "prior release gitHead"), "prior release gitHead");
  const dist = record(versionMetadata.dist, "prior release registry dist");
  const integrity = text(dist.integrity, "prior release registry integrity");
  check(integrity.startsWith("sha512-"), "prior release registry integrity must be sha512");
  const attestations = record(dist.attestations, "prior release registry attestations");
  check(
    record(attestations.provenance, "prior release registry provenance").predicateType ===
      PROVENANCE_PREDICATE,
    "prior release does not advertise verified SLSA provenance",
  );
  const tarballUrl = safeRegistryUrl(
    dist.tarball,
    "prior release tarball URL",
    `/${manifest.name}/-/`,
  );
  const tarballBytes = await fetchLimited(tarballUrl, MAX_TARBALL_BYTES, {}, fetcher);
  check(
    `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}` === integrity,
    "prior release tarball bytes disagree with immutable registry integrity",
  );
  const archive = parseArchive(tarballBytes);
  check(
    archive.releaseReviewTrust,
    `prior release ${manifest.name}@${version} is missing ${RELEASE_REVIEW_TRUST_PATH}`,
  );
  return { version, trustBytes: archive.releaseReviewTrust };
}

export async function resolveReleaseReviewTrust(
  root: string,
  manifest: Manifest,
  commit: string,
  fetcher?: OriginPackumentFetcher,
): Promise<ResolvedReleaseReviewTrust> {
  const trustBytes = committedFile(root, commit, RELEASE_REVIEW_TRUST_PATH);
  const parsed = parseReleaseReviewTrust(trustBytes);
  const prior = parsed.generation === 1 && manifest.version === RELEASE_REVIEW_BOOTSTRAP_VERSION
    ? undefined
    : await readPriorPublishedReleaseTrust(manifest, fetcher);
  return {
    trust: verifyReleaseReviewTrustChain(trustBytes, manifest.version, prior),
    trustRevision: committedBlob(root, commit, RELEASE_REVIEW_TRUST_PATH),
  };
}

async function assertLiveReleaseControls(
  root: string,
  manifest: Manifest,
  env: NodeJS.ProcessEnv,
  authorization: ReleaseGitAuthorization,
): Promise<void> {
  const repository = repositorySlug(manifest);
  check(env.GITHUB_REPOSITORY === repository, "ruleset repository disagrees with package metadata");
  const commit = text(env.GITHUB_SHA, "GITHUB_SHA");
  const resolvedTrust = await resolveReleaseReviewTrust(root, manifest, commit);
  const token = text(env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const administrationToken = text(
    env.RELEASE_GITHUB_ADMIN_TOKEN,
    "RELEASE_GITHUB_ADMIN_TOKEN",
  );
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": GITHUB_API_VERSION,
  };
  const administrationHeaders = {
    ...headers,
    authorization: `Bearer ${administrationToken}`,
  };
  const actorName = encodeURIComponent(text(env.GITHUB_ACTOR, "GITHUB_ACTOR"));
  const [
    summaries,
    environment,
    policies,
    actorPermission,
    administrationScope,
    releaseReviewComment,
  ] = await Promise.all([
    fetchJson(
      githubUrl(`/repos/${repository}/rulesets?includes_parents=true&targets=tag&per_page=100`),
      MAX_JSON_BYTES,
      administrationHeaders,
    ),
    fetchJson(
      githubUrl(`/repos/${repository}/environments/${RELEASE_ENVIRONMENT}`),
      MAX_JSON_BYTES,
      headers,
    ),
    fetchJson(
      githubUrl(
        `/repos/${repository}/environments/${RELEASE_ENVIRONMENT}/deployment-branch-policies?per_page=100`,
      ),
      MAX_JSON_BYTES,
      headers,
    ),
    fetchJson(
      githubUrl(`/repos/${repository}/collaborators/${actorName}/permission`),
      MAX_JSON_BYTES,
      headers,
    ),
    fetchJson(
      githubUrl("/installation/repositories?per_page=100"),
      MAX_JSON_BYTES,
      administrationHeaders,
    ),
    fetchJson(
      githubUrl(`/repos/${repository}/comments/${authorization.reviewCommentId}`),
      MAX_JSON_BYTES,
      headers,
    ),
  ]);
  check(Array.isArray(summaries), "GitHub rulesets response must be an array");
  const details = await Promise.all(summaries.map(async (entry, index) => {
    const summary = record(entry, `ruleset summary ${index}`);
    const id = integer(summary.id, `ruleset summary ${index} id`);
    return fetchJson(
      githubUrl(`/repos/${repository}/rulesets/${id}`),
      MAX_JSON_BYTES,
      administrationHeaders,
    );
  }));
  const ruleset = verifyReleaseRulesets(details);
  verifyReleaseEnvironment(
    environment,
    policies,
    actorPermission,
    administrationScope,
    repository,
  );
  verifyReleaseReviewReceipt(
    releaseReviewComment,
    {
      commentId: authorization.reviewCommentId,
      repository,
      commit,
      packageName: manifest.name,
      version: manifest.version,
      tag: releaseTag(manifest),
      workflow: RELEASE_WORKFLOW,
      workflowRevision: authorization.workflowRevision,
      trustPath: RELEASE_REVIEW_TRUST_PATH,
      trustRevision: resolvedTrust.trustRevision,
      registry: REGISTRY,
      reviewerAgent: resolvedTrust.trust.reviewer.agent,
      reviewerAgentId: resolvedTrust.trust.reviewer.id,
      publisherAgent: authorization.publisherAgent,
    },
    resolvedTrust.trust,
  );
  console.log(`verified active release tag ruleset ${ruleset.name} (${ruleset.id})`);
  console.log(`verified administration credential scoped to ${repository} alone`);
  console.log(`verified protected ${RELEASE_ENVIRONMENT} environment with zero human reviewers`);
  console.log(
    `verified independent agent release review receipt comment ${authorization.reviewCommentId}`,
  );
}

function candidateFrom(
  manifest: Manifest,
  pack: PackResult,
  commit: string,
  artifactPath: string,
): ReleaseCandidate {
  check(pack.name === manifest.name && pack.version === manifest.version, "pack metadata disagrees with package.json");
  const unpackedBytes = pack.files.reduce((sum, file) => sum + file.size, 0);
  check(
    Number.isSafeInteger(unpackedBytes) && unpackedBytes <= MAX_ARCHIVE_UNPACKED_BYTES,
    "pack unpacked size exceeds the release limit",
  );
  return {
    schema: "hasna.accounts.release-candidate/v3",
    name: manifest.name,
    version: manifest.version,
    tag: releaseTag(manifest),
    commit,
    repository: repositorySlug(manifest),
    workflow: RELEASE_WORKFLOW,
    integrity: pack.integrity,
    shasum: pack.shasum,
    filename: pack.filename,
    size: pack.size,
    fileCount: pack.files.length,
    unpackedBytes,
    artifactPath,
    stagingTag: stagingDistTag(manifest.version),
    intendedTag: intendedDistTag(manifest),
  };
}

function loadCandidate(path: string): ReleaseCandidate {
  const value = record(JSON.parse(readFileSync(path, "utf8")), "release candidate");
  check(value.schema === "hasna.accounts.release-candidate/v3", "unsupported candidate schema");
  const artifactPath = text(value.artifactPath, "candidate artifact path");
  check(isAbsolute(artifactPath), "candidate artifact path must be absolute");
  const result: ReleaseCandidate = {
    schema: "hasna.accounts.release-candidate/v3",
    name: text(value.name, "candidate name"),
    version: text(value.version, "candidate version"),
    tag: text(value.tag, "candidate tag"),
    commit: text(value.commit, "candidate commit"),
    repository: text(value.repository, "candidate repository"),
    workflow: RELEASE_WORKFLOW,
    integrity: text(value.integrity, "candidate integrity"),
    shasum: text(value.shasum, "candidate shasum"),
    filename: text(value.filename, "candidate filename"),
    size: integer(value.size, "candidate size"),
    fileCount: integer(value.fileCount, "candidate file count"),
    unpackedBytes: integer(value.unpackedBytes, "candidate unpacked bytes"),
    artifactPath,
    stagingTag: assertDistTag(text(value.stagingTag, "candidate staging tag"), "candidate staging tag"),
    intendedTag: assertDistTag(text(value.intendedTag, "candidate intended tag"), "candidate intended tag"),
  };
  check(result.commit.match(/^[0-9a-f]{40}$/), "candidate commit must be a full SHA");
  check(
    result.size > 0 &&
      result.fileCount > 0 &&
      result.fileCount <= MAX_ARCHIVE_ENTRIES &&
      result.unpackedBytes > 0 &&
      result.unpackedBytes <= MAX_ARCHIVE_UNPACKED_BYTES,
    "candidate artifact metadata must be nonempty and within archive limits",
  );
  return result;
}

function assertCandidateContext(
  value: ReleaseCandidate,
  manifest: Manifest,
  env: NodeJS.ProcessEnv,
): void {
  const expected = {
    name: manifest.name,
    version: manifest.version,
    tag: releaseTag(manifest),
    commit: text(env.GITHUB_SHA, "GITHUB_SHA"),
    repository: repositorySlug(manifest),
    workflow: RELEASE_WORKFLOW,
    stagingTag: stagingDistTag(manifest.version),
    intendedTag: intendedDistTag(manifest),
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    check(value[key as keyof ReleaseCandidate] === expectedValue, `candidate ${key} disagrees with release context`);
  }
}

function verifyCandidateArtifact(value: ReleaseCandidate): Buffer {
  const stat = lstatSync(value.artifactPath);
  check(stat.isFile() && !stat.isSymbolicLink(), "candidate artifact must be a regular non-symlink file");
  check(stat.size === value.size, "candidate artifact size changed after verification");
  check(stat.size <= MAX_TARBALL_BYTES, `candidate artifact exceeds ${MAX_TARBALL_BYTES} bytes`);
  const bytes = readFileSync(value.artifactPath);
  check(
    createHash("sha1").update(bytes).digest("hex") === value.shasum &&
      `sha512-${createHash("sha512").update(bytes).digest("base64")}` === value.integrity,
    "candidate artifact bytes changed after verification",
  );
  const archive = parseArchive(bytes);
  check(
    archive.summary.fileCount === value.fileCount,
    "candidate archive file count changed after verification",
  );
  check(
    archive.summary.unpackedBytes === value.unpackedBytes,
    "candidate archive unpacked bytes changed after verification",
  );
  verifyPackedManifest(archive, value);
  return bytes;
}

function packageUrl(name: string, version = ""): URL {
  return new URL(`${REGISTRY}/${encodeURIComponent(name)}${version ? `/${encodeURIComponent(version)}` : ""}`);
}

export function originIntentPackumentUrl(input: URL, nonce: string): URL {
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(input.pathname);
  } catch {
    throw new Error("origin-intent packument URL has malformed encoding");
  }
  const segments = decodedPath.split("/").filter(Boolean);
  const packageSegment = /^[a-z0-9][a-z0-9._~-]*$/;
  const isUnscoped = segments.length === 1 && packageSegment.test(segments[0]!);
  const isScoped = segments.length === 2 &&
    segments[0]!.startsWith("@") &&
    packageSegment.test(segments[0]!.slice(1)) &&
    packageSegment.test(segments[1]!);
  check(
    input.origin === REGISTRY &&
      !input.username &&
      !input.password &&
      !input.hash &&
      (isUnscoped || isScoped),
    "origin-intent packument URL must target full npm package metadata",
  );
  check(
    ![...input.searchParams.keys()].some((key) =>
      /auth|credential|password|secret|token/i.test(key)
    ),
    "origin-intent packument URL must not contain credential query parameters",
  );
  check(
    /^[A-Za-z0-9._~-]{1,128}$/.test(nonce),
    "origin read nonce must be 1-128 URL-safe non-secret characters",
  );
  const url = new URL(input);
  url.searchParams.set("write", "true");
  url.searchParams.set("_hasna_origin_read", nonce);
  return url;
}

export function createOriginPackumentReader(
  name: string,
  options: OriginPackumentReaderOptions = {},
): () => Promise<unknown> {
  const nonce = options.nonce ?? randomUUID;
  const fetcher = options.fetcher;
  const base = packageUrl(name);
  const observedNonces = new Set<string>();
  return async () => {
    const nextNonce = nonce();
    check(!observedNonces.has(nextNonce), "origin read nonce was reused");
    observedNonces.add(nextNonce);
    return fetchJson(
      originIntentPackumentUrl(base, nextNonce),
      MAX_JSON_BYTES,
      {},
      fetcher,
    );
  };
}

export interface InstallVisibilityOperations {
  readInstallPackument: () => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/**
 * Reads the abbreviated packument — the document npm's install resolver reads,
 * and the one this file otherwise never touches.
 *
 * Deliberately NOT nonce-busted, unlike `createOriginPackumentReader`. The point
 * of this read is to observe the shared cache entry npm itself will be served,
 * so a unique URL would answer a question nobody asked.
 *
 * What makes that safe is NOT that the read leaves the edge untouched. A probe
 * against a URL the CDN is not already holding populates it — the same mechanism
 * `waitForInstallVisibility` documents below, where a premature read of the
 * attestations endpoint installs a negative entry and every retry inside the next
 * minute reads back its own 404. Two other things make it safe. By the time this
 * read is issued the version provably exists, because `verifyRegistryReleaseAttempt`
 * has already read its version metadata and re-hashed its downloaded tarball, so
 * what a miss can install here is a 200 the CDN was going to hold anyway rather
 * than that negative entry. And nothing acts on a stale hit:
 * `waitForInstallVisibility` returns only once the document it observes lists the
 * version, and otherwise fails the release rather than proceeding.
 */
export function createInstallPackumentReader(
  name: string,
  fetcher?: OriginPackumentFetcher,
): () => Promise<unknown> {
  const url = packageUrl(name);
  return () => fetchJson(url, MAX_JSON_BYTES, { accept: NPM_INSTALL_ACCEPT }, fetcher);
}

export function packumentListsVersion(input: unknown, version: string): boolean {
  const versions = record(
    record(input, "registry packument").versions,
    "registry packument versions",
  );
  return Object.prototype.hasOwnProperty.call(versions, version);
}

/**
 * Blocks until npm's install resolver can see this version, before any npm
 * command is run against the registry.
 *
 * A publish is not visible on every read path at once, and the paths do not
 * share a cache entry: the registry sends `vary: accept`, so the abbreviated
 * packument npm resolves from (`max-age=300`) is stored separately from the
 * full document `verifyRegistryMetadata` and `verifyDistTags` already checked.
 * Passing those three gates therefore says nothing about whether `npm install`
 * can resolve the version — measured on 0.2.40, which cleared registry bytes,
 * gitHead, dist-tags and attestations and then failed `npm install` with
 * ETARGET twenty-one seconds after publishing.
 *
 * Waiting here rather than retrying afterwards is the whole point, because the
 * failing reads poison themselves. The attestations endpoint answers a miss with
 * `cache-control: max-age=60` and a hit with `max-age=31557600` (measured
 * against the live registry), so a probe issued before the object is visible
 * installs a negative entry at the edge and every retry inside the next minute
 * reads back its own 404. That is why the observed lag tracked the first probe
 * rather than the publish, and why a wider retry budget cannot fix it: the
 * budget buys more of the thing that caused the failure.
 *
 * This is a condition with a timeout, not a sleep. It costs nothing once the
 * version is visible, and it is bounded so a genuine registry outage still
 * fails the release instead of hanging it.
 */
export async function waitForInstallVisibility(
  value: ReleaseCandidate,
  operations: InstallVisibilityOperations,
  timeoutMs = INSTALL_VISIBILITY_TIMEOUT_MS,
  pollMs = INSTALL_VISIBILITY_POLL_MS,
): Promise<void> {
  const deadline = operations.now() + timeoutMs;
  let lastFailure = "no read attempted";
  for (;;) {
    try {
      if (packumentListsVersion(await operations.readInstallPackument(), value.version)) return;
      lastFailure = `the abbreviated packument does not list ${value.version}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    if (operations.now() >= deadline) {
      throw new Error(
        `${value.name}@${value.version} did not become visible to npm's install resolver ` +
          `within ${timeoutMs}ms (${lastFailure})`,
      );
    }
    await operations.sleep(pollMs);
  }
}

/**
 * Decides whether this candidate may still be published, or whether the version
 * on the registry is this exact candidate from an interrupted run of the same
 * release.
 *
 * A publish consumes the version number irreversibly, so a run that published
 * and then failed a later gate could not be re-run at all: the preflight refused
 * at the first step and every subsequent step was skipped. That burned the
 * version for a fault — a read-path visibility lag on npm's attestations
 * endpoint — that had nothing to do with the artefact, and left four merged
 * fixes published but unreachable behind an unmoved `latest`.
 *
 * `"resumable"` is returned only when the published version is provably the
 * artefact in hand and nothing has been promoted from it. The proof does not
 * trust any registry-reported field: `verifyDownloadedTarball` re-downloads the
 * tarball and hashes those bytes locally (sha1 and sha512) against the integrity
 * of the artefact `verifyCandidateArtifact` just re-hashed on disk. Registry
 * metadata and dist-tags are checked too, but the byte identity is what carries
 * the decision.
 *
 * The immutability guarantee is unchanged. A version occupied by anything other
 * than this exact artefact still refuses, and now names which conjunct failed.
 * Promotion is a separate gate and is untouched: `verifyDistTags(_, _, "staged")`
 * refuses to resume once the intended tag already points at this version.
 */
export type PublicationState = "unpublished" | "resumable";

export interface PublicationStateOperations {
  readVersionMetadata: () => Promise<unknown>;
  readPackageMetadata: () => Promise<unknown>;
  readTarball: (url: URL) => Promise<Uint8Array>;
}

export async function resolvePublicationState(
  value: ReleaseCandidate,
  response: { status: number; ok: boolean },
  operations: PublicationStateOperations,
): Promise<PublicationState> {
  if (response.status === 404) return "unpublished";
  check(response.ok, `registry preflight returned ${response.status}`);
  try {
    const urls = verifyRegistryMetadata(value, await operations.readVersionMetadata());
    verifyDownloadedTarball(value, await operations.readTarball(urls.tarballUrl));
    verifyDistTags(value, await operations.readPackageMetadata(), "staged");
  } catch (error) {
    throw new Error(
      `${value.name}@${value.version} already exists and is not this candidate ` +
        `staged for release; versions are immutable (${
          error instanceof Error ? error.message : String(error)
        })`,
    );
  }
  return "resumable";
}

async function ensurePublishable(value: ReleaseCandidate): Promise<PublicationState> {
  const response = await fetch(packageUrl(value.name, value.version), {
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const readPackageMetadata = createOriginPackumentReader(value.name);
  const state = await resolvePublicationState(value, response, {
    readVersionMetadata: () => fetchJson(packageUrl(value.name, value.version)),
    readPackageMetadata,
    readTarball: (url) => fetchLimited(url, MAX_TARBALL_BYTES),
  });
  console.log(
    state === "unpublished"
      ? `${value.name}@${value.version} is not published`
      : `${value.name}@${value.version} is already published as this exact candidate ` +
        `under ${value.stagingTag} and ${value.intendedTag} was not promoted from it; resuming`,
  );
  return state;
}

function safeRegistryUrl(value: unknown, label: string, prefix: string): URL {
  const url = new URL(text(value, label));
  check(
    url.origin === REGISTRY &&
      url.pathname.startsWith(prefix) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    `unsafe ${label}`,
  );
  return url;
}

export function verifyRegistryMetadata(
  value: ReleaseCandidate,
  input: unknown,
): { tarballUrl: URL } {
  const metadata = record(input, "registry metadata");
  check(metadata.name === value.name && metadata.version === value.version, "registry package identity disagrees");
  check(metadata.gitHead === value.commit, "registry gitHead disagrees");
  const dist = record(metadata.dist, "registry dist");
  check(dist.integrity === value.integrity && dist.shasum === value.shasum, "registry integrity disagrees");
  check(
    integer(dist.fileCount, "registry fileCount") === value.fileCount,
    "registry fileCount disagrees",
  );
  check(
    integer(dist.unpackedSize, "registry unpackedSize") === value.unpackedBytes,
    "registry unpackedSize disagrees",
  );
  const attestations = record(dist.attestations, "registry attestations");
  check(
    record(attestations.provenance, "registry provenance").predicateType === PROVENANCE_PREDICATE,
    "registry does not advertise SLSA v1 provenance",
  );
  const attestationsUrl = safeRegistryUrl(
    attestations.url,
    "attestations URL",
    "/-/npm/v1/attestations/",
  );
  check(
    decodeURIComponent(attestationsUrl.pathname) ===
      `/-/npm/v1/attestations/${value.name}@${value.version}`,
    "registry attestations URL disagrees with the package identity",
  );
  return {
    tarballUrl: safeRegistryUrl(
      dist.tarball,
      "tarball URL",
      `/${value.name}/-/`,
    ),
  };
}

function decodeBase64(value: unknown, label: string): Buffer {
  const encoded = text(value, label);
  check(encoded.length % 4 === 0 && encoded.match(/^[A-Za-z0-9+/]+={0,2}$/), `${label} is not strict base64`);
  const bytes = Buffer.from(encoded, "base64");
  check(bytes.toString("base64") === encoded, `${label} is not canonical base64`);
  check(bytes.length <= MAX_JSON_BYTES, `${label} exceeds ${MAX_JSON_BYTES} decoded bytes`);
  return bytes;
}

function integrityHex(integrity: string): string {
  const match = integrity.match(/^sha512-([A-Za-z0-9+/]+={0,2})$/);
  check(match?.[1], "candidate integrity is not sha512");
  return decodeBase64(match[1], "candidate integrity").toString("hex");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function expectedSigstoreIdentity(
  value: Pick<ReleaseCandidate, "repository" | "workflow" | "tag">,
): Pick<SigstoreVerifyOptions, "certificateIdentityURI" | "certificateIssuer"> {
  const identity =
    `https://github.com/${value.repository}/${value.workflow}@refs/tags/${value.tag}`;
  return {
    certificateIdentityURI: `^${escapeRegex(identity)}$`,
    certificateIssuer: SIGSTORE_OIDC_ISSUER,
  };
}

async function verifySigstoreWithPinnedNode(
  bundle: SigstoreBundle,
  options?: SigstoreVerifyOptions,
): Promise<void> {
  const root = resolve(process.cwd());
  run("node", [join(root, "scripts", "verify-sigstore.mjs")], root, {
    timeoutMs: 60_000,
    input: JSON.stringify({ bundle, options }),
  });
}

export async function verifySigstoreBundle(
  value: ReleaseCandidate,
  input: unknown,
  verifier: SigstoreVerifier = verifySigstoreWithPinnedNode,
): Promise<void> {
  const bundle = record(input, "Sigstore provenance bundle");
  check(
    bundle.mediaType === "application/vnd.dev.sigstore.bundle.v0.3+json",
    "provenance must use a Sigstore v0.3 bundle",
  );
  const material = record(bundle.verificationMaterial, "Sigstore verification material");
  check(material.certificate, "Sigstore provenance bundle must contain a Fulcio certificate");
  await verifier(bundle as unknown as SigstoreBundle, {
    ...expectedSigstoreIdentity(value),
    ctLogThreshold: 1,
    tlogThreshold: 1,
  });
}

export async function verifyProvenanceBundleCryptographically(
  value: ReleaseCandidate,
  input: unknown,
  verifier: SigstoreVerifier = verifySigstoreWithPinnedNode,
): Promise<void> {
  check(Array.isArray(input), "npm audit did not return attestation bundles");
  const provenance = input.filter((entry) =>
    record(entry, "cryptographically verified attestation").predicateType ===
      PROVENANCE_PREDICATE
  );
  check(provenance.length === 1, "exactly one SLSA provenance bundle is required");
  await verifySigstoreBundle(
    value,
    record(provenance[0], "SLSA provenance attestation").bundle,
    verifier,
  );
}

function positiveIntegerStringOrNumber(value: unknown, label: string): bigint {
  const encoded = typeof value === "number" ? String(value) : value;
  check(
    typeof encoded === "string" && encoded.match(/^[1-9]\d*$/),
    `${label} must be a positive integer`,
  );
  return BigInt(encoded);
}

function auditedStatement(item: unknown, value: ReleaseCandidate): RecordValue {
  const attestation = record(item, "cryptographically verified attestation");
  const predicateType = text(attestation.predicateType, "predicate type");
  const bundle = record(attestation.bundle, "Sigstore bundle");
  const envelope = record(bundle.dsseEnvelope, "DSSE envelope");
  check(Array.isArray(envelope.signatures) && envelope.signatures.length > 0, "unsigned DSSE bundle is forbidden");
  check(
    envelope.payloadType === DSSE_IN_TOTO_PAYLOAD_TYPE,
    `DSSE payloadType must be exactly ${DSSE_IN_TOTO_PAYLOAD_TYPE}`,
  );
  const material = record(bundle.verificationMaterial, "Sigstore verification material");
  check(
    Array.isArray(material.tlogEntries) && material.tlogEntries.length === 1,
    "exactly one Sigstore transparency-log entry is required",
  );
  const tlog = record(material.tlogEntries[0], "Sigstore transparency-log entry");
  positiveIntegerStringOrNumber(tlog.logIndex, "Sigstore logIndex");
  positiveIntegerStringOrNumber(tlog.integratedTime, "Sigstore integratedTime");
  const decoded = record(
    JSON.parse(decodeBase64(envelope.payload, "DSSE payload").toString("utf8")),
    "in-toto statement",
  );
  const requiredStatementType = REQUIRED_STATEMENT_TYPE.get(predicateType);
  check(
    requiredStatementType !== undefined,
    `unrecognised attestation predicate type ${predicateType}`,
  );
  check(
    decoded._type === requiredStatementType,
    `in-toto statement type for ${predicateType} must be exactly ${requiredStatementType}`,
  );
  check(decoded.predicateType === predicateType, "attestation predicate types disagree");
  const subjects = decoded.subject;
  check(Array.isArray(subjects) && subjects.length === 1, "attestation must have one subject");
  const subject = record(subjects[0], "attestation subject");
  check(
    subject.name === packagePurl(value.name, value.version) &&
      record(subject.digest, "subject digest").sha512 === integrityHex(value.integrity),
    "attestation subject disagrees with the package digest",
  );
  return decoded;
}

export function verifyAttestations(value: ReleaseCandidate, input: unknown): void {
  check(Array.isArray(input), "npm audit did not return cryptographically verified attestation bundles");
  const statements = input.map((entry) => auditedStatement(entry, value));
  const publish = statements.filter((entry) => entry.predicateType === PUBLISH_PREDICATE);
  const provenance = statements.filter((entry) => entry.predicateType === PROVENANCE_PREDICATE);
  check(
    publish.length === 1 && provenance.length === 1,
    "exactly one npm publish and one SLSA provenance attestation are required",
  );
  const published = record(publish[0]!.predicate, "publish predicate");
  check(
    published.name === value.name && published.version === value.version && published.registry === REGISTRY,
    "publish attestation disagrees",
  );
  const build = record(
    record(provenance[0]!.predicate, "provenance predicate").buildDefinition,
    "build definition",
  );
  const workflow = record(
    record(record(build.externalParameters, "external parameters").workflow, "workflow"),
    "workflow",
  );
  check(
    workflow.repository === `https://github.com/${value.repository}` &&
      workflow.path === value.workflow && workflow.ref === `refs/tags/${value.tag}`,
    "provenance workflow, repository, or tag disagrees",
  );
  check(
    Array.isArray(build.resolvedDependencies) && build.resolvedDependencies.some((entry) => {
      const dependency = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as RecordValue : {};
      const digest = dependency.digest && typeof dependency.digest === "object" &&
        !Array.isArray(dependency.digest) ? dependency.digest as RecordValue : {};
      return digest.gitCommit === value.commit;
    }),
    "provenance does not bind the release commit",
  );
}

export function verifyDownloadedTarball(value: ReleaseCandidate, bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes);
  check(buffer.length === value.size, "downloaded registry tarball size differs from the reviewed pack");
  check(buffer.length <= MAX_TARBALL_BYTES, `downloaded tarball exceeds ${MAX_TARBALL_BYTES} bytes`);
  check(
    createHash("sha1").update(buffer).digest("hex") === value.shasum &&
      `sha512-${createHash("sha512").update(buffer).digest("base64")}` === value.integrity,
    "downloaded registry tarball differs from the reviewed pack",
  );
  const archive = parseArchive(buffer);
  check(archive.summary.fileCount === value.fileCount, "downloaded archive file count differs");
  check(
    archive.summary.unpackedBytes === value.unpackedBytes,
    "downloaded archive unpacked bytes differ",
  );
  verifyPackedManifest(archive, value);
}

export function verifyDistTags(
  value: ReleaseCandidate,
  input: unknown,
  phase: RegistryPhase,
): void {
  const tags = record(record(input, "registry package metadata")["dist-tags"], "registry dist-tags");
  check(tags[value.stagingTag] === value.version, `${value.stagingTag} does not point to ${value.version}`);
  if (phase === "staged") {
    check(
      tags[value.intendedTag] !== value.version,
      `${value.intendedTag} was promoted before registry verification completed`,
    );
  } else {
    check(
      tags[value.intendedTag] === value.version,
      `${value.intendedTag} does not agree with ${value.stagingTag}`,
    );
  }
}

export function assertPromotionVersion(
  candidateVersion: string,
  currentLatest: string | undefined,
): "advance" | "idempotent" {
  check(valid(candidateVersion) !== null, `candidate ${candidateVersion} is not valid SemVer`);
  check(
    prerelease(candidateVersion) === null,
    `refusing prerelease ${candidateVersion} promotion to latest`,
  );
  if (currentLatest === undefined) return "advance";
  check(
    valid(currentLatest) !== null,
    `registry latest ${currentLatest} is not valid SemVer`,
  );
  if (candidateVersion === currentLatest) return "idempotent";
  const precedence = compare(candidateVersion, currentLatest);
  check(
    precedence !== 0,
    `${candidateVersion} does not advance semantic precedence over registry latest ${currentLatest}`,
  );
  check(
    precedence > 0,
    `refusing stale or downgrade promotion of ${candidateVersion} over registry latest ${currentLatest}`,
  );
  return "advance";
}

export function assertPromotionSnapshotUnchanged(
  expectedLatest: string | undefined,
  immediateLatest: string | undefined,
): void {
  check(
    expectedLatest === immediateLatest,
    "registry latest changed immediately before promotion; expected " +
      `${expectedLatest ?? "<absent>"}, received ${immediateLatest ?? "<absent>"}`,
  );
}

export function assertFinalPromotionVersion(
  candidateVersion: string,
  currentLatest: string | undefined,
): void {
  check(
    assertPromotionVersion(candidateVersion, currentLatest) === "idempotent",
    `registry latest changed during promotion; expected ${candidateVersion}, received ` +
      `${currentLatest ?? "<absent>"}`,
  );
}

function compareRegistryVersions(left: string, right: string): number {
  return compare(left, right) || left.localeCompare(right);
}

function isCanonicalRegistryVersion(version: string): boolean {
  return valid(version) !== null &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
      .test(version);
}

export function registryPromotionSnapshot(input: unknown): RegistryPromotionSnapshot {
  const metadata = record(input, "registry package metadata");
  const packageName = text(metadata.name, "registry package name");
  const tags = record(metadata["dist-tags"], "registry dist-tags");
  const versionsRecord = record(metadata.versions, "registry versions");
  const versions = Object.keys(versionsRecord);
  for (const version of versions) {
    check(isCanonicalRegistryVersion(version), `registry version ${version} is not canonical SemVer`);
    const manifest = record(versionsRecord[version], `registry version ${version}`);
    check(
      manifest.name === packageName,
      `registry version ${version} package identity disagrees`,
    );
    check(
      manifest.version === version,
      `registry version ${version} manifest identity disagrees`,
    );
  }
  versions.sort(compareRegistryVersions);

  const distTags = Object.entries(tags).map(([name, value]) => {
    check(typeof value === "string", `registry dist-tag ${name} must be a string`);
    check(
      isCanonicalRegistryVersion(value),
      `registry dist-tag ${name} target ${value} is not canonical SemVer`,
    );
    check(
      versions.includes(value),
      `registry dist-tag ${name} target ${value} is absent from registry versions`,
    );
    return [name, value] as [string, string];
  }).sort(([left], [right]) => left.localeCompare(right));

  const latest = distTags.find(([name]) => name === "latest")?.[1];
  if (latest !== undefined) {
    check(prerelease(latest) === null, `registry latest ${latest} must not be a prerelease`);
  }

  const stableVersions = versions.filter((version) => prerelease(version) === null);
  let highestStable: string | undefined;
  for (const version of stableVersions) {
    if (highestStable === undefined || compare(version, highestStable) > 0) {
      highestStable = version;
    }
  }
  if (highestStable !== undefined) {
    const equivalentHighest = stableVersions.filter(
      (version) => compare(version, highestStable!) === 0,
    );
    check(
      equivalentHighest.length === 1,
      `ambiguous highest stable versions ${equivalentHighest.join(", ")}`,
    );
  }
  return { latest, versions, distTags, highestStable };
}

function promotionSnapshotEqual(
  left: RegistryPromotionSnapshot,
  right: RegistryPromotionSnapshot,
): boolean {
  return left.latest === right.latest &&
    left.highestStable === right.highestStable &&
    left.versions.length === right.versions.length &&
    left.versions.every((version, index) => version === right.versions[index]) &&
    left.distTags.length === right.distTags.length &&
    left.distTags.every(([name, version], index) =>
      name === right.distTags[index]?.[0] && version === right.distTags[index]?.[1]
    );
}

function candidatePromotionState(
  value: ReleaseCandidate,
  snapshot: RegistryPromotionSnapshot,
): "advance" | "idempotent" | "superseded" {
  check(valid(value.version) !== null, `candidate ${value.version} is not valid SemVer`);
  check(
    prerelease(value.version) === null,
    `refusing prerelease ${value.version} promotion to latest`,
  );
  check(
    snapshot.versions.includes(value.version),
    `candidate ${value.version} is absent from registry versions`,
  );
  const highest = snapshot.highestStable;
  check(highest !== undefined, "registry has no stable version");
  const highestComparison = compare(value.version, highest);
  if (highestComparison < 0) return "superseded";
  check(
    highestComparison !== 0 || highest === value.version,
    `${value.version} has ambiguous semantic precedence with registry version ${highest}`,
  );
  if (snapshot.latest === undefined) return "advance";
  if (snapshot.latest === value.version) return "idempotent";
  const latestComparison = compare(value.version, snapshot.latest);
  if (latestComparison < 0) return "superseded";
  check(
    latestComparison !== 0,
    `${value.version} does not advance semantic precedence over registry latest ${snapshot.latest}`,
  );
  return "advance";
}

function candidateStagingTag(value: ReleaseCandidate, input: unknown): void {
  const tags = record(record(input, "registry package metadata")["dist-tags"], "registry dist-tags");
  check(
    tags[value.stagingTag] === value.version,
    `${value.stagingTag} does not point to ${value.version}`,
  );
}

function promotionSnapshotForCandidate(
  value: ReleaseCandidate,
  input: unknown,
): RegistryPromotionSnapshot {
  const metadata = record(input, "registry package metadata");
  check(metadata.name === value.name, `registry package identity must be ${value.name}`);
  candidateStagingTag(value, metadata);
  return registryPromotionSnapshot(metadata);
}

async function readPromotionSnapshot(
  value: ReleaseCandidate,
  registry: PromotionRegistry,
): Promise<RegistryPromotionSnapshot> {
  return promotionSnapshotForCandidate(value, await registry.readPackage());
}

export function assertFinalMonotonicPromotion(
  value: ReleaseCandidate,
  input: unknown,
): void {
  const snapshot = promotionSnapshotForCandidate(value, input);
  assertFinalMonotonicPromotionSnapshot(value, snapshot);
}

function assertFinalMonotonicPromotionSnapshot(
  value: ReleaseCandidate,
  snapshot: RegistryPromotionSnapshot,
): void {
  check(
    candidatePromotionState(value, snapshot) === "idempotent",
    `registry is not in the final monotonic state for ${value.version}; ` +
      `latest is ${snapshot.latest ?? "<absent>"} and highest stable is ` +
      `${snapshot.highestStable ?? "<absent>"}`,
  );
}

async function failSupersededAfterCompensation(
  value: ReleaseCandidate,
  registry: PromotionRegistry,
  initial: RegistryPromotionSnapshot,
  maxCompensationAttempts: number,
): Promise<never> {
  let snapshot = initial;
  let lastMutationFailure: unknown;
  let compensationAttempts = 0;
  while (true) {
    const target = snapshot.highestStable;
    check(
      target !== undefined && compare(target, value.version) > 0,
      `candidate ${value.version} is not superseded by a newer stable version`,
    );
    if (snapshot.latest === target) {
      throw new Error(
        `candidate ${value.version} was superseded by newer stable ${target}; ` +
          `registry latest was restored to ${target}`,
      );
    }
    if (compensationAttempts === maxCompensationAttempts) {
      const detail = lastMutationFailure instanceof Error
        ? `; last dist-tag error: ${lastMutationFailure.message}`
        : "";
      throw new Error(
        `could not restore monotonic latest ${target} within ` +
          `${maxCompensationAttempts} forward-compensation ` +
          `attempt${maxCompensationAttempts === 1 ? "" : "s"}${detail}`,
      );
    }
    compensationAttempts++;
    try {
      await registry.setLatest(target);
      lastMutationFailure = undefined;
    } catch (error) {
      lastMutationFailure = error;
    }
    snapshot = await readPromotionSnapshot(value, registry);
  }
}

export async function promoteLatestMonotonically(
  value: ReleaseCandidate,
  registry: PromotionRegistry,
  maxAttempts = MAX_PROMOTION_ATTEMPTS,
): Promise<"promoted" | "idempotent"> {
  check(
    Number.isInteger(maxAttempts) && maxAttempts > 0 && maxAttempts <= 8,
    "promotion attempts must be between 1 and 8",
  );
  let expected = await readPromotionSnapshot(value, registry);
  let state = candidatePromotionState(value, expected);
  if (state === "superseded") {
    if (expected.latest === value.version) {
      return failSupersededAfterCompensation(value, registry, expected, maxAttempts);
    }
    throw new Error(
      `candidate ${value.version} was superseded before promotion by ` +
        `${expected.highestStable ?? "<unknown>"}`,
    );
  }
  if (state === "idempotent") return "idempotent";

  let lastMutationFailure: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const immediatelyBeforeMutation = await readPromotionSnapshot(value, registry);
    if (!promotionSnapshotEqual(expected, immediatelyBeforeMutation)) {
      state = candidatePromotionState(value, immediatelyBeforeMutation);
      if (state === "superseded") {
        if (immediatelyBeforeMutation.latest === value.version) {
          return failSupersededAfterCompensation(
            value,
            registry,
            immediatelyBeforeMutation,
            maxAttempts,
          );
        }
        throw new Error(
          `candidate ${value.version} was superseded before promotion by ` +
            `${immediatelyBeforeMutation.highestStable ?? "<unknown>"}`,
        );
      }
      if (state === "idempotent") return "idempotent";
      expected = immediatelyBeforeMutation;
      continue;
    }

    try {
      await registry.setLatest(value.version);
      lastMutationFailure = undefined;
    } catch (error) {
      lastMutationFailure = error;
    }

    const after = await readPromotionSnapshot(value, registry);
    state = candidatePromotionState(value, after);
    if (state === "superseded") {
      return failSupersededAfterCompensation(value, registry, after, maxAttempts);
    }
    if (after.latest === value.version) return "promoted";
    expected = after;
  }

  const failure = lastMutationFailure instanceof Error
    ? `; last dist-tag error: ${lastMutationFailure.message}`
    : "";
  throw new Error(
    `promotion did not converge within ${maxAttempts} attempts; ` +
      `last observed latest was ${expected.latest ?? "<absent>"}${failure}`,
  );
}

export function extractVerifiedAttestations(
  value: ReleaseCandidate,
  input: unknown,
): unknown[] {
  const audit = record(input, "npm audit signatures result");
  check(Array.isArray(audit.invalid) && audit.invalid.length === 0, "npm reported invalid signatures");
  check(Array.isArray(audit.missing) && audit.missing.length === 0, "npm reported missing signatures");
  check(Array.isArray(audit.verified), "npm audit signatures did not report verified packages");
  const expectedLocation = `node_modules/${value.name}`;
  const verified = audit.verified
    .map((entry, index) => record(entry, `npm verified entry ${index}`))
    .find((entry) =>
      entry.name === value.name &&
      entry.version === value.version &&
      entry.location === expectedLocation
    );
  check(verified, `npm did not cryptographically verify ${value.name}@${value.version}`);
  check(
    Array.isArray(verified.attestationBundles) && verified.attestationBundles.length > 0,
    "npm did not return the verified attestation bundles",
  );
  return verified.attestationBundles;
}

export function assertExactCliVersion(value: ReleaseCandidate, stdout: string): void {
  check(stdout.trim() === value.version, `accounts --version returned ${stdout.trim() || "<empty>"}`);
}

function verifyExactInstallAndAttestations(value: ReleaseCandidate): unknown[] {
  const root = mkdtempSync(join(tmpdir(), "accounts-consumer-"));
  // npm's cache is process-wide and outlives this function, so a retry would
  // otherwise re-read whatever the previous attempt stored — including a
  // pre-publish packument or a 404 from the attestations endpoint. Scoping the
  // cache to this root, which is created per call and deleted below, makes each
  // attempt an independent observation of the registry instead of a replay.
  const cache = join(root, ".npm-cache");
  try {
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ private: true })}\n`, { mode: 0o600 });
    run("npm", [
      "install", "--ignore-scripts", "--audit=false", "--fund=false", "--save-exact",
      "--cache", cache,
      `${value.name}@${value.version}`,
    ], root, { timeoutMs: 300_000 });
    const packageRoot = join(root, "node_modules", ...value.name.split("/"));
    const installed = record(
      JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
      "installed package",
    );
    check(installed.name === value.name && installed.version === value.version, "exact install resolved another version");
    const cliPath = join(packageRoot, "dist", "cli.js");
    const cliStat = lstatSync(cliPath);
    check(cliStat.isFile() && !cliStat.isSymbolicLink(), "installed Accounts CLI is not a regular file");
    assertExactCliVersion(value, run("node", [cliPath, "--version"], root));
    const audit = JSON.parse(run("npm", [
      "audit", "signatures", "--json", "--include-attestations",
      "--cache", cache,
    ], root, { timeoutMs: 300_000 })) as unknown;
    return extractVerifiedAttestations(value, audit);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function parseRetryOptions(attemptsInput: string, delayInput: string): {
  attempts: number;
  delayMs: number;
} {
  const attempts = Number(attemptsInput);
  const delayMs = Number(delayInput);
  check(Number.isInteger(attempts) && attempts > 0 && attempts <= 6, "attempts must be between 1 and 6");
  check(Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 10_000, "delay must be between 0 and 10000 ms");
  check((attempts - 1) * delayMs <= 60_000, "retry delay budget exceeds 60 seconds");
  return { attempts, delayMs };
}

function verifyRegistryPackageState(
  value: ReleaseCandidate,
  phase: RegistryPhase,
  input: unknown,
): void {
  const metadata = record(input, "registry package metadata");
  const snapshot = promotionSnapshotForCandidate(value, metadata);
  verifyDistTags(value, metadata, phase);
  if (phase === "promoted") {
    assertFinalMonotonicPromotionSnapshot(value, snapshot);
  }
}

export async function verifyRegistryReleaseAttempt(
  value: ReleaseCandidate,
  phase: RegistryPhase,
  operations: RegistryReleaseAttemptOperations,
): Promise<void> {
  const versionMetadata = await operations.readVersionMetadata();
  const urls = verifyRegistryMetadata(value, versionMetadata);
  verifyRegistryPackageState(value, phase, await operations.readPackageMetadata());
  verifyDownloadedTarball(value, await operations.readTarball(urls.tarballUrl));

  // Every gate above reads the full packument. npm resolves from the abbreviated
  // one, which is a separate cache entry, so the consumer install must not be
  // attempted until that entry has caught up — a premature attempt caches its
  // own failure and no retry can outlive it.
  await operations.awaitInstallVisibility();
  const auditedBundles = operations.verifyConsumer();
  await operations.verifyCryptographically(auditedBundles);
  operations.verifySemantically(auditedBundles);

  // Consumer installation, npm signature audit, and Sigstore verification are
  // intentionally slow network and process gates. Their success must not rely
  // on the package snapshot observed before they began.
  verifyRegistryPackageState(value, phase, await operations.readPackageMetadata());
}

async function verifyRegistryRelease(
  value: ReleaseCandidate,
  phase: RegistryPhase,
  attempts: number,
  delayMs: number,
): Promise<void> {
  let failure: unknown;
  const readPackageMetadata = createOriginPackumentReader(value.name);
  const readInstallPackument = createInstallPackumentReader(value.name);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await verifyRegistryReleaseAttempt(value, phase, {
        readVersionMetadata: () => fetchJson(packageUrl(value.name, value.version)),
        readPackageMetadata,
        readTarball: (url) => fetchLimited(url, MAX_TARBALL_BYTES),
        awaitInstallVisibility: () =>
          waitForInstallVisibility(value, {
            readInstallPackument,
            sleep: (ms) => Bun.sleep(ms),
            now: () => Date.now(),
          }),
        verifyConsumer: () => verifyExactInstallAndAttestations(value),
        verifyCryptographically: (bundles) =>
          verifyProvenanceBundleCryptographically(value, bundles),
        verifySemantically: (bundles) => verifyAttestations(value, bundles),
      });
      console.log(
        `verified ${value.name}@${value.version}: registry bytes, gitHead, ` +
          `cryptographic attestations, provenance semantics, ${value.stagingTag}, exact install, and CLI agree`,
      );
      return;
    } catch (error) {
      failure = error;
      if (attempt < attempts) await Bun.sleep(delayMs);
    }
  }
  throw failure;
}

async function promoteDistTag(
  root: string,
  manifest: Manifest,
  value: ReleaseCandidate,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  assertPromotionEnvironment(manifest, env, currentToolchain(root));
  assertGitContext(root, manifest, env);
  assertCandidateContext(value, manifest, env);
  verifyCandidateArtifact(value);
  const readPackage = createOriginPackumentReader(value.name);
  const result = await promoteLatestMonotonically(value, {
    readPackage,
    setLatest: async (version) => {
      run("npm", [
        "dist-tag", "add", `${value.name}@${version}`, value.intendedTag,
        "--registry", REGISTRY,
      ], root);
    },
  });
  console.log(
    result === "idempotent"
      ? `${value.name}@${value.version} was already the monotonic ${value.intendedTag}`
      : `promoted ${value.name}@${value.version} to monotonic ${value.intendedTag}`,
  );
}

export interface DirectPublishContext {
  name: string;
  version: string;
  commit: string;
  dirty: boolean;
}

/**
 * Decides whether a direct `npm publish` may proceed.
 *
 * Throws — aborting the publish — unless every break-glass condition is met.
 * On success it returns the banner the caller must print, so an emergency
 * publish is never silent.
 */
export function evaluateDirectPublish(
  env: NodeJS.ProcessEnv,
  context: DirectPublishContext,
): string[] {
  const requested = (env[BREAK_GLASS_ENV] ?? "").trim();
  check(
    requested.length > 0,
    "direct npm publish is forbidden; the release workflow must publish the preserved verified tarball. " +
      `In a genuine emergency see docs/RELEASING.md ("Break-glass direct publish") and set ${BREAK_GLASS_ENV}.`,
  );
  check(
    requested === BREAK_GLASS_TOKEN,
    `${BREAK_GLASS_ENV} must be set to exactly "${BREAK_GLASS_TOKEN}"; ` +
      "refusing an ambiguous value so this cannot be enabled by reflex",
  );
  check(
    !env.GITHUB_ACTIONS,
    `${BREAK_GLASS_ENV} is refused inside GitHub Actions; automation must publish through the verified release workflow`,
  );
  const reason = (env[BREAK_GLASS_REASON_ENV] ?? "").trim();
  check(
    reason.length >= BREAK_GLASS_MIN_REASON_LENGTH,
    `${BREAK_GLASS_REASON_ENV} must record why verification is being bypassed, ` +
      `in at least ${BREAK_GLASS_MIN_REASON_LENGTH} characters`,
  );
  check(
    !context.dirty,
    "break-glass refuses a modified, untracked, or unreadable working tree because the build reads " +
      "the filesystem, not the commit; run `git status --porcelain` and commit or remove what it " +
      "lists so the published bytes stay traceable",
  );
  return [
    "",
    "!!!  BREAK-GLASS DIRECT PUBLISH  !!!",
    `  package: ${context.name}@${context.version}`,
    `  commit:  ${context.commit}`,
    `  reason:  ${reason}`,
    "  skipped: deterministic pack verification, npm provenance attestation, Sigstore identity",
    "           policy, protected tag/ruleset preflight, and the staged-then-promoted dist-tag",
    "           quarantine that the release workflow normally enforces.",
    "  required afterwards: record this publish in the docs/RELEASING.md break-glass log and",
    "           return the next version to the release workflow.",
    "",
  ];
}

function guardDirectPublish(root: string, manifest: Manifest, env: NodeJS.ProcessEnv): void {
  // Fail closed: an unreadable git state counts as untraceable, not as clean.
  const head = runResult("git", ["rev-parse", "HEAD"], root);
  const status = runResult("git", ["status", "--porcelain"], root);
  const traceable = head.status === 0 && status.status === 0;
  for (const line of evaluateDirectPublish(env, {
    name: manifest.name,
    version: manifest.version,
    commit: traceable ? (head.stdout ?? "").trim() : "unknown",
    dirty: !traceable || (status.stdout ?? "").trim().length > 0,
  })) {
    console.error(line);
  }
}

function option(args: string[], name: string, fallback?: string): string {
  const index = args.indexOf(name);
  const value = index === -1 ? fallback : args[index + 1];
  check(value && !value.startsWith("--"), `missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const [subcommand, ...args] = process.argv.slice(2);
  const manifest = loadManifest(root);
  if (subcommand === "pack") {
    verifyDeterministicPack(root);
  } else if (subcommand === "reject-direct-publish") {
    guardDirectPublish(root, manifest, process.env);
  } else if (subcommand === "preflight") {
    assertTrustedPublishEnvironment(manifest, process.env, currentToolchain(root));
    const authorization = assertGitContext(root, manifest, process.env);
    await assertLiveReleaseControls(root, manifest, process.env, authorization);
    console.log("trusted release preflight verified");
  } else if (subcommand === "candidate") {
    assertTrustedPublishEnvironment(manifest, process.env, currentToolchain(root));
    assertGitContext(root, manifest, process.env);
    const artifactPath = resolve(option(args, "--artifact"));
    const commit = text(process.env.GITHUB_SHA, "GITHUB_SHA");
    const pack = verifyDeterministicPack(root, artifactPath, commit);
    const value = candidateFrom(
      manifest,
      pack,
      commit,
      artifactPath,
    );
    const output = resolve(option(args, "--out"));
    writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(`wrote release candidate ${output}`);
  } else if (subcommand === "ensure-unpublished") {
    const value = loadCandidate(resolve(option(args, "--candidate")));
    verifyCandidateArtifact(value);
    await ensurePublishable(value);
  } else if (subcommand === "publish-staged") {
    assertTrustedPublishEnvironment(manifest, process.env, currentToolchain(root));
    assertGitContext(root, manifest, process.env);
    const value = loadCandidate(resolve(option(args, "--candidate")));
    assertCandidateContext(value, manifest, process.env);
    verifyCandidateArtifact(value);
    // Re-resolved immediately before the mutation rather than trusting the
    // earlier step, matching how promotion re-reads its snapshot before acting.
    if (await ensurePublishable(value) === "resumable") {
      console.log(
        `skipping publish: ${value.name}@${value.version} is already the staged candidate`,
      );
    } else {
      run("npm", [
        "publish", value.artifactPath, "--ignore-scripts", "--provenance", "--access", "public",
        "--tag", value.stagingTag, "--registry", REGISTRY,
      ], root, { inherit: true, timeoutMs: 300_000 });
    }
  } else if (subcommand === "verify-registry") {
    const value = loadCandidate(resolve(option(args, "--candidate")));
    verifyCandidateArtifact(value);
    const retry = parseRetryOptions(
      option(args, "--attempts", "4"),
      option(args, "--delay-ms", "5000"),
    );
    const phase = option(args, "--phase", "staged");
    check(phase === "staged" || phase === "promoted", "phase must be staged or promoted");
    await verifyRegistryRelease(value, phase, retry.attempts, retry.delayMs);
  } else if (subcommand === "promote") {
    await promoteDistTag(
      root,
      manifest,
      loadCandidate(resolve(option(args, "--candidate"))),
      process.env,
    );
  } else {
    throw new Error(
      "usage: release-provenance.ts pack | reject-direct-publish | preflight | " +
        "candidate --out FILE --artifact FILE | ensure-unpublished --candidate FILE | " +
        "publish-staged --candidate FILE | verify-registry --candidate FILE " +
        "[--phase staged|promoted] | promote --candidate FILE",
    );
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`release provenance failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
