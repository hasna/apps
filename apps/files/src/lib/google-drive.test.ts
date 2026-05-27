import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import type {
  GoogleDriveApiFile,
  GoogleDriveApiSharedDrive,
  GoogleDriveClient,
  GoogleDriveDownloadedFile,
  GoogleDriveDownloadedStream,
  GoogleDriveListFilesOptions,
  GoogleDriveListSharedDrivesOptions,
} from "./google-drive-client.js";

const testDir = mkdtempSync(join(tmpdir(), "open-files-"));
process.env.HASNA_FILES_DATA_DIR = testDir;
process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");

const { closeDb } = await import("../db/database.js");
const { getCurrentMachine } = await import("../db/machines.js");
const { createSource, updateSource } = await import("../db/sources.js");
const { getFile, listFiles } = await import("../db/files.js");
const {
  listGoogleDriveItems,
  setGoogleDriveClientFactoryForTests,
  setGoogleDriveProfileStatusProviderForTests,
  setGoogleDriveStorageAdapterForTests,
  preflightGoogleDriveSource,
  syncGoogleDriveSource,
} = await import("./google-drive.js");
const { listGoogleDriveImportedObjects } = await import("../db/google-drive.js");
const { loadConfig, saveConfig } = await import("./config.js");
const {
  GOOGLE_FOLDER_MIME,
  createConnectorProfileGoogleDriveClient,
} = await import("./google-drive-client.js");

type FilePage = { files: GoogleDriveApiFile[]; nextPageToken?: string };
type DrivePage = { drives: GoogleDriveApiSharedDrive[]; nextPageToken?: string };

class MockDriveClient implements GoogleDriveClient {
  readonly listFileCalls: GoogleDriveListFilesOptions[] = [];
  readonly downloaded: string[] = [];

  constructor(
    private readonly filePages: (options: GoogleDriveListFilesOptions) => FilePage,
    private readonly drivePages: (options?: GoogleDriveListSharedDrivesOptions) => DrivePage = () => ({ drives: [] }),
  ) {}

  async listFiles(options: GoogleDriveListFilesOptions): Promise<FilePage> {
    this.listFileCalls.push(options);
    return this.filePages(options);
  }

  async listSharedDrives(options?: GoogleDriveListSharedDrivesOptions): Promise<DrivePage> {
    return this.drivePages(options);
  }

  async downloadFile(file: GoogleDriveApiFile): Promise<GoogleDriveDownloadedFile> {
    this.downloaded.push(file.id);
    return {
      data: new TextEncoder().encode(`data:${file.id}`).buffer,
      filename: file.name,
      mimeType: file.mimeType,
    };
  }

  async downloadFileStream(file: GoogleDriveApiFile): Promise<GoogleDriveDownloadedStream> {
    this.downloaded.push(`stream:${file.id}`);
    return {
      body: Readable.from([Buffer.from(`stream:${file.id}`)]),
      filename: file.name,
      mimeType: file.mimeType,
      size: Number(file.size ?? 0),
    };
  }
}

beforeEach(() => {
  closeDb();
  rmSync(process.env.HASNA_FILES_DB_PATH!, { force: true });
  rmSync(`${process.env.HASNA_FILES_DB_PATH!}-shm`, { force: true });
  rmSync(`${process.env.HASNA_FILES_DB_PATH!}-wal`, { force: true });
  setGoogleDriveClientFactoryForTests();
  setGoogleDriveProfileStatusProviderForTests();
  setGoogleDriveStorageAdapterForTests();
  saveConfig({ ...loadConfig(), google_drive_default_destination_source_id: "" });
});

afterAll(() => {
  closeDb();
  rmSync(testDir, { recursive: true, force: true });
});

