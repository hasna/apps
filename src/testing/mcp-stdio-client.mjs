import { spawn } from "node:child_process";

const RESPONSE_TIMEOUT_MS = 3_000;
const EXIT_TIMEOUT_MS = 1_500;

function responseKey(id) {
  return `${typeof id}:${String(id)}`;
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function writeMessages(stream, messages) {
  const payload = `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
  await new Promise((resolve, reject) => {
    stream.write(payload, (error) => error ? reject(error) : resolve());
  });
}

async function main() {
  const messages = JSON.parse(process.argv[2] ?? "[]");
  if (!Array.isArray(messages) || messages.length === 0 || messages[0]?.method !== "initialize") {
    throw new Error("MCP test session must start with an initialize request");
  }

  const child = spawn("bun", ["run", "src/mcp/index.ts"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.pipe(process.stderr);

  const responses = [];
  const received = new Map();
  const waiters = new Map();
  let buffered = "";
  let fatalError;

  const fail = (error) => {
    if (fatalError) return;
    fatalError = error instanceof Error ? error : new Error(String(error));
    for (const waiter of waiters.values()) waiter.reject(fatalError);
    waiters.clear();
    child.kill();
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    while (true) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) break;
      const line = buffered.slice(0, newline).replace(/\r$/, "");
      buffered = buffered.slice(newline + 1);
      if (!line) {
        fail(new Error("MCP server emitted an empty response frame"));
        return;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        fail(new Error("MCP server emitted malformed JSON-RPC"));
        return;
      }
      responses.push(line);
      if (!("id" in message)) continue;
      const key = responseKey(message.id);
      received.set(key, message);
      const waiter = waiters.get(key);
      if (waiter) {
        waiters.delete(key);
        waiter.resolve(message);
      }
    }
  });
  child.stdout.on("error", fail);
  child.stdin.on("error", fail);
  child.on("error", fail);

  const exitPromise = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      if (waiters.size > 0) {
        fail(new Error(`MCP server exited before all responses (code=${code}, signal=${signal})`));
      }
      resolve({ code, signal });
    });
  });

  const waitForResponse = (id) => {
    const key = responseKey(id);
    if (received.has(key)) return Promise.resolve(received.get(key));
    const response = new Promise((resolve, reject) => waiters.set(key, { resolve, reject }));
    return withTimeout(response, RESPONSE_TIMEOUT_MS, `Timed out waiting for MCP response ${String(id)}`);
  };

  try {
    const initialize = messages[0];
    const initializeResponse = waitForResponse(initialize.id);
    await writeMessages(child.stdin, [initialize]);
    await initializeResponse;

    const remaining = messages.slice(1);
    const responsePromises = remaining
      .filter((message) => Object.prototype.hasOwnProperty.call(message, "id"))
      .map((message) => waitForResponse(message.id));
    if (remaining.length > 0) await writeMessages(child.stdin, remaining);
    await Promise.all(responsePromises);

    child.stdin.end();
    const exit = await withTimeout(exitPromise, EXIT_TIMEOUT_MS, "MCP server did not exit after stdin closed");
    if (fatalError) throw fatalError;
    if (buffered.length > 0) throw new Error("MCP server emitted a truncated JSON-RPC response");
    if (exit.code !== 0) throw new Error(`MCP server exited with code ${exit.code}`);
    process.stdout.write(`${responses.join("\n")}\n`);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exitPromise;
    throw error;
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
