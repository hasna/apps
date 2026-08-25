import applyReleasePlan from "@changesets/apply-release-plan";
import assembleReleasePlan from "@changesets/assemble-release-plan";
import { read as readChangesetsConfig } from "@changesets/config";
import { readPreState } from "@changesets/pre";
import getChangesets from "@changesets/read";
import type {
  ComprehensiveRelease,
  Config,
  NewChangeset,
  ReleasePlan,
} from "@changesets/types";
import { getPackages, type Packages } from "@manypkg/get-packages";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

export type SelectiveChangesetMode = "dry-run" | "apply";

export type SelectiveChangesetErrorCode =
  | "INVALID_SELECTION"
  | "CHANGESET_NOT_FOUND"
  | "PACKAGE_NOT_FOUND"
  | "SELECTION_OUTSIDE_ALLOWLIST"
  | "CLOSURE_OUTSIDE_ALLOWLIST"
  | "PRERELEASE_STATE_UNSUPPORTED"
  | "APPLY_INVARIANT_FAILED";

export class SelectiveChangesetError extends Error {
  readonly code: SelectiveChangesetErrorCode;
  readonly details?: unknown;

  constructor(
    code: SelectiveChangesetErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "SelectiveChangesetError";
    this.code = code;
    this.details = details;
  }
}

export type SelectiveChangesetOptions = {
  cwd: string;
  changesetIds: readonly string[];
  packageAllowlist: readonly string[];
};

export type PrepareSelectiveChangesetsOptions = SelectiveChangesetOptions & {
  mode?: SelectiveChangesetMode;
};

export type SelectiveChangesetSummary = {
  id: string;
  releases: Array<{
    name: string;
    type: string;
  }>;
};

export type SelectiveChangesetResult = {
  mode: SelectiveChangesetMode;
  rootDir: string;
  changesetIds: string[];
  packageAllowlist: string[];
  changesets: SelectiveChangesetSummary[];
  releases: ComprehensiveRelease[];
  plannedPaths: string[];
  touchedPaths: string[];
};

type Candidate = {
  rootDir: string;
  changesetIds: string[];
  packageAllowlist: string[];
  allChangesets: NewChangeset[];
  selectedChangesets: NewChangeset[];
  packages: Packages;
  config: Config;
  releasePlan: ReleasePlan;
  plannedAbsolutePaths: string[];
};

type FileSnapshot = {
  path: string;
  contents: Buffer | null;
  mode: number | null;
};

function fail(
  code: SelectiveChangesetErrorCode,
  message: string,
  details?: unknown,
): never {
  throw new SelectiveChangesetError(code, message, details);
}

function normalizeUniqueValues(
  values: readonly string[],
  field: "changesetIds" | "packageAllowlist",
): string[] {
  if (values.length === 0) {
    fail(
      "INVALID_SELECTION",
      `${field} must contain at least one explicit value`,
    );
  }

  const normalized = values.map((value) => {
    if (value.length === 0 || value !== value.trim()) {
      fail(
        "INVALID_SELECTION",
        `${field} values must be non-empty and have no surrounding whitespace`,
        { value },
      );
    }
    return value;
  });

  const duplicates = normalized.filter(
    (value, index) => normalized.indexOf(value) !== index,
  );
  if (duplicates.length > 0) {
    fail("INVALID_SELECTION", `${field} contains duplicate values`, {
      duplicates: [...new Set(duplicates)].sort(),
    });
  }

  return [...normalized].sort();
}

function normalizeChangesetIds(values: readonly string[]): string[] {
  const ids = normalizeUniqueValues(values, "changesetIds");
  const invalid = ids.filter(
    (id) => !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id),
  );
  if (invalid.length > 0) {
    fail(
      "INVALID_SELECTION",
      "changesetIds must be bare Changeset IDs without paths or file extensions",
      { invalid },
    );
  }
  return ids;
}

