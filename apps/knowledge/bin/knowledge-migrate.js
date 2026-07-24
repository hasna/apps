#!/usr/bin/env bun
// @bun

// src/anchored-fs.ts
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "fs";
var DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
var FILE_READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
var ANCHORED_FILESYSTEM_SUPPORT = Object.freeze({
  supportedPlatforms: ["linux", "darwin"],
  unsupportedBehavior: "fail-closed-before-filesystem-io"
});

// src/input-limits.ts
var DANGEROUS_DATA_KEYS = new Set(["__proto__", "prototype", "constructor"]);

// src/runtime-role.ts
var MAX_KNOWLEDGE_DIAGNOSTIC_BYTES = 384;
var CONTAINMENT_MESSAGES = {
  KNOWLEDGE_RUNTIME_INTENT_INVALID: "runtime intent was rejected before Knowledge I/O",
  KNOWLEDGE_CONFIG_INVALID: "configuration was rejected before Knowledge I/O",
  KNOWLEDGE_HOSTED_CONTAINED: "hosted capability is unavailable during Stage A",
  KNOWLEDGE_AUTHORITY_UNAVAILABLE: "trusted authority is unavailable during Stage A",
  KNOWLEDGE_PROJECT_FORBIDDEN: "project authority denied Knowledge access",
  KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED: "positive hosted authority is disabled during Stage A",
  KNOWLEDGE_OPERATOR_REQUIRED: "operator capability is required for this operation"
};

class KnowledgeContainmentError extends Error {
  code;
  status;
  role;
  surface;
  name = "KnowledgeContainmentError";
  constructor(code, status, role, surface, _detail) {
    const message = `${code}: ${CONTAINMENT_MESSAGES[code]}`;
    super(Buffer.byteLength(message) <= MAX_KNOWLEDGE_DIAGNOSTIC_BYTES ? message : `${code}: contained`);
    this.code = code;
    this.status = status;
    this.role = role;
    this.surface = surface;
  }
  toJSON() {
    const payload = {
      ok: false,
      code: this.code,
      status: this.status,
      role: this.role,
      surface: this.surface,
      message: this.message
    };
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_KNOWLEDGE_DIAGNOSTIC_BYTES) {
      return { ...payload, message: `${this.code}: contained` };
    }
    return payload;
  }
}

// src/migrate-entry.ts
function mainKnowledgeMigrationEntry() {
  throw new KnowledgeContainmentError("KNOWLEDGE_OPERATOR_REQUIRED", 503, "invalid", "operator-migration", "cloud migrations require a private supervised operator artifact that is not published");
}
if (import.meta.main) {
  try {
    mainKnowledgeMigrationEntry();
  } catch (error) {
    if (error instanceof KnowledgeContainmentError) {
      console.error(JSON.stringify(error.toJSON()));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
export {
  mainKnowledgeMigrationEntry
};
