/**
 * Where an immutable `loop@version` bundle's bytes live.
 *
 * Two placements, chosen by configuration and nothing else. No selector
 * variable is introduced (hasna/apps#1599); the presence of a bucket name IS
 * the configuration:
 *
 *   - `HASNA_LOOPS_ARTIFACTS_BUCKET` set  -> S3, the hosted control plane's path.
 *   - unset                               -> a local artifact directory under
 *     `~/.hasna/loops/artifacts/`, so an OSS user with no AWS account can still
 *     push, pull and roll back.
 *
 * The key scheme is identical in both, so a local install that later gains a
 * bucket can have its tree copied in verbatim.
 *
 *     loops/<tenant>/<bundle-name>/<version>/bundle.tar.zst   application/zstd
 *     loops/<tenant>/<bundle-name>/<version>/manifest.json    application/json
 *     loops/<tenant>/<bundle-name>/latest.json                the ONLY mutable key
 *
 * The `<tenant>` segment is structural, never optional: one lifecycle rule and
 * one IAM statement key on it, and two tenants can never collide even if a
 * bundle name were reused.
 *
 * Immutability is enforced by CONSTRUCTION rather than by a conditional write.
 * `version` is allocated inside the same transaction that inserts the
 * `loop_revisions` row, under a unique index on (tenant, bundle_name, version),
 * so two concurrent pushes get two versions and no two writers ever address the
 * same key. The existence pre-check below is the second belt: it turns a replay
 * that somehow reached an occupied key into a refusal instead of an overwrite.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "../paths.js";
import { BundleIntegrityError } from "./manifest.js";
import { ownBytes, type OwnedBytes } from "./pack.js";

export const BUNDLE_ARCHIVE_FILE = "bundle.tar.zst";
export const BUNDLE_MANIFEST_FILE = "manifest.json";
export const BUNDLE_LATEST_FILE = "latest.json";
export const BUNDLE_ARCHIVE_CONTENT_TYPE = "application/zstd";

/** The bucket name env var. The only configuration this module reads. */
export const BUNDLE_BUCKET_ENV = "HASNA_LOOPS_ARTIFACTS_BUCKET";

/** The slice of an object store this needs. Injectable so tests can stand in an in-memory bucket. */
export interface BundleObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<OwnedBytes | undefined>;
  exists(key: string): Promise<boolean>;
}

export interface BundlePlacement {
  storageKind: "s3" | "db";
  storageKey: string;
}

export interface BundleLatestPointer {
  version: number;
  bundleDigest: string;
  archiveSha256: string;
  updatedAt: string;
}

export interface BundleArtifactStorageOptions {
  bucket?: string;
  region?: string;
  prefix?: string;
  /** Overrides both the bucket and the local directory (tests, and the in-memory fake). */
  store?: BundleObjectStore;
  /** Root for the local fallback placement. Defaults to `<loops data dir>/artifacts`. */
  localRoot?: string;
  env?: NodeJS.ProcessEnv;
}

export class BundleArtifactStorage {
  readonly bucket?: string;
  private readonly prefix: string;
  private readonly store: BundleObjectStore;
  /** True when a real bucket backs this storage; false for the local fallback. */
  readonly usesS3: boolean;

  /**
   * What a revision written through this storage should record as its kind.
   *
   * Derived from the placement that was actually chosen, never hard-coded: an
   * install with no bucket writes its objects to a local directory, and a row
   * claiming `s3` for bytes sitting on one station's disk is a lie told to
   * exactly the operator the fallback exists to serve.
   */
  get storageKind(): BundlePlacement["storageKind"] {
    return this.usesS3 ? "s3" : "db";
  }

  constructor(options: BundleArtifactStorageOptions = {}) {
    const env = options.env ?? process.env;
    this.bucket = (options.bucket ?? env[BUNDLE_BUCKET_ENV])?.trim() || undefined;
    this.prefix = (options.prefix ?? "loops").replace(/^\/+|\/+$/g, "");
    if (options.store) {
      this.store = options.store;
      this.usesS3 = Boolean(this.bucket);
    } else if (this.bucket) {
      this.store = nativeS3Store(this.bucket, options.region ?? env.AWS_REGION ?? "us-east-1");
      this.usesS3 = true;
    } else {
      this.store = localDirectoryStore(options.localRoot ?? join(dataDir(), "artifacts"));
      this.usesS3 = false;
    }
  }