function toRelativePath(rootDir: string, path: string): string {
  return relative(rootDir, path).split(sep).join("/");
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function plannedPathsFor(
  rootDir: string,
  changesetIds: readonly string[],
  releasePlan: ReleasePlan,
  packages: Packages,
  config: Config,
): string[] {
  const packagesByName = new Map(
    packages.packages.map((pkg) => [pkg.packageJson.name, pkg]),
  );
  const paths = changesetIds.map((id) =>
    join(rootDir, ".changeset", `${id}.md`),
  );

  for (const release of releasePlan.releases) {
    const pkg = packagesByName.get(release.name);
    if (!pkg) {
      fail(
        "PACKAGE_NOT_FOUND",
        `release plan references unknown workspace package ${release.name}`,
      );
    }
    paths.push(join(pkg.dir, "package.json"));
    if (config.changelog !== false && release.type !== "none") {
      paths.push(join(pkg.dir, "CHANGELOG.md"));
    }
  }

  return [...new Set(paths.map((path) => resolve(path)))].sort();
}

async function loadCandidate(
  options: SelectiveChangesetOptions,
): Promise<Candidate> {
  const rootDir = resolve(options.cwd);
  const changesetIds = normalizeChangesetIds(options.changesetIds);
  const packageAllowlist = normalizeUniqueValues(
    options.packageAllowlist,
    "packageAllowlist",
  );
  const allowlist = new Set(packageAllowlist);

  const packages = await getPackages(rootDir);
  const packagesByName = new Map(
    packages.packages.map((pkg) => [pkg.packageJson.name, pkg]),
  );
  const unknownPackages = packageAllowlist.filter(
    (name) => !packagesByName.has(name),
  );
  if (unknownPackages.length > 0) {
    fail(
      "PACKAGE_NOT_FOUND",
      "package allowlist contains packages that are not workspace members",
      { unknownPackages },
    );
  }

  const allChangesets = await getChangesets(rootDir);
  const changesetsById = new Map(
    allChangesets.map((changeset) => [changeset.id, changeset]),
  );
  const missingChangesets = changesetIds.filter(
    (id) => !changesetsById.has(id),
  );
  if (missingChangesets.length > 0) {
    fail(
      "CHANGESET_NOT_FOUND",
      "one or more requested Changeset IDs do not exist",
      { missingChangesets },
    );
  }

  for (const id of changesetIds) {
    const changesetPath = join(rootDir, ".changeset", `${id}.md`);
    if (!(await isFile(changesetPath))) {
      fail(
        "CHANGESET_NOT_FOUND",
        `requested Changeset ${id} is not a current .changeset/<id>.md file`,
        { changesetPath: toRelativePath(rootDir, changesetPath) },
      );
    }
  }

  const selectedChangesets = changesetIds.map((id) => {
    const changeset = changesetsById.get(id);
    if (!changeset) {
      fail("CHANGESET_NOT_FOUND", `requested Changeset ${id} does not exist`);
    }
    return changeset;
  });

  const selectedOutsideAllowlist = selectedChangesets.flatMap((changeset) =>
    changeset.releases
      .filter((release) => !allowlist.has(release.name))
      .map((release) => ({
        changesetId: changeset.id,
        packageName: release.name,
      })),
  );
  if (selectedOutsideAllowlist.length > 0) {
    fail(
      "SELECTION_OUTSIDE_ALLOWLIST",
      "selected Changesets reference packages outside the explicit package allowlist",
      { releases: selectedOutsideAllowlist },
    );
  }

  const preState = await readPreState(rootDir);
  if (preState !== undefined) {
    fail(
      "PRERELEASE_STATE_UNSUPPORTED",
      "selective Changeset candidates are not supported while prerelease state is active",
      { mode: preState.mode, tag: preState.tag },
    );
  }

  const config = await readChangesetsConfig(rootDir, packages);
  const releasePlan = assembleReleasePlan(
    selectedChangesets,
    packages,
    config,
    undefined,
  );
  const closureOutsideAllowlist = releasePlan.releases
    .filter((release) => !allowlist.has(release.name))
    .map((release) => ({
      packageName: release.name,
      type: release.type,
      oldVersion: release.oldVersion,
      newVersion: release.newVersion,
      changesets: release.changesets,
    }));
  if (closureOutsideAllowlist.length > 0) {
    fail(
      "CLOSURE_OUTSIDE_ALLOWLIST",
      "dependency closure requires packages outside the explicit package allowlist",
      { releases: closureOutsideAllowlist },
    );
  }

  const plannedAbsolutePaths = plannedPathsFor(
    rootDir,
    changesetIds,
    releasePlan,
    packages,
    config,
  );

  return {
    rootDir,
    changesetIds,
    packageAllowlist,
    allChangesets,
    selectedChangesets,
    packages,
    config,
    releasePlan,
    plannedAbsolutePaths,
  };
}

function resultFor(
  candidate: Candidate,
  mode: SelectiveChangesetMode,
  touchedAbsolutePaths: readonly string[] = [],
  reportedRootDir = candidate.rootDir,
): SelectiveChangesetResult {
  return {
    mode,
    rootDir: reportedRootDir,
    changesetIds: candidate.changesetIds,
    packageAllowlist: candidate.packageAllowlist,
    changesets: candidate.selectedChangesets.map((changeset) => ({
      id: changeset.id,
      releases: changeset.releases.map((release) => ({
        name: release.name,
        type: release.type,
      })),
    })),
    releases: candidate.releasePlan.releases.map((release) => ({
      ...release,
      changesets: [...release.changesets],
    })),
    plannedPaths: candidate.plannedAbsolutePaths.map((path) =>
      toRelativePath(candidate.rootDir, path),
    ),
    touchedPaths: touchedAbsolutePaths
      .map((path) => toRelativePath(candidate.rootDir, path))
      .sort(),
  };
}

async function snapshotFiles(paths: readonly string[]): Promise<FileSnapshot[]> {
  return Promise.all(
    [...new Set(paths.map((path) => resolve(path)))].map(async (path) => {
      try {
        const [contents, metadata] = await Promise.all([readFile(path), stat(path)]);
        return { path, contents, mode: metadata.mode & 0o777 };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return { path, contents: null, mode: null };
        }
        throw error;
      }
    }),
  );
}

