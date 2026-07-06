import { pathToFileURL } from "node:url";
import { publishChangelog } from "./publisher.js";
import { LocalChangelogStore } from "./storage.js";
import type { ChangelogReleaseResult, ChangelogStore, PublishChangelogResult } from "./types.js";
import { normalizeAppId } from "./validation.js";

// `changelog publish` entrypoint for open-releases (Hasna distribution apps
// plan): accepts appId + version, promotes pending entries, generates/updates
// the changelog artifacts, and returns a changelogRef the caller can embed in
// its hasna.release.v1 document.

/**
 * Structural mirror of `ResourcePointer` from `@hasna/contracts` branch
 * `feat/distribution-schemas` (not yet published). A changelog ref uses
 * `kind: "document"` and always carries both `sourcePackage` and
 * `externalId` plus a `uri`, satisfying the pointer locator rules.
 */
export interface ChangelogRefPointer {
  kind: "document";
  id: string;
  name?: string;
  uri?: string;
  externalId?: string;
  sourcePackage?: string;
  tags?: string[];
}

export interface PublishReleaseOptions {
  /** hasna.app.v1 appId (join key), e.g. "open-todos". npm names are normalized. */
  appId: string;
  /** Released version; pending entries in `fromVersion` are promoted to it. */
  version: string;
  store?: ChangelogStore;
  /** Source bucket promoted into the release (default "Unreleased"). */
  fromVersion?: string;
  /** Release date as YYYY-MM-DD (default today). */
  date?: string;
  /** Target markdown file (default CHANGELOG.md under cwd). */
  targetPath?: string;
  cwd?: string;
  /** Write the markdown target (default true; false previews only). */
  write?: boolean;
  repositoryUrl?: string;
  title?: string;
  /**
   * Public base URL of the published changelog site. When set, the
   * changelogRef uri points at the app page instead of the local file.
   */
  baseUrl?: string;
  now?: Date;
}

export interface PublishReleaseResult {
  appId: string;
  version: string;
  released: ChangelogReleaseResult;
  publish: PublishChangelogResult;
  changelogRef: ChangelogRefPointer;
}

export function buildChangelogRef(input: {
  appId: string;
  version: string;
  uri?: string;
  name?: string;
}): ChangelogRefPointer {
  return {
    kind: "document",
    id: `changelog:${input.appId}@${input.version}`,
    name: input.name ?? `${input.appId} ${input.version} changelog`,
    uri: input.uri,
    externalId: `${input.appId}@${input.version}`,
    sourcePackage: "@hasna/changelog",
    tags: ["changelog"],
  };
}

export function changelogSiteAppUrl(baseUrl: string, appId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/apps/${appId}/`;
}

/**
 * Release-publish flow invoked by open-releases: promote the app's pending
 * entries to the released version, regenerate the changelog markdown, and
 * return a `changelogRef` resource pointer for the hasna.release.v1 document.
 * Promoting zero entries is legal (the release simply has no recorded
 * changes yet); the ref is still returned so deferred refs can resolve later.
 */
export async function publishRelease(options: PublishReleaseOptions): Promise<PublishReleaseResult> {
  const appId = normalizeAppId(options.appId);
  const version = options.version.trim();
  if (!version) throw new Error("version is required");

  const store = options.store ?? new LocalChangelogStore();
  const released = await store.releaseEntries({
    appId,
    version,
    fromVersion: options.fromVersion,
    date: options.date,
    now: options.now,
  });

  const publish = await publishChangelog({
    store,
    appId,
    title: options.title,
    repositoryUrl: options.repositoryUrl,
    targetPath: options.targetPath,
    cwd: options.cwd,
    write: options.write !== false,
  });

  const uri = options.baseUrl
    ? changelogSiteAppUrl(options.baseUrl, appId)
    : pathToFileURL(publish.targetPath).href;

  return {
    appId,
    version,
    released,
    publish,
    changelogRef: buildChangelogRef({ appId, version, uri }),
  };
}
