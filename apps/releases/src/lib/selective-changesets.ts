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
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
): SelectiveChangesetResult {
  return {
    mode,
    rootDir: candidate.rootDir,
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
        return { path, contents: await readFile(path) };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return { path, contents: null };
        }
        throw error;
      }
    }),
  );
}

async function restoreSnapshots(snapshots: readonly FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.contents === null) {
      await rm(snapshot.path, { force: true, recursive: true });
      continue;
    }
    await mkdir(dirname(snapshot.path), { recursive: true });
    await writeFile(snapshot.path, snapshot.contents);
  }
}

async function changedSnapshotPaths(
  snapshots: readonly FileSnapshot[],
): Promise<string[]> {
  const changed: string[] = [];
  for (const snapshot of snapshots) {
    let current: Buffer | null;
    try {
      current = await readFile(snapshot.path);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        current = null;
      } else {
        throw error;
      }
    }

    if (
      snapshot.contents === null
        ? current !== null
        : current === null || !snapshot.contents.equals(current)
    ) {
      changed.push(snapshot.path);
    }
  }
  return changed.sort();
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
  const candidate = await loadCandidate(options);
  const protectedSnapshots = await snapshotFiles(
    protectedPathsFor(candidate),
  );
  const rollbackSnapshots = await snapshotFiles([
    ...candidate.plannedAbsolutePaths,
    ...protectedSnapshots.map((snapshot) => snapshot.path),
  ]);

  try {
    const touchedAbsolutePaths = (
      await applyReleasePlan(
        candidate.releasePlan,
        candidate.packages,
        candidate.config,
        undefined,
        candidate.rootDir,
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
    return resultFor(candidate, "apply", touchedAbsolutePaths);
  } catch (error) {
    await restoreSnapshots(rollbackSnapshots);
    if (error instanceof SelectiveChangesetError) {
      throw error;
    }
    throw new SelectiveChangesetError(
      "APPLY_INVARIANT_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function prepareSelectiveChangesets(
  options: PrepareSelectiveChangesetsOptions,
): Promise<SelectiveChangesetResult> {
  return options.mode === "apply"
    ? applySelectiveChangesets(options)
    : planSelectiveChangesets(options);
}