async function restoreSnapshots(snapshots: readonly FileSnapshot[]): Promise<void> {
  for (const snapshot of [...snapshots].reverse()) {
    if (snapshot.contents === null) {
      await rm(snapshot.path, { force: true, recursive: true });
      continue;
    }
    await mkdir(dirname(snapshot.path), { recursive: true });
    await writeFile(snapshot.path, snapshot.contents);
    if (snapshot.mode !== null) {
      await chmod(snapshot.path, snapshot.mode);
    }
  }
}

async function changedSnapshotPaths(
  snapshots: readonly FileSnapshot[],
): Promise<string[]> {
  const changed: string[] = [];
  for (const snapshot of snapshots) {
    let current: Buffer | null;
    let currentMode: number | null;
    try {
      const [contents, metadata] = await Promise.all([
        readFile(snapshot.path),
        stat(snapshot.path),
      ]);
      current = contents;
      currentMode = metadata.mode & 0o777;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        current = null;
        currentMode = null;
      } else {
        throw error;
      }
    }

    if (
      snapshot.contents === null
        ? current !== null
        : current === null ||
          !snapshot.contents.equals(current) ||
          snapshot.mode !== currentMode
    ) {
      changed.push(snapshot.path);
    }
  }
  return changed.sort();
}

async function listFilesRecursively(path: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function stagingSourcePathsFor(candidate: Candidate): Promise<string[]> {
  const paths = [
    join(candidate.rootDir, "package.json"),
    join(candidate.rootDir, "bun.lock"),
    ...(await listFilesRecursively(join(candidate.rootDir, ".changeset"))),
    ...candidate.plannedAbsolutePaths,
  ];

  for (const pkg of candidate.packages.packages) {
    paths.push(join(pkg.dir, "package.json"));
    paths.push(join(pkg.dir, "CHANGELOG.md"));
  }

  return [...new Set(paths.map((path) => resolve(path)))].sort();
}

function relocateSnapshots(
  snapshots: readonly FileSnapshot[],
  fromRoot: string,
  toRoot: string,
): FileSnapshot[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    path: join(toRoot, toRelativePath(fromRoot, snapshot.path)),
  }));
}

async function materializeSnapshots(
  snapshots: readonly FileSnapshot[],
): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.contents === null) continue;
    await mkdir(dirname(snapshot.path), { recursive: true });
    await writeFile(snapshot.path, snapshot.contents);
    if (snapshot.mode !== null) {
      await chmod(snapshot.path, snapshot.mode);
    }
  }
}

function snapshotsForPaths(
  snapshots: readonly FileSnapshot[],
  rootDir: string,
  paths: readonly string[],
): FileSnapshot[] {
  const byRelativePath = new Map(
    snapshots.map((snapshot) => [toRelativePath(rootDir, snapshot.path), snapshot]),
  );
  return paths.map((path) => {
    const relativePath = toRelativePath(rootDir, path);
    const snapshot = byRelativePath.get(relativePath);
    if (!snapshot) {
      fail(
        "APPLY_INVARIANT_FAILED",
        `missing selected-file preimage for ${relativePath}`,
      );
    }
    return snapshot;
  });
}

async function assertWritableTargets(
  preimages: readonly FileSnapshot[],
  outputs: readonly FileSnapshot[],
): Promise<void> {
  const outputsByPath = new Map(outputs.map((snapshot) => [snapshot.path, snapshot]));
  for (const preimage of preimages) {
    const output = outputsByPath.get(preimage.path);
    if (!output) {
      fail(
        "APPLY_INVARIANT_FAILED",
        `missing staged output for ${preimage.path}`,
      );
    }
    if (output.contents === null || preimage.contents === null) {
      await access(dirname(preimage.path), constants.W_OK);
    } else {
      await access(preimage.path, constants.W_OK);
    }
  }
}

