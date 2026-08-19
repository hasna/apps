#!/usr/bin/env node
"use strict";

// Secrets Vault — native messaging host.
//
// Chrome starts this host (via the com.hasna.secrets host manifest) and speaks
// the native-messaging protocol: each message is a 4-byte little-endian length
// followed by that many UTF-8 JSON bytes.
//
// The host is a THIN SHELL over the user's own `secrets` CLI. It never holds,
// embeds, or echoes credential values of its own: every verb translates to one
// CLI invocation, and only the CLI's stdout is forwarded (wrapped in the
// response envelope). If the user's local session is already authenticated —
// the `secrets` CLI resolves its own store — the extension never prompts.
//
// ENV RESOLUTION (the host must work with NO PATH): Chrome launches this host
// through the manifest with the environment launchd gives it, and launchd's
// PATH is EMPTY (measured on station03: `launchctl getenv PATH` is empty;
// node and the secrets CLI live only under /Users/hasna/.bun/bin). Two things
// make that work:
//
//   1. install-host.sh materializes an installed copy of this file whose
//      FIRST LINE is the absolute node binary, so the kernel does not need
//      `env` to find node.
//   2. install-host.sh writes host-config.json (next to the installed copy)
//      embedding the ABSOLUTE path of the `secrets` CLI. This host spawns
//      that exact binary — never a PATH lookup — and prepends the CLI's own
//      directory to the child's PATH, so the CLI's interpreter (bun, which
//      lives in the same directory) resolves without an inherited PATH.
//
// Without host-config.json (a dev checkout run from a shell), the host falls
// back to resolving `secrets` from the parent's PATH, exactly as before.
//
// Fail-closed contract: any malformed message, unknown verb, missing CLI, or
// failing invocation yields an explicit { ok:false, error } response. Silence
// is not a valid answer.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** Load the installed host config (absolute secrets CLI path), if present. */
function loadHostConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, "host-config.json"), "utf8"));
    if (parsed && typeof parsed.secretsCli === "string" && parsed.secretsCli.length > 0) {
      return { secretsCli: parsed.secretsCli };
    }
  } catch {
    /* no config: dev mode, resolve `secrets` from PATH */
  }
  return {};
}

const HOST_CONFIG = loadHostConfig();
const CLI_BIN = HOST_CONFIG.secretsCli || "secrets";

const MAX_MESSAGE_BYTES = 64 * 1024;
const CLI_TIMEOUT_MS = 20_000;
const VERBS = new Set(["auth-status", "search", "get", "add-login"]);

function encodeFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

/** Run `secrets <args>` with the host's own environment; return stdout/stderr/rc. */
function runCli(args, timeoutMs = CLI_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let child;
    const childEnv = { ...process.env };
    if (HOST_CONFIG.secretsCli) {
      // Chrome's launchd-inherited PATH is empty, and the installed `secrets`
      // CLI is a `#!/usr/bin/env bun` wrapper whose interpreter lives in the
      // same directory. Prepending the CLI's own directory makes that
      // interpreter resolvable without the parent's PATH.
      const cliDir = path.dirname(CLI_BIN);
      const inherited = typeof childEnv.PATH === "string" && childEnv.PATH.length > 0 ? childEnv.PATH : "";
      childEnv.PATH = [cliDir, inherited].filter(Boolean).join(":");
    }
    try {
      child = spawn(CLI_BIN, args, {
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ missing: true, code: null, stdout: "", stderr: String((err && err.message) || err) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ missing: false, code: null, timeout: true, stdout, stderr });
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const missing = err && (err.code === "ENOENT" || /ENOENT/.test(String(err.code || err.message || "")));
      resolve({ missing, code: null, stdout, stderr: String((err && err.message) || err) });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ missing: false, code, stdout, stderr });
    });
  });
}

function firstLine(s) {
  const line = String(s || "").split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return line ? line.slice(0, 300) : "";
}

function isNonEmptyString(v, max = 4096) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

async function handleAuthStatus() {
  const r = await runCli(["items", "list", "--json"]);
  if (r.missing) {
    return { ok: false, error: `E_CLI_NOT_FOUND: the secrets CLI could not be launched (${CLI_BIN})` };
  }
  if (r.timeout) {
    return { ok: false, error: "E_CLI_TIMEOUT: the secrets CLI did not answer in time" };
  }
  if (r.code !== 0) {
    return {
      ok: false,
      error: `E_AUTH: the secrets CLI could not open the vault (${firstLine(r.stderr) || "exit " + r.code})`,
    };
  }
  const mode = process.env.HASNA_SECRETS_API_URL ? "api" : "local";
  return { ok: true, data: { authenticated: true, mode } };
}

async function handleSearch(msg) {
  if (!isNonEmptyString(msg.query, 200)) {
    return { ok: false, error: "E_BAD_MESSAGE: search.query must be a non-empty string" };
  }
  const r = await runCli(["items", "search", msg.query, "--json"]);
  if (r.missing) return { ok: false, error: `E_CLI_NOT_FOUND: the secrets CLI could not be launched (${CLI_BIN})` };
  if (r.timeout) return { ok: false, error: "E_CLI_TIMEOUT: the secrets CLI did not answer in time" };
  if (r.code !== 0) {
    return { ok: false, error: `E_CLI: items search failed (${firstLine(r.stderr) || "exit " + r.code})` };
  }
  let items;
  try {
    items = JSON.parse(r.stdout);
    if (!Array.isArray(items)) throw new Error("not an array");
  } catch {
    return { ok: false, error: "E_CLI_OUTPUT: items search returned unparseable output" };
  }
  return { ok: true, data: { items } };
}

