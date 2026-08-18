import { describe, it, expect, beforeAll, beforeEach, mock, spyOn, afterAll } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { setConfigPath, setConfig } from "../../core/config";

// ---------------------------------------------------------------------------
// Mock modules for command-level tests
// ---------------------------------------------------------------------------

const mockDbInsert = mock((_att: unknown) => {});
const mockDbFindById = mock((_id: string) => null as unknown);
const mockDbMarkReady = mock((_input: unknown) => {});
const mockDbCreateShareLink = mock((_input: unknown) => ({ token: "share_token" }));
const mockDbDelete = mock((_id: string) => {});
const mockDbClose = mock(() => {});

mock.module("../../core/db", () => ({
  AttachmentsDB: class MockAttachmentsDB {
    constructor(_path?: string) {}
    insert = mockDbInsert;
    findById = mockDbFindById;
    markReady = mockDbMarkReady;
    createShareLink = mockDbCreateShareLink;
    delete = mockDbDelete;
    close = mockDbClose;
    findAll = mock(() => []);
    updateLink = mock(() => {});
    deleteExpired = mock(() => 0);
  },
}));

const mockPresignPut = mock(async (_key: string, _contentType: string, _expiresIn: number) =>
  "https://s3.example.com/put-presigned?sig=abc"
);
const mockPresign = mock(async (_key: string, _expiresIn: number) => "https://s3.example.com/get-presigned?sig=ready");
const mockHead = mock(async (_key: string) => ({ contentLength: 4096, contentType: "application/pdf" }));
const mockS3Delete = mock(async (_key: string) => {});

mock.module("../../core/s3", () => ({
  S3Client: class MockS3Client {
    constructor(_cfg: unknown) {}
    presignPut = mockPresignPut;
    presign = mockPresign;
    head = mockHead;
    upload = mock(async () => {});
    download = mock(async () => Buffer.from(""));
    delete = mockS3Delete;
  },
}));

// Hosted (/v1) path: resolveStore() returns an ApiStore when the cloud env is
// present, which must route presign through the API transport, not the
// local-only gate. The mock mirrors the real resolver's env flip.
const mockV1PresignUpload = mock(
  async (_filename: string, _contentType: string | undefined, _expiryMs: number) => ({
    id: "att_cloud1",
    uploadUrl: "https://bucket.example.com/put?X-Amz-Signature=cloud",
    contentType: "application/pdf",
    filename: "report.pdf",
  }),
);
const mockV1PresignComplete = mock(async (_id: string, _opts: object) => ({
  attachment: {
    id: "att_cloud1",
    filename: "report.pdf",
    s3Key: "attachments/2026-08-18/att_cloud1/report.pdf",
    bucket: "cloud",
    size: 4096,
    contentType: "application/pdf",
    link: "https://has.na/a/abc",
    expiresAt: Date.now() + 3600000,
    createdAt: Date.now(),
    storageBackend: "s3",
    status: "ready",
  },
  link: "https://has.na/a/abc",
  size: 4096,
}));

mock.module("../../core/cloud-v1", () => ({
  resolveAttachmentsV1: (env: NodeJS.ProcessEnv) => {
    if (env.HASNA_ATTACHMENTS_API_URL && env.HASNA_ATTACHMENTS_API_KEY) {
      return {
        transport: "cloud-http",
        store: { presignUpload: mockV1PresignUpload, presignComplete: mockV1PresignComplete },
      };
    }
    return { transport: "local", store: null };
  },
}));

// Use real config module pointed at a temp file
let _presignTestConfigDir: string;
beforeAll(() => {
  _presignTestConfigDir = join(tmpdir(), `presign-test-cfg-${Date.now()}`);
  mkdirSync(_presignTestConfigDir, { recursive: true });
  setConfigPath(join(_presignTestConfigDir, "config.json"));
  setConfig({
    s3: { bucket: "test-bucket", region: "us-east-1", accessKeyId: "K", secretAccessKey: "S" },
    server: { port: 3459, baseUrl: "http://localhost:3459" },
    defaults: { expiry: "7d", linkType: "presigned" },
  });
});

afterAll(() => {
  mock.restore();
  try { rmSync(_presignTestConfigDir, { recursive: true, force: true }); } catch {}
});

// Import after mocks
const { presignUploadCommand, presignCompleteCommand } = await import("./presign");

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildPresignCmd() {
  const { Command } = require("commander") as typeof import("commander");
  const program = new Command();
  program.exitOverride();
  program.addCommand(presignUploadCommand());
  program.addCommand(presignCompleteCommand());
  return program;
}