async function commitStagedOutputs(
  preimages: readonly FileSnapshot[],
  stagedOutputs: readonly FileSnapshot[],
  stagingRoot: string,
  realRoot: string,
): Promise<void> {
  const realOutputs = relocateSnapshots(stagedOutputs, stagingRoot, realRoot);
  const outputsByPath = new Map(
    realOutputs.map((snapshot) => [snapshot.path, snapshot]),
  );
  await assertWritableTargets(preimages, realOutputs);

  const applied: FileSnapshot[] = [];
  try {
    for (const preimage of preimages) {
      const drift = await changedSnapshotPaths([preimage]);
      if (drift.length > 0) {
        fail(
          "APPLY_INVARIANT_FAILED",
          "selected files changed after planning; no concurrent content was overwritten",
          { changedPaths: drift.map((path) => toRelativePath(realRoot, path)) },
        );
      }

      const output = outputsByPath.get(preimage.path);
      if (!output) {
        fail(
          "APPLY_INVARIANT_FAILED",
          `missing staged output for ${toRelativePath(realRoot, preimage.path)}`,
        );
      }
      applied.push(preimage);
      if (output.contents === null) {
        await rm(preimage.path, { force: true, recursive: true });
      } else {
        await mkdir(dirname(preimage.path), { recursive: true });
        await writeFile(preimage.path, output.contents);
        if (output.mode !== null) {
          await chmod(preimage.path, output.mode);
        }
      }

      const outputMismatch = await changedSnapshotPaths([output]);
      if (outputMismatch.length > 0) {
        fail(
          "APPLY_INVARIANT_FAILED",
          `selected-file write did not persist for ${toRelativePath(realRoot, preimage.path)}`,
        );
      }
    }
  } catch (error) {
    await restoreSnapshots(applied);
    throw error;
  }
}

function protectedPathsFor(candidate: Candidate): string[] {
  const releaseNames = new Set(
    candidate.releasePlan.releases.map((release) => release.name),
  );
  const selectedIds = new Set(candidate.changesetIds);
  const paths = candidate.allChangesets
    .filter((changeset) => !selectedIds.has(changeset.id))
    .map((changeset) =>
      join(candidate.rootDir, ".changeset", `${changeset.id}.md`),
    );

  for (const pkg of candidate.packages.packages) {
    if (!releaseNames.has(pkg.packageJson.name)) {
      paths.push(join(pkg.dir, "package.json"));
      if (candidate.config.changelog !== false) {
        paths.push(join(pkg.dir, "CHANGELOG.md"));
      }
    }
  }

  paths.push(join(candidate.rootDir, "package.json"));
  paths.push(join(candidate.rootDir, "bun.lock"));
  return [...new Set(paths.map((path) => resolve(path)))].sort();
}

async function assertAppliedVersions(candidate: Candidate): Promise<void> {
  const packagesByName = new Map(
    candidate.packages.packages.map((pkg) => [pkg.packageJson.name, pkg]),
  );
  const mismatches: Array<{
    packageName: string;
    expected: string;
    actual: unknown;
  }> = [];

  for (const release of candidate.releasePlan.releases) {
    const pkg = packagesByName.get(release.name);
    if (!pkg) {
      fail(
        "APPLY_INVARIANT_FAILED",
        `release plan references missing package ${release.name}`,
      );
    }
    const manifest = JSON.parse(
      await readFile(join(pkg.dir, "package.json"), "utf8"),
    ) as { version?: unknown };
    if (manifest.version !== release.newVersion) {
      mismatches.push({
        packageName: release.name,
        expected: release.newVersion,
        actual: manifest.version,
      });
    }
  }

  if (mismatches.length > 0) {
    fail(
      "APPLY_INVARIANT_FAILED",
      "one or more package versions do not match the computed release plan",
      { mismatches },
    );
  }
}

export async function planSelectiveChangesets(
  options: SelectiveChangesetOptions,
): Promise<SelectiveChangesetResult> {
  const candidate = await loadCandidate(options);
  return resultFor(candidate, "dry-run");
}