describe("Google Drive discovery", () => {
  test("uses the connectors SDK for profile-scoped Drive listing", async () => {
    const previousToken = process.env.GOOGLE_ACCESS_TOKEN;
    const previousFetch = globalThis.fetch;
    const requests: string[] = [];
    process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(String(input));
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
      return new Response(JSON.stringify({
        files: [file("sdk-1", "sdk.txt", undefined, "text/plain")],
        nextPageToken: "next",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const client = createConnectorProfileGoogleDriveClient("work");
      const page = await client.listFiles({ pageSize: 25, pageToken: "first" });

      expect(page.files[0]?.id).toBe("sdk-1");
      expect(page.nextPageToken).toBe("next");
      expect(requests[0]).toContain("pageSize=25");
      expect(requests[0]).toContain("pageToken=first");
    } finally {
      if (previousToken === undefined) {
        delete process.env.GOOGLE_ACCESS_TOKEN;
      } else {
        process.env.GOOGLE_ACCESS_TOKEN = previousToken;
      }
      globalThis.fetch = previousFetch;
    }
  });

  test("treats empty Drive media responses as valid zero-byte files", async () => {
    const previousToken = process.env.GOOGLE_ACCESS_TOKEN;
    const previousFetch = globalThis.fetch;
    process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/files/empty-video");
      expect(String(input)).toContain("alt=media");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
      return new Response(new Uint8Array(), { status: 200 });
    }) as typeof fetch;

    try {
      const client = createConnectorProfileGoogleDriveClient("work");
      const downloaded = await client.downloadFile(file("empty-video", "MOIC4842.MP4", undefined, "video/mp4"));

      expect(downloaded.filename).toBe("MOIC4842.MP4");
      expect(downloaded.mimeType).toBe("video/mp4");
      expect(downloaded.data.byteLength).toBe(0);
    } finally {
      if (previousToken === undefined) {
        delete process.env.GOOGLE_ACCESS_TOKEN;
      } else {
        process.env.GOOGLE_ACCESS_TOKEN = previousToken;
      }
      globalThis.fetch = previousFetch;
    }
  });

  test("streams Drive media responses without base64 buffering", async () => {
    const previousToken = process.env.GOOGLE_ACCESS_TOKEN;
    const previousFetch = globalThis.fetch;
    process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/files/large-video");
      expect(String(input)).toContain("alt=media");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "3" },
      });
    }) as typeof fetch;

    try {
      const client = createConnectorProfileGoogleDriveClient("work");
      const downloaded = await client.downloadFileStream!(file("large-video", "EUROFABEIQUE_FINAL.mp4", undefined, "video/mp4"));
      const chunks: Buffer[] = [];
      for await (const chunk of downloaded.body) chunks.push(Buffer.from(chunk as Uint8Array));

      expect(downloaded.filename).toBe("EUROFABEIQUE_FINAL.mp4");
      expect(downloaded.mimeType).toBe("video/mp4");
      expect(downloaded.size).toBe(10);
      expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
    } finally {
      if (previousToken === undefined) {
        delete process.env.GOOGLE_ACCESS_TOKEN;
      } else {
        process.env.GOOGLE_ACCESS_TOKEN = previousToken;
      }
      globalThis.fetch = previousFetch;
    }
  });

  test("streams large Drive media responses as bounded range chunks", async () => {
    const previousToken = process.env.GOOGLE_ACCESS_TOKEN;
    const previousFetch = globalThis.fetch;
    const ranges: string[] = [];
    process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/files/ranged-video");
      expect(String(input)).toContain("alt=media");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-access-token");
      ranges.push(headers.Range);
      return new Response(new Uint8Array([ranges.length]), {
        status: 206,
        headers: { "content-type": "video/mp4" },
      });
    }) as typeof fetch;

    try {
      const client = createConnectorProfileGoogleDriveClient("work");
      const downloaded = await client.downloadFileStream!(file("ranged-video", "EUROFABEIQUE_FINAL.mp4", undefined, "video/mp4", {
        size: String(64 * 1024 * 1024 + 1),
      }));
      const chunks: Buffer[] = [];
      for await (const chunk of downloaded.body) chunks.push(Buffer.from(chunk as Uint8Array));

      expect(downloaded.size).toBe(64 * 1024 * 1024 + 1);
      expect(ranges).toEqual([
        "bytes=0-67108863",
        "bytes=67108864-67108864",
      ]);
      expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2]));
    } finally {
      if (previousToken === undefined) {
        delete process.env.GOOGLE_ACCESS_TOKEN;
      } else {
        process.env.GOOGLE_ACCESS_TOKEN = previousToken;
      }
      globalThis.fetch = previousFetch;
    }
  });

  test("paginates My Drive and shared drives while preserving folder paths", async () => {
    const machine = getCurrentMachine();
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: true,
        delete_behavior: "ignore",
      },
    });

    const client = new MockDriveClient(
      (options) => {
        if (options.driveId === "shared-a") {
          return {
            files: [
              folder("folder-shared", "Shared Folder"),
              file("shared-doc", "deck.pdf", "folder-shared", "application/pdf"),
            ],
          };
        }
        if (options.pageToken === "my-page-2") {
          return { files: [file("my-2", "notes.md", undefined, "text/markdown")] };
        }
        return {
          files: [
            folder("folder-1", "Folder"),
            file("my-1", "report.txt", "folder-1", "text/plain"),
          ],
          nextPageToken: "my-page-2",
        };
      },
      (options) => options?.pageToken === "shared-page-2"
        ? { drives: [{ id: "shared-b", name: "Shared B" }] }
        : { drives: [{ id: "shared-a", name: "Shared A" }], nextPageToken: "shared-page-2" },
    );
    setGoogleDriveClientFactoryForTests(() => client);

    const items = await listGoogleDriveItems(googleSource);

    expect(items.map((item) => [item.drive_id, item.path])).toContainEqual(["my-drive", "Folder/report.txt"]);
    expect(items.map((item) => [item.drive_id, item.path])).toContainEqual(["my-drive", "notes.md"]);
    expect(items.map((item) => [item.drive_name, item.path])).toContainEqual(["Shared A", "Shared Folder/deck.pdf"]);
    expect(items.some((item) => item.mime === GOOGLE_FOLDER_MIME)).toBe(false);
    expect(client.listFileCalls.some((call) => call.pageToken === "my-page-2")).toBe(true);
  });
});