  /**
   * `<prefix>/<tenant>/<name>/<version>/<file>`.
   *
   * Both variable segments are percent-encoded even though the bundle-name
   * charset already excludes `/`: the encoding is what keeps this key builder
   * safe if that charset is ever relaxed.
   */
  versionKey(tenantId: string, bundleName: string, version: number, file: string): string {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new BundleIntegrityError("BUNDLE_VERSION_INVALID", `bundle version must be an integer >= 1, got ${version}`);
    }
    return `${this.prefix}/${encodeURIComponent(tenantId)}/${encodeURIComponent(bundleName)}/${encodeURIComponent(String(version))}/${file}`;
  }

  latestKey(tenantId: string, bundleName: string): string {
    return `${this.prefix}/${encodeURIComponent(tenantId)}/${encodeURIComponent(bundleName)}/${BUNDLE_LATEST_FILE}`;
  }

  /**
   * Where a version WOULD be placed, without writing.
   *
   * Recorded on the revision row BEFORE the objects exist, so a crash between
   * the insert and the puts leaves a row whose objects are missing (diagnosable,
   * reported as `incomplete`) rather than an object no row references (invisible,
   * and therefore uncollectable).
   */
  placement(tenantId: string, bundleName: string, version: number): BundlePlacement {
    return { storageKind: this.storageKind, storageKey: this.versionKey(tenantId, bundleName, version, BUNDLE_ARCHIVE_FILE) };
  }

  /** Write manifest, then archive, then the latest pointer. Order is load-bearing (see the class doc). */
  async putVersion(
    tenantId: string,
    bundleName: string,
    version: number,
    archive: Uint8Array,
    manifest: Record<string, unknown>,
  ): Promise<BundlePlacement> {
    const archiveKey = this.versionKey(tenantId, bundleName, version, BUNDLE_ARCHIVE_FILE);
    if (await this.store.exists(archiveKey)) {
      throw new BundleIntegrityError("LOOP_VERSION_EXISTS", `bundle object already exists for version ${version}; versions are immutable and are never overwritten`);
    }
    await this.store.put(
      this.versionKey(tenantId, bundleName, version, BUNDLE_MANIFEST_FILE),
      new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
      "application/json",
    );
    await this.store.put(archiveKey, archive, BUNDLE_ARCHIVE_CONTENT_TYPE);
    return { storageKind: this.storageKind, storageKey: archiveKey };
  }

  /**
   * Update the sole mutable object.
   *
   * A pointer, never a source of truth: a disagreement with `loop_revisions` is
   * always resolved in favour of the table, and this object is repaired from it.
   */
  async putLatest(tenantId: string, bundleName: string, pointer: BundleLatestPointer): Promise<void> {
    await this.store.put(
      this.latestKey(tenantId, bundleName),
      new TextEncoder().encode(`${JSON.stringify(pointer, null, 2)}\n`),
      "application/json",
    );
  }

  async readLatest(tenantId: string, bundleName: string): Promise<BundleLatestPointer | undefined> {
    const bytes = await this.store.get(this.latestKey(tenantId, bundleName));
    if (!bytes) return undefined;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as BundleLatestPointer;
    } catch {
      return undefined;
    }
  }

  /** Read an archive back. `undefined` means the row exists but its object does not. */
  async readArchive(storageKey: string): Promise<OwnedBytes | undefined> {
    return this.store.get(storageKey);
  }
}

/**
 * Bun's native S3 client. Deliberately NOT `@aws-sdk/client-s3`: the SDK is
 * ~100 MB installed and would land in the dependency closure of the `./sdk`
 * subpath and every CLI invocation, which the package-surfaces rule forbids.
 * `Bun.S3Client` ships with the runtime and needs no dependency at all.
 */
function nativeS3Store(bucket: string, region: string): BundleObjectStore {
  const client = new Bun.S3Client({ bucket, region });
  return {
    async put(key, bytes, contentType) {
      await client.write(key, bytes, { type: contentType });
    },
    async get(key) {
      const file = client.file(key);
      if (!(await file.exists())) return undefined;
      return ownBytes(await file.bytes());
    },
    async exists(key) {
      return client.file(key).exists();
    },
  };
}

/**
 * Local artifact placement for installs with no bucket.
 *
 * The same key scheme, rooted at a directory. This is what makes `push` and
 * `pull` work for an OSS user on one machine. It is NOT a second local store
 * for a station talking to the hosted control plane: there the server owns the
 * bucket and the station only ever speaks HTTP.
 */
function localDirectoryStore(root: string): BundleObjectStore {
  const resolve = (key: string): string => {
    // The key is built by this module from an encoded tenant/name/version, so
    // it cannot contain a traversal — asserted anyway, because this one turns
    // into a filesystem path.
    if (key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new BundleIntegrityError("BUNDLE_PATH_INVALID", `refusing to build a local artifact path from '${key}'`);
    }
    return join(root, key);
  };
  return {
    async put(key, bytes) {
      const path = resolve(key);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, bytes, { mode: 0o600 });
    },
    async get(key) {
      const path = resolve(key);
      if (!existsSync(path)) return undefined;
      return ownBytes(readFileSync(path));
    },
    async exists(key) {
      return existsSync(resolve(key));
    },
  };
}

/** An in-memory bucket. Exported for tests and for `--dry-run` plumbing. */
export function memoryObjectStore(): BundleObjectStore & { keys(): string[] } {
  const objects = new Map<string, OwnedBytes>();
  return {
    async put(key, bytes) {
      objects.set(key, ownBytes(bytes));
    },
    async get(key) {
      return objects.get(key);
    },
    async exists(key) {
      return objects.has(key);
    },
    keys() {
      return [...objects.keys()].sort();
    },
  };
}