export async function applySelectiveChangesets(
  options: SelectiveChangesetOptions,
): Promise<SelectiveChangesetResult> {
  const realRoot = resolve(options.cwd);
  const initialCandidate = await loadCandidate({ ...options, cwd: realRoot });
  const sourceSnapshots = await snapshotFiles(
    await stagingSourcePathsFor(initialCandidate),
  );
  const stagingRoot = await mkdtemp(
    join(tmpdir(), "releases-selective-changesets-apply-"),
  );

  try {
    await materializeSnapshots(
      relocateSnapshots(sourceSnapshots, realRoot, stagingRoot),
    );
    const realNodeModules = join(realRoot, "node_modules");
    try {
      if ((await stat(realNodeModules)).isDirectory()) {
        await symlink(realNodeModules, join(stagingRoot, "node_modules"), "dir");
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }

    const candidate = await loadCandidate({ ...options, cwd: stagingRoot });
    const stagedPreimages = await snapshotFiles(candidate.plannedAbsolutePaths);
    const protectedSnapshots = await snapshotFiles(protectedPathsFor(candidate));
    const touchedAbsolutePaths = (
      await applyReleasePlan(
        candidate.releasePlan,
        candidate.packages,
        candidate.config,
        undefined,
        import.meta.dir,
      )
    )
      .map((path) => resolve(path))
      .sort();
    const expectedPaths = candidate.plannedAbsolutePaths;
    const unexpectedTouchedPaths = touchedAbsolutePaths.filter(
      (path) => !expectedPaths.includes(path),
    );
    const missingTouchedPaths = expectedPaths.filter(
      (path) => !touchedAbsolutePaths.includes(path),
    );
    if (
      unexpectedTouchedPaths.length > 0 ||
      missingTouchedPaths.length > 0
    ) {
      fail(
        "APPLY_INVARIANT_FAILED",
        "Changesets touched a path outside the computed selective candidate",
        {
          unexpectedTouchedPaths: unexpectedTouchedPaths.map((path) =>
            toRelativePath(candidate.rootDir, path),
          ),
          missingTouchedPaths: missingTouchedPaths.map((path) =>
            toRelativePath(candidate.rootDir, path),
          ),
        },
      );
    }

    const protectedChanges = await changedSnapshotPaths(protectedSnapshots);
    if (protectedChanges.length > 0) {
      fail(
        "APPLY_INVARIANT_FAILED",
        "unselected Changesets or package manifests changed during apply",
        {
          changedPaths: protectedChanges.map((path) =>
            toRelativePath(candidate.rootDir, path),
          ),
        },
      );
    }

    await assertAppliedVersions(candidate);
    const actualChangedPaths = await changedSnapshotPaths(stagedPreimages);
    const missingChangedPaths = expectedPaths.filter(
      (path) => !actualChangedPaths.includes(path),
    );
    const unexpectedChangedPaths = actualChangedPaths.filter(
      (path) => !expectedPaths.includes(path),
    );
    if (missingChangedPaths.length > 0 || unexpectedChangedPaths.length > 0) {
      fail(
        "APPLY_INVARIANT_FAILED",
        "Changesets reported selected-file writes that did not persist",
        {
          missingChangedPaths: missingChangedPaths.map((path) =>
            toRelativePath(candidate.rootDir, path),
          ),
          unexpectedChangedPaths: unexpectedChangedPaths.map((path) =>
            toRelativePath(candidate.rootDir, path),
          ),
        },
      );
    }

    const originalPreimages = snapshotsForPaths(
      sourceSnapshots,
      realRoot,
      candidate.plannedAbsolutePaths.map((path) =>
        join(realRoot, toRelativePath(stagingRoot, path)),
      ),
    );
    const concurrentChanges = await changedSnapshotPaths(originalPreimages);
    if (concurrentChanges.length > 0) {
      fail(
        "APPLY_INVARIANT_FAILED",
        "selected files changed after planning; no concurrent content was overwritten",
        {
          changedPaths: concurrentChanges.map((path) =>
            toRelativePath(realRoot, path),
          ),
        },
      );
    }

    const stagedOutputs = await snapshotFiles(candidate.plannedAbsolutePaths);
    await commitStagedOutputs(
      originalPreimages,
      stagedOutputs,
      stagingRoot,
      realRoot,
    );
    return resultFor(candidate, "apply", touchedAbsolutePaths, realRoot);
  } catch (error) {
    if (error instanceof SelectiveChangesetError) {
      throw error;
    }
    throw new SelectiveChangesetError(
      "APPLY_INVARIANT_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

export async function prepareSelectiveChangesets(
  options: PrepareSelectiveChangesetsOptions,
): Promise<SelectiveChangesetResult> {
  return options.mode === "apply"
    ? applySelectiveChangesets(options)
    : planSelectiveChangesets(options);
}