function captureOutput() {
  const out: string[] = [];
  const err: string[] = [];
  const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  const stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  return {
    out,
    err,
    restore() {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    },
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("presign-upload command", () => {
  beforeEach(() => {
    mockDbInsert.mockReset();
    mockDbFindById.mockReset();
    mockDbMarkReady.mockReset();
    mockDbCreateShareLink.mockReset();
    mockDbDelete.mockReset();
    mockDbClose.mockReset();
    mockPresignPut.mockReset();
    mockPresign.mockReset();
    mockHead.mockReset();
    mockS3Delete.mockReset();
    mockPresignPut.mockImplementation(async () => "https://s3.example.com/put-presigned?sig=abc");
    mockPresign.mockImplementation(async () => "https://s3.example.com/get-presigned?sig=ready");
    mockHead.mockImplementation(async () => ({ contentLength: 4096, contentType: "application/pdf" }));
    mockDbCreateShareLink.mockImplementation(() => ({ token: "share_token" }));
    mockS3Delete.mockImplementation(async () => {});
  });

  it("generates presigned URL and outputs upload info", async () => {
    const capture = captureOutput();
    try {
      const program = buildPresignCmd();
      await program.parseAsync(["presign-upload", "report.pdf"], { from: "user" });
      const out = capture.out.join("");
      expect(out).toContain("Upload URL:");
      expect(out).toContain("https://s3.example.com/put-presigned?sig=abc");
      expect(out).toContain("ID: att_");
      expect(out).toContain("Finalize: attachments presign-complete att_");
      expect(out).toContain("curl -X PUT");
    } finally {
      capture.restore();
    }
  });

  it("calls s3.presignPut with correct parameters", async () => {
    const capture = captureOutput();
    try {
      const program = buildPresignCmd();
      await program.parseAsync(["presign-upload", "report.pdf", "--expiry", "2h"], { from: "user" });
      expect(mockPresignPut).toHaveBeenCalledTimes(1);
      const [key, contentType, expiresIn] = mockPresignPut.mock.calls[0] as [string, string, number];
      expect(key).toMatch(/^attachments\/\d{4}-\d{2}-\d{2}\/att_[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.pdf$/);
      expect(contentType).toBe("application/pdf");
      expect(expiresIn).toBe(7200); // 2h in seconds
    } finally {
      capture.restore();
    }
  });

  it("inserts a DB record with size 0", async () => {
    const capture = captureOutput();
    try {
      const program = buildPresignCmd();
      await program.parseAsync(["presign-upload", "data.csv"], { from: "user" });
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
      const [att] = mockDbInsert.mock.calls[0] as [{ size: number; filename: string; contentType: string }];
      expect(att.size).toBe(0);
      expect(att.filename).toBe("data.csv");
      expect(att.contentType).toBe("text/csv");
    } finally {
      capture.restore();
    }
  });

  it("uses custom content-type when provided", async () => {
    const capture = captureOutput();
    try {
      const program = buildPresignCmd();
      await program.parseAsync(["presign-upload", "file.bin", "--content-type", "application/octet-stream"], { from: "user" });
      const [key, contentType] = mockPresignPut.mock.calls[0] as [string, string, number];
      expect(contentType).toBe("application/octet-stream");
    } finally {
      capture.restore();
    }
  });

  it("defaults expiry to 1h", async () => {
    const capture = captureOutput();
    try {
      const program = buildPresignCmd();
      await program.parseAsync(["presign-upload", "file.txt"], { from: "user" });
      const [, , expiresIn] = mockPresignPut.mock.calls[0] as [string, string, number];
      expect(expiresIn).toBe(3600); // 1h in seconds
    } finally {
      capture.restore();
    }
  });

  it("exits with error for invalid expiry format", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error("process.exit called");
    });
    const capture = captureOutput();

    try {
      const program = buildPresignCmd();
      await expect(
        program.parseAsync(["presign-upload", "file.txt", "--expiry", "invalid"], { from: "user" })
      ).rejects.toThrow("process.exit called");
      expect(capture.err.join("")).toContain("Invalid expiry format");
    } finally {
      capture.restore();
      exitSpy.mockRestore();
    }
  });

  it("closes the database after insert", async () => {
    const capture = captureOutput();
    try {
      const program = buildPresignCmd();
      await program.parseAsync(["presign-upload", "test.png"], { from: "user" });
      expect(mockDbClose).toHaveBeenCalled();
    } finally {
      capture.restore();
    }
  });

  it("finalizes a pending upload and generates a presigned download link", async () => {
    mockDbFindById.mockImplementation(() => ({
      id: "att_pending",
      filename: "report.pdf",
      s3Key: "attachments/2026-06-19/att_pending/report.pdf",
      bucket: "test-bucket",
      size: 0,
      contentType: "application/pdf",
      link: null,
      tag: null,
      expiresAt: Date.now() + 3600000,
      createdAt: Date.now(),
      storageBackend: "s3",
      status: "pending",
    }));

    const capture = captureOutput();
    try {
      const program = buildPresignCmd();
      await program.parseAsync(["presign-complete", "att_pending"], { from: "user" });
      const out = capture.out.join("");
      expect(mockHead).toHaveBeenCalledWith("attachments/2026-06-19/att_pending/report.pdf");
      expect(mockPresign).toHaveBeenCalled();
      expect(mockDbMarkReady).toHaveBeenCalledWith(expect.objectContaining({
        id: "att_pending",
        size: 4096,
        contentType: "application/pdf",
        link: "https://s3.example.com/get-presigned?sig=ready",
      }));
      expect(out).toContain("Link:     https://s3.example.com/get-presigned?sig=ready");
    } finally {
      capture.restore();
    }
  });

  it("finalizes to a protected server link when max downloads are set", async () => {
    mockDbFindById.mockImplementation(() => ({
      id: "att_pending",
      filename: "report.pdf",
      s3Key: "attachments/2026-06-19/att_pending/report.pdf",
      bucket: "test-bucket",
      size: 0,
      contentType: "application/pdf",
      link: null,
      tag: null,
      expiresAt: Date.now() + 3600000,
      createdAt: Date.now(),
      storageBackend: "s3",
      status: "pending",
    }));

    const capture = captureOutput();
    try {
      const program = buildPresignCmd();
      await program.parseAsync(["presign-complete", "att_pending", "--max-downloads", "1", "--brief"], { from: "user" });
      expect(mockDbCreateShareLink).toHaveBeenCalledWith(expect.objectContaining({
        attachmentId: "att_pending",
        maxUses: 1,
      }));
      expect(mockPresign).not.toHaveBeenCalled();
      expect(capture.out.join("")).toBe("http://localhost:3459/a/share_token\n");
    } finally {
      capture.restore();
    }
  });

  it("removes the object and pending record when finalization exceeds the max size", async () => {
    mockDbFindById.mockImplementation(() => ({
      id: "att_pending",
      filename: "huge.bin",
      s3Key: "attachments/2026-06-19/att_pending/huge.bin",
      bucket: "test-bucket",
      size: 0,
      contentType: "application/octet-stream",
      link: null,
      tag: null,
      expiresAt: Date.now() + 3600000,
      createdAt: Date.now(),
      storageBackend: "s3",
      status: "pending",
    }));
    mockHead.mockImplementation(async () => ({ contentLength: 11 * 1024 * 1024 * 1024, contentType: "application/octet-stream" }));
    const exitSpy = spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error("process.exit called");
    });
    const capture = captureOutput();

    try {
      const program = buildPresignCmd();
      await expect(
        program.parseAsync(["presign-complete", "att_pending"], { from: "user" })
      ).rejects.toThrow("process.exit called");
      expect(mockS3Delete).toHaveBeenCalledWith("attachments/2026-06-19/att_pending/huge.bin");
      expect(mockDbDelete).toHaveBeenCalledWith("att_pending");
      expect(capture.err.join("")).toContain("File too large");
    } finally {
      capture.restore();
      exitSpy.mockRestore();
    }
  });
});
// ─── hosted (/v1) backend ──────────────────────────────────────────────────

function withCloudEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prevUrl = process.env.HASNA_ATTACHMENTS_API_URL;
  const prevKey = process.env.HASNA_ATTACHMENTS_API_KEY;
  process.env.HASNA_ATTACHMENTS_API_URL = "https://attachments.example.com";
  process.env.HASNA_ATTACHMENTS_API_KEY = "k";
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevUrl === undefined) delete process.env.HASNA_ATTACHMENTS_API_URL;
      else process.env.HASNA_ATTACHMENTS_API_URL = prevUrl;
      if (prevKey === undefined) delete process.env.HASNA_ATTACHMENTS_API_KEY;
      else process.env.HASNA_ATTACHMENTS_API_KEY = prevKey;
    });
}

describe("presign commands on the hosted (/v1) backend", () => {
  it("presign-upload works on the hosted route (no local-only gate)", async () => {
    mockV1PresignUpload.mockClear();
    const capture = captureOutput();
    try {
      await withCloudEnv(async () => {
        const program = buildPresignCmd();
        await program.parseAsync(["presign-upload", "report.pdf", "--expiry", "2h"], { from: "user" });
      });
      const out = capture.out.join("");
      expect(out).toContain("Upload URL: https://bucket.example.com/put?X-Amz-Signature=cloud");
      expect(out).toContain("ID: att_cloud1");
      expect(mockV1PresignUpload).toHaveBeenCalledTimes(1);
      const [filename, contentType, expiryMs] = mockV1PresignUpload.mock.calls[0] as [string, string, number];
      expect(filename).toBe("report.pdf");
      // Content-type detection happens inside the store (local mime lookup, or
      // the /v1 server), not in the CLI — the command passes the raw option.
      expect(contentType).toBeUndefined();
      expect(expiryMs).toBe(7200000);
    } finally {
      capture.restore();
    }
  });

  it("presign-complete works on the hosted route and prints the link", async () => {
    mockV1PresignComplete.mockClear();
    const capture = captureOutput();
    try {
      await withCloudEnv(async () => {
        const program = buildPresignCmd();
        await program.parseAsync(["presign-complete", "att_cloud1"], { from: "user" });
      });
      const out = capture.out.join("");
      expect(out).toContain("Link:     https://has.na/a/abc");
      expect(mockV1PresignComplete).toHaveBeenCalledTimes(1);
      const [id, opts] = mockV1PresignComplete.mock.calls[0] as [string, { linkType: string }];
      expect(id).toBe("att_cloud1");
      expect(opts.linkType).toBe("presigned");
    } finally {
      capture.restore();
    }
  });
});