describe("Google Drive sync", () => {
  test("preflights destination, auth status, and Drive item counts without uploading", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "prod-emails-drive",
      type: "s3",
      bucket: "hasna-xyz-prod-emails",
      prefix: "imports",
      region: "us-west-2",
      config: { profile: "hasna-xyz-infra" },
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: true,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    setGoogleDriveProfileStatusProviderForTests(async () => [{
      profile: "work",
      configured: true,
      authenticated: true,
      expired: false,
      expiresAt: Date.now() + 3_600_000,
      hasAccessToken: true,
      hasRefreshToken: true,
      hasOAuthCredentials: true,
      authRequired: false,
      message: "ok",
    }]);
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async () => {
        throw new Error("dry run must not upload");
      },
    });
    setGoogleDriveClientFactoryForTests(() => new MockDriveClient(
      (options) => options.driveId === "shared-a"
        ? { files: [file("shared-doc", "deck.pdf", undefined, "application/pdf")] }
        : { files: [file("my-doc", "report.txt", undefined, "text/plain")] },
      () => ({ drives: [{ id: "shared-a", name: "Shared A" }] }),
    ));

    const result = await preflightGoogleDriveSource(googleSource);

    expect(result.errors).toEqual([]);
    expect(result.destination).toMatchObject({
      source_id: s3Source.id,
      type: "s3",
      bucket: "hasna-xyz-prod-emails",
      prefix: "imports",
      region: "us-west-2",
      aws_profile: "hasna-xyz-infra",
    });
    expect(result.auth).toMatchObject({ profile: "work", authRequired: false });
    expect(result.item_count).toBe(2);
    expect(result.drive_counts).toEqual([
      expect.objectContaining({ drive_name: "My Drive", count: 1 }),
      expect.objectContaining({ drive_name: "Shared A", count: 1 }),
    ]);
  });

  test("preflight reports auth errors without listing or uploading", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "prod-emails-drive",
      type: "s3",
      bucket: "hasna-xyz-prod-emails",
      region: "us-west-2",
      config: { profile: "hasna-xyz-infra" },
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    setGoogleDriveProfileStatusProviderForTests(async () => [{
      profile: "work",
      configured: true,
      authenticated: false,
      expired: true,
      expiresAt: Date.now() - 60_000,
      hasAccessToken: true,
      hasRefreshToken: false,
      hasOAuthCredentials: true,
      authRequired: true,
      message: "reauth required",
    }]);
    setGoogleDriveClientFactoryForTests(() => new MockDriveClient(() => {
      throw new Error("auth preflight must not list files");
    }));

    const result = await preflightGoogleDriveSource(googleSource);

    expect(result.item_count).toBe(0);
    expect(result.errors).toEqual(["reauth required"]);
  });

  test("records Drive files under a configured S3 destination", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "Files bucket",
      type: "s3",
      bucket: "files-bucket",
      prefix: "imports",
      region: "us-west-2",
      config: {},
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    const uploads: Array<{ key: string; data: string; source: string }> = [];
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async (source, body, key) => {
        uploads.push({ key, data: Buffer.from(body as Uint8Array).toString("utf8"), source: source.id });
        return key;
      },
    });
    setGoogleDriveClientFactoryForTests(() => new MockDriveClient(() => ({
      files: [file("doc-1", "report.txt", undefined, "text/plain", { md5Checksum: "drive-md5", version: "7" })],
    })));

    const stats = await syncGoogleDriveSource(googleSource);

    expect(stats).toMatchObject({ added: 1, updated: 0, deleted: 0, errors: 0 });
    expect(uploads).toEqual([{
      source: s3Source.id,
      key: "imports/work/my-drive/report (doc-1).txt",
      data: "data:doc-1",
    }]);
    const indexed = listFiles({ source_id: s3Source.id });
    expect(indexed).toHaveLength(1);
    expect(indexed[0]?.path).toBe("imports/work/my-drive/report (doc-1).txt");
    expect(indexed[0]?.source_id).toBe(s3Source.id);

    const imports = listGoogleDriveImportedObjects(googleSource.id);
    expect(imports[0]).toMatchObject({
      destination_source_id: s3Source.id,
      storage_type: "s3",
      storage_key: "imports/work/my-drive/report (doc-1).txt",
      s3_key: "imports/work/my-drive/report (doc-1).txt",
      file_record_id: indexed[0]?.id,
    });
  });

  test("streams large Drive binaries to S3 without calling buffered download", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "Files bucket",
      type: "s3",
      bucket: "files-bucket",
      prefix: "imports",
      region: "us-west-2",
      config: {},
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    const uploads: Array<{ key: string; contentLength?: number; bodyWasBuffer: boolean; data: string }> = [];
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async (_source, body, key, _contentType, contentLength) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body as NodeJS.ReadableStream) chunks.push(Buffer.from(chunk as Uint8Array));
        uploads.push({
          key,
          contentLength,
          bodyWasBuffer: Buffer.isBuffer(body),
          data: Buffer.concat(chunks).toString("utf8"),
        });
        return key;
      },
    });
    const largeFile = file("large-video", "EUROFABEIQUE_FINAL.mp4", undefined, "video/mp4", {
      size: "19344300537",
      md5Checksum: "drive-md5",
      version: "9",
    });
    const client = new MockDriveClient(() => ({ files: [largeFile] }));
    client.downloadFile = async () => {
      throw new Error("buffered download must not be used for large S3 imports");
    };
    setGoogleDriveClientFactoryForTests(() => client);

    const stats = await syncGoogleDriveSource(googleSource);

    expect(stats).toMatchObject({ added: 1, updated: 0, deleted: 0, errors: 0 });
    expect(client.downloaded).toEqual(["stream:large-video"]);
    expect(uploads).toEqual([{
      key: "imports/work/my-drive/EUROFABEIQUE_FINAL (large-video).mp4",
      contentLength: 19344300537,
      bodyWasBuffer: false,
      data: "stream:large-video",
    }]);
    const indexed = listFiles({ source_id: s3Source.id });
    expect(indexed[0]).toMatchObject({
      path: "imports/work/my-drive/EUROFABEIQUE_FINAL (large-video).mp4",
      size: 19344300537,
      hash: "drive-md5",
    });
    expect(listGoogleDriveImportedObjects(googleSource.id)[0]).toMatchObject({
      file_id: "large-video",
      size: 19344300537,
      hash: "drive-md5",
    });
  });

  test("streams Drive binaries with unknown size to S3 without buffered download", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "Files bucket",
      type: "s3",
      bucket: "files-bucket",
      prefix: "imports",
      region: "us-west-2",
      config: {},
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    const uploads: Array<{ key: string; contentLength?: number; data: string }> = [];
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async (_source, body, key, _contentType, contentLength) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body as NodeJS.ReadableStream) chunks.push(Buffer.from(chunk as Uint8Array));
        uploads.push({ key, contentLength, data: Buffer.concat(chunks).toString("utf8") });
        return key;
      },
    });
    const unknownSizeVideo = file("unknown-video", "MOIC4842.MP4", undefined, "video/mp4", {
      size: undefined,
      md5Checksum: undefined,
      version: "3",
    });
    const client = new MockDriveClient(() => ({ files: [unknownSizeVideo] }));
    client.downloadFile = async () => {
      throw new Error("buffered download must not be used for unknown-size S3 imports");
    };
    setGoogleDriveClientFactoryForTests(() => client);

    const stats = await syncGoogleDriveSource(googleSource);

    expect(stats).toMatchObject({ added: 1, updated: 0, deleted: 0, errors: 0 });
    expect(client.downloaded).toEqual(["stream:unknown-video"]);
    expect(uploads).toEqual([{
      key: "imports/work/my-drive/MOIC4842 (unknown-video).MP4",
      contentLength: undefined,
      data: "stream:unknown-video",
    }]);
    expect(listGoogleDriveImportedObjects(googleSource.id)[0]).toMatchObject({
      file_id: "unknown-video",
      storage_key: "imports/work/my-drive/MOIC4842 (unknown-video).MP4",
      size: 0,
    });
  });

  test("uses Drive file IDs in path-based storage keys so duplicate filenames do not collide", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "Files bucket",
      type: "s3",
      bucket: "files-bucket",
      region: "us-west-2",
      config: {},
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    const uploads: string[] = [];
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async (_source, _body, key) => {
        uploads.push(key);
        return key;
      },
    });
    setGoogleDriveClientFactoryForTests(() => new MockDriveClient(() => ({
      files: [
        file("invoice-a", "Invoice.pdf", undefined, "application/pdf"),
        file("invoice-b", "Invoice.pdf", undefined, "application/pdf"),
      ],
    })));

    const stats = await syncGoogleDriveSource(googleSource);

    expect(stats).toMatchObject({ added: 2, updated: 0, deleted: 0, errors: 0 });
    expect(uploads).toEqual([
      "work/my-drive/Invoice (invoice-a).pdf",
      "work/my-drive/Invoice (invoice-b).pdf",
    ]);
    expect(new Set(uploads).size).toBe(2);
    expect(listFiles({ source_id: s3Source.id }).map((item) => item.path).sort()).toEqual([
      "work/my-drive/Invoice (invoice-a).pdf",
      "work/my-drive/Invoice (invoice-b).pdf",
    ]);
    expect(listGoogleDriveImportedObjects(googleSource.id).map((item) => item.s3_key).sort()).toEqual([
      "work/my-drive/Invoice (invoice-a).pdf",
      "work/my-drive/Invoice (invoice-b).pdf",
    ]);
  });

  test("archives non-exportable Google Workspace items as metadata JSON", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "Files bucket",
      type: "s3",
      bucket: "files-bucket",
      region: "us-west-2",
      config: {},
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    const uploads: Array<{ key: string; data: Record<string, unknown>; mime: string }> = [];
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async (_source, body, key, contentType) => {
        uploads.push({
          key,
          data: JSON.parse(Buffer.from(body as Uint8Array).toString("utf8")),
          mime: contentType,
        });
        return key;
      },
    });
    const client = new MockDriveClient(() => ({
      files: [
        file("form-1", "Hiring Form", undefined, "application/vnd.google-apps.form", { version: "17" }),
        file("shortcut-1", "Shared Folder", undefined, "application/vnd.google-apps.shortcut"),
      ],
    }));
    setGoogleDriveClientFactoryForTests(() => client);

    const stats = await syncGoogleDriveSource(googleSource);

    expect(stats).toMatchObject({ added: 2, updated: 0, deleted: 0, errors: 0 });
    expect(client.downloaded).toEqual([]);
    expect(uploads.map((item) => item.key)).toEqual([
      "work/my-drive/Hiring Form.gdrive-metadata (form-1).json",
      "work/my-drive/Shared Folder.gdrive-metadata (shortcut-1).json",
    ]);
    expect(uploads.every((item) => item.mime === "application/json")).toBe(true);
    expect(uploads[0]?.data).toMatchObject({
      id: "form-1",
      name: "Hiring Form",
      mime: "application/vnd.google-apps.form",
      drive_id: "my-drive",
      drive_name: "My Drive",
      path: "Hiring Form",
      version: "17",
      archived_as: "google-drive-metadata",
    });
    expect(listGoogleDriveImportedObjects(googleSource.id).map((item) => item.s3_key).sort()).toEqual([
      "work/my-drive/Hiring Form.gdrive-metadata (form-1).json",
      "work/my-drive/Shared Folder.gdrive-metadata (shortcut-1).json",
    ]);
  });

  test("falls back to metadata JSON when Google Drive refuses to export a Workspace file", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "Files bucket",
      type: "s3",
      bucket: "files-bucket",
      region: "us-west-2",
      config: {},
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    const uploads: Array<{ key: string; data: Record<string, unknown>; mime: string }> = [];
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async (_source, body, key, contentType) => {
        uploads.push({
          key,
          data: JSON.parse(Buffer.from(body as Uint8Array).toString("utf8")),
          mime: contentType,
        });
        return key;
      },
    });
    const client = new MockDriveClient(() => ({
      files: [
        file("presentation-1", "Lane Health Visual Concepts", undefined, "application/vnd.google-apps.presentation", {
          version: "171",
        }),
      ],
    }));
    client.downloadFile = async (driveFile) => {
      client.downloaded.push(driveFile.id);
      throw new Error("Google Drive request failed (403): This file cannot be exported by the user.");
    };
    setGoogleDriveClientFactoryForTests(() => client);

    const stats = await syncGoogleDriveSource(googleSource);

    expect(stats).toMatchObject({ added: 1, updated: 0, deleted: 0, errors: 0 });
    expect(client.downloaded).toEqual(["presentation-1"]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      key: "work/my-drive/Lane Health Visual Concepts.gdrive-metadata (presentation-1).json",
      mime: "application/json",
    });
    expect(uploads[0]?.data).toMatchObject({
      id: "presentation-1",
      name: "Lane Health Visual Concepts",
      mime: "application/vnd.google-apps.presentation",
      archived_as: "google-drive-metadata",
      reason: "Google Drive export failed: Google Drive request failed (403): This file cannot be exported by the user.",
    });
  });

  test("falls back to metadata JSON when a Workspace export is too large", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "Files bucket",
      type: "s3",
      bucket: "files-bucket",
      region: "us-west-2",
      config: {},
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    const uploads: Array<{ key: string; data: Record<string, unknown>; mime: string }> = [];
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async (_source, body, key, contentType) => {
        uploads.push({
          key,
          data: JSON.parse(Buffer.from(body as Uint8Array).toString("utf8")),
          mime: contentType,
        });
        return key;
      },
    });
    const client = new MockDriveClient(() => ({
      files: [
        file("presentation-large", "Hasna <> The Gradient - Product Design Proposal", undefined, "application/vnd.google-apps.presentation", {
          version: "171",
        }),
      ],
    }));
    client.downloadFile = async (driveFile) => {
      client.downloaded.push(driveFile.id);
      throw new Error("Google Drive request failed (403): This file is too large to be exported.");
    };
    setGoogleDriveClientFactoryForTests(() => client);

    const stats = await syncGoogleDriveSource(googleSource);

    expect(stats).toMatchObject({ added: 1, updated: 0, deleted: 0, errors: 0 });
    expect(client.downloaded).toEqual(["presentation-large"]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      key: "work/my-drive/Hasna <> The Gradient - Product Design Proposal.gdrive-metadata (presentation-large).json",
      mime: "application/json",
    });
    expect(uploads[0]?.data).toMatchObject({
      id: "presentation-large",
      name: "Hasna <> The Gradient - Product Design Proposal",
      mime: "application/vnd.google-apps.presentation",
      archived_as: "google-drive-metadata",
      reason: "Google Drive export failed: Google Drive request failed (403): This file is too large to be exported.",
    });
  });

  test("skips unchanged Drive files and updates changed revisions on repeated S3 syncs", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "prod-emails-drive",
      type: "s3",
      bucket: "hasna-xyz-prod-emails",
      region: "us-west-2",
      config: { profile: "hasna-xyz-infra" },
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    const uploads: string[] = [];
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async (_source, _body, key) => {
        uploads.push(key);
        return key;
      },
    });

    let driveFile = file("doc-1", "report.txt", undefined, "text/plain", {
      md5Checksum: "hash-1",
      modifiedTime: "2026-04-24T09:00:00.000Z",
      version: "1",
    });
    setGoogleDriveClientFactoryForTests(() => new MockDriveClient(() => ({ files: [driveFile] })));

    expect(await syncGoogleDriveSource(googleSource)).toMatchObject({ added: 1, updated: 0, errors: 0 });
    expect(await syncGoogleDriveSource(googleSource)).toMatchObject({ added: 0, updated: 0, errors: 0 });

    driveFile = file("doc-1", "report.txt", undefined, "text/plain", {
      md5Checksum: "hash-2",
      modifiedTime: "2026-04-24T10:00:00.000Z",
      version: "2",
    });
    expect(await syncGoogleDriveSource(googleSource)).toMatchObject({ added: 0, updated: 1, errors: 0 });

    expect(uploads).toEqual([
      "work/my-drive/report (doc-1).txt",
      "work/my-drive/report (doc-1).txt",
    ]);
    expect(listGoogleDriveImportedObjects(googleSource.id)[0]).toMatchObject({
      hash: "hash-2",
      modified_at: "2026-04-24T10:00:00.000Z",
      version: "2",
    });
  });

  test("reuploads unchanged Drive files when the S3 destination prefix changes", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "prod-files",
      type: "s3",
      bucket: "hasna-xyz-prod-files",
      prefix: "google-drive",
      region: "us-east-1",
      config: { profile: "hasna-xyz-infra" },
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    const uploads: string[] = [];
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async (_source, _body, key) => {
        uploads.push(key);
        return key;
      },
    });
    setGoogleDriveClientFactoryForTests(() => new MockDriveClient(() => ({
      files: [file("doc-1", "report.txt", undefined, "text/plain", {
        md5Checksum: "hash-1",
        modifiedTime: "2026-04-24T09:00:00.000Z",
        version: "1",
      })],
    })));

    expect(await syncGoogleDriveSource(googleSource)).toMatchObject({ added: 1, updated: 0, errors: 0 });
    updateSource(s3Source.id, {
      name: "prod-emails-drive",
      bucket: "hasna-xyz-prod-emails",
      prefix: "drive",
      region: "us-west-2",
    });

    expect(await syncGoogleDriveSource(googleSource)).toMatchObject({ added: 0, updated: 1, errors: 0 });

    expect(uploads).toEqual([
      "google-drive/work/my-drive/report (doc-1).txt",
      "drive/work/my-drive/report (doc-1).txt",
    ]);
    expect(listGoogleDriveImportedObjects(googleSource.id)[0]).toMatchObject({
      destination_source_id: s3Source.id,
      storage_key: "drive/work/my-drive/report (doc-1).txt",
      s3_key: "drive/work/my-drive/report (doc-1).txt",
    });
    expect(listFiles({ source_id: s3Source.id })[0]?.path).toBe("drive/work/my-drive/report (doc-1).txt");
  });

  test("retries Drive files that failed during a previous S3 sync", async () => {
    const machine = getCurrentMachine();
    const s3Source = createSource({
      name: "prod-emails-drive",
      type: "s3",
      bucket: "hasna-xyz-prod-emails",
      region: "us-west-2",
      config: { profile: "hasna-xyz-infra" },
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: s3Source.id,
        delete_behavior: "ignore",
      },
    });
    const uploads: string[] = [];
    let shouldFail = true;
    setGoogleDriveStorageAdapterForTests({
      uploadS3: async (_source, _body, key) => {
        uploads.push(key);
        if (shouldFail) throw new Error("temporary S3 failure");
        return key;
      },
    });
    setGoogleDriveClientFactoryForTests(() => new MockDriveClient(() => ({
      files: [file("doc-1", "resume.txt", undefined, "text/plain", {
        md5Checksum: "hash-1",
        version: "1",
      })],
    })));

    expect(await syncGoogleDriveSource(googleSource)).toMatchObject({ added: 0, updated: 0, errors: 1 });
    expect(listGoogleDriveImportedObjects(googleSource.id)).toHaveLength(0);

    shouldFail = false;
    expect(await syncGoogleDriveSource(googleSource)).toMatchObject({ added: 1, updated: 0, errors: 0 });
    expect(uploads).toEqual([
      "work/my-drive/resume (doc-1).txt",
      "work/my-drive/resume (doc-1).txt",
    ]);
    expect(listGoogleDriveImportedObjects(googleSource.id)[0]).toMatchObject({
      file_id: "doc-1",
      storage_key: "work/my-drive/resume (doc-1).txt",
    });
  });

  test("syncs to a configured local destination and marks missing Drive files deleted", async () => {
    const machine = getCurrentMachine();
    const localRoot = join(testDir, "local-destination");
    const localSource = createSource({
      name: "Local destination",
      type: "local",
      path: localRoot,
      config: {},
      machine_id: machine.id,
    });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "personal",
        include_my_drive: true,
        include_all_shared_drives: false,
        destination_source_id: localSource.id,
        delete_behavior: "mark_deleted",
      },
    });
    let files = [file("doc-1", "todo.txt", undefined, "text/plain")];
    setGoogleDriveClientFactoryForTests(() => new MockDriveClient(() => ({ files })));

    await syncGoogleDriveSource(googleSource);
    const storedPath = join(localRoot, "personal/my-drive/todo (doc-1).txt");
    expect(existsSync(storedPath)).toBe(true);
    expect(readFileSync(storedPath, "utf8")).toBe("data:doc-1");
    const indexed = listFiles({ source_id: localSource.id });
    expect(indexed[0]?.path).toBe("personal/my-drive/todo (doc-1).txt");

    files = [];
    const deleteStats = await syncGoogleDriveSource(googleSource);

    expect(deleteStats.deleted).toBe(1);
    expect(getFile(indexed[0]!.id)?.status).toBe("deleted");
    const imports = listGoogleDriveImportedObjects(googleSource.id);
    expect(imports[0]).toMatchObject({
      storage_type: "local",
      storage_key: "personal/my-drive/todo (doc-1).txt",
      destination_source_id: localSource.id,
      deleted: true,
    });
  });

  test("uses configured default destination source when Google Drive source omits one", async () => {
    const machine = getCurrentMachine();
    const localRoot = join(testDir, "configured-local-destination");
    const localSource = createSource({
      name: "Configured local",
      type: "local",
      path: localRoot,
      config: {},
      machine_id: machine.id,
    });
    saveConfig({ ...loadConfig(), google_drive_default_destination_source_id: localSource.id });
    const googleSource = createSource({
      name: "Drive",
      type: "google_drive",
      machine_id: machine.id,
      config: {
        profile: "personal",
        include_my_drive: true,
        include_all_shared_drives: false,
        delete_behavior: "ignore",
      },
    });
    setGoogleDriveClientFactoryForTests(() => new MockDriveClient(() => ({
      files: [file("doc-1", "configured.txt", undefined, "text/plain")],
    })));

    await syncGoogleDriveSource(googleSource);

    expect(listFiles({ source_id: localSource.id })[0]?.path).toBe("personal/my-drive/configured (doc-1).txt");
  });
});

function folder(id: string, name: string, parent?: string): GoogleDriveApiFile {
  return file(id, name, parent, GOOGLE_FOLDER_MIME);
}

function file(
  id: string,
  name: string,
  parent: string | undefined,
  mimeType: string,
  overrides: Partial<GoogleDriveApiFile> = {},
): GoogleDriveApiFile {
  return {
    id,
    name,
    mimeType,
    parents: parent ? [parent] : undefined,
    modifiedTime: "2026-04-24T09:00:00.000Z",
    size: "10",
    ...overrides,
  };
}