async function handleGet(msg) {
  if (!isNonEmptyString(msg.id, 200)) {
    return { ok: false, error: "E_BAD_MESSAGE: get.id must be a non-empty string" };
  }
  // --show is the CLI's documented decrypted-output flag; the value travels
  // only through this runtime response, never into host storage.
  const r = await runCli(["items", "get", msg.id, "--show"]);
  if (r.missing) return { ok: false, error: `E_CLI_NOT_FOUND: the secrets CLI could not be launched (${CLI_BIN})` };
  if (r.timeout) return { ok: false, error: "E_CLI_TIMEOUT: the secrets CLI did not answer in time" };
  if (r.code !== 0) {
    const line = firstLine(r.stderr);
    if (/not found/i.test(line)) {
      return { ok: false, error: `E_NOT_FOUND: no vault item ${msg.id}` };
    }
    return { ok: false, error: `E_CLI: items get failed (${line || "exit " + r.code})` };
  }
  let item;
  try {
    item = JSON.parse(r.stdout);
  } catch {
    return { ok: false, error: "E_CLI_OUTPUT: items get returned unparseable output" };
  }
  return { ok: true, data: { item } };
}

async function handleAddLogin(msg) {
  for (const field of ["title", "username", "password"]) {
    if (!isNonEmptyString(msg[field])) {
      return { ok: false, error: `E_BAD_MESSAGE: add-login.${field} must be a non-empty string` };
    }
  }
  if (msg.url !== undefined && !isNonEmptyString(msg.url, 2048)) {
    return { ok: false, error: "E_BAD_MESSAGE: add-login.url must be a string" };
  }
  const args = [
    "items",
    "add-login",
    "--title",
    msg.title,
    "--url",
    msg.url || "",
    "--username",
    msg.username,
    "--password",
    msg.password,
  ];
  const r = await runCli(args);
  if (r.missing) return { ok: false, error: `E_CLI_NOT_FOUND: the secrets CLI could not be launched (${CLI_BIN})` };
  if (r.timeout) return { ok: false, error: "E_CLI_TIMEOUT: the secrets CLI did not answer in time" };
  if (r.code !== 0) {
    return { ok: false, error: `E_CLI: items add-login failed (${firstLine(r.stderr) || "exit " + r.code})` };
  }
  const match = /Stored vault item:\s*([^\s\[]+)/.exec(r.stdout);
  const id = match ? match[1] : null;
  if (!id) return { ok: false, error: "E_CLI_OUTPUT: could not read the stored item id" };
  return { ok: true, data: { id } };
}

async function dispatch(msg) {
  if (msg === null || typeof msg !== "object" || Array.isArray(msg) || typeof msg.verb !== "string") {
    return { ok: false, error: "E_BAD_MESSAGE: expected an object with a string verb" };
  }
  if (!VERBS.has(msg.verb)) {
    return { ok: false, error: `E_VERB: unknown verb '${String(msg.verb).slice(0, 64)}'` };
  }
  try {
    switch (msg.verb) {
      case "auth-status":
        return await handleAuthStatus();
      case "search":
        return await handleSearch(msg);
      case "get":
        return await handleGet(msg);
      case "add-login":
        return await handleAddLogin(msg);
      default:
        return { ok: false, error: `E_VERB: unknown verb '${msg.verb}'` };
    }
  } catch (err) {
    return { ok: false, error: `E_INTERNAL: ${String((err && err.message) || err).slice(0, 200)}` };
  }
}

// Chrome speaks the native-messaging wire protocol: 4-byte little-endian
// length prefix + UTF-8 JSON payload. Frames are processed in order; responses
// are written in the same order the requests arrived.
let inbox = Buffer.alloc(0);
let queue = Promise.resolve();
let pending = 0;

function handleFrame(body) {
  let msg;
  try {
    msg = JSON.parse(body);
  } catch {
    process.stdout.write(encodeFrame({ ok: false, error: "E_BAD_MESSAGE: malformed JSON" }));
    return Promise.resolve();
  }
  return dispatch(msg).then((response) => {
    process.stdout.write(encodeFrame(response));
  });
}

process.stdin.on("data", (chunk) => {
  inbox = Buffer.concat([inbox, chunk]);
  while (inbox.length >= 4) {
    const len = inbox.readUInt32LE(0);
    if (len > MAX_MESSAGE_BYTES) {
      // Oversized frame: drop the connection rather than buffer it.
      process.stdout.write(
        encodeFrame({ ok: false, error: "E_BAD_MESSAGE: message exceeds the size bound" }),
      );
      process.exit(1);
    }
    if (inbox.length < 4 + len) break;
    const body = inbox.subarray(4, 4 + len).toString("utf8");
    inbox = inbox.subarray(4 + len);
    pending += 1;
    queue = queue
      .then(() => handleFrame(body))
      .catch((err) => {
        try {
          process.stdout.write(
            encodeFrame({ ok: false, error: `E_INTERNAL: ${String((err && err.message) || err).slice(0, 200)}` }),
          );
        } catch {
          /* protocol already broken */
        }
      })
      .finally(() => {
        pending -= 1;
      });
  }
});

process.stdin.on("end", () => {
  // Exit once every in-flight request has been answered.
  const wait = setInterval(() => {
    if (pending === 0) {
      clearInterval(wait);
      process.exit(0);
    }
  }, 25);
});
