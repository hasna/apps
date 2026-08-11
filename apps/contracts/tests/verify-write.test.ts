/**
 * Two-sided fixtures for verify-write.
 *
 * Every fetched payload is an in-memory fixture. Nothing here reaches a forge,
 * API, credential store, or shared data surface.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContractsProgram } from "../src/cli/index";
import { runVerifyWriteCli } from "../src/cli/verify-write";
import type { CapturedRead } from "../src/safe-read";
import { verifyFetchedWrite } from "../src/verify-write";

const scratch = mkdtempSync(join(tmpdir(), "contracts-verify-write-test-"));

function authored(name: string, content: string): string {
  const path = join(scratch, name);
  writeFileSync(path, content);
  return path;
}

function captured(value: unknown, stderr = "", code = 0): CapturedRead {
  return { stdout: JSON.stringify(value), stderr, code };
}

function invoke(
  target: string,
  authoredPath: string,
  fetch: CapturedRead,
  options: { idPath?: string; contentPath?: string; json?: boolean } = {}
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runVerifyWriteCli(
    target,
    ["fixture", "fetch"],
    { authored: authoredPath, ...options },
    { log: (line) => stdout.push(line), err: (line) => stderr.push(line) },
    () => fetch
  );
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

describe("verify-write", () => {
  test("byte-identical stored content reports MATCH", () => {
    const body = "authored payload\n";
    const result = invoke(
      "target-0001",
      authored("match.txt", body),
      captured({ id: "target-0001", body })
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      "MATCH — fetched object ID equals requested ID; 17 bytes; SHA-256 equal; stored body NOT rendered"
    );
    expect(result.stderr).toBe("");
  });

  test("an appended footer reports growth without rendering the footer on either stream", () => {
    const body = "authored payload\n";
    const footer = "SIGNED-CAPABILITY-FOOTER";
    const result = invoke(
      "target-0001",
      authored("growth.txt", body),
      captured({ id: "target-0001", body: `${body}${footer}` })
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      `GREW BY ${Buffer.byteLength(footer)} BYTES — third-party content appended, ${Buffer.byteLength(footer)} bytes, NOT rendered`
    );
    expect(result.stdout).not.toContain(footer);
    expect(result.stderr).not.toContain(footer);
  });

  test("a same-length wrong object refuses before MATCH or GROWTH", () => {
    const body = "same-length-body";
    const result = invoke(
      "target-0001",
      authored("wrong-object.txt", body),
      captured({ id: "target-0002", body })
    );

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("REFUSED [object_id_mismatch]");
    expect(result.stderr).not.toContain("MATCH");
    expect(result.stderr).not.toContain("GREW BY");
    expect(result.stderr).not.toContain(body);
  });

  test("object identity is checked before stored content is accessed", () => {
    let contentReads = 0;
    const fetched = {
      id: "target-0002",
      get body() {
        contentReads += 1;
        throw new Error("stored content must not be touched for the wrong object");
      }
    };

    const result = verifyFetchedWrite({
      targetId: "target-0001",
      authored: Buffer.from("same-length-body"),
      fetched,
      idPath: "id",
      contentPath: "body"
    });

    expect(result).toEqual({
      ok: false,
      status: "refused",
      code: "object_id_mismatch",
      message: "fetched object ID did not equal requested ID; stored body NOT rendered"
    });
    expect(contentReads).toBe(0);
  });

  test("an unfetchable target refuses and never renders captured output", () => {
    const body = "authored payload";
    const capability = "SIGNED-CAPABILITY-IN-FETCH-ERROR";
    const result = invoke(
      "target-0001",
      authored("unfetchable.txt", body),
      { stdout: capability, stderr: capability, code: 1 }
    );

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("REFUSED [fetch_failed]");
    expect(result.stderr).not.toContain(capability);
    expect(result.stderr).not.toContain(body);
  });

  test("shorter and same-length-different content remain distinguishable without rendering content", () => {
    const body = "abcdefgh";
    const shrink = invoke(
      "target-0001",
      authored("shrink.txt", body),
      captured({ id: "target-0001", body: "abc" })
    );
    const changed = invoke(
      "target-0001",
      authored("changed.txt", body),
      captured({ id: "target-0001", body: "ijklmnop" })
    );

    expect(shrink.code).toBe(1);
    expect(shrink.stderr).toBe("SHRANK BY 5 BYTES — stored content is shorter, NOT rendered");
    expect(changed.code).toBe(1);
    expect(changed.stderr).toBe(
      "MISMATCH — byte length equal but SHA-256 differs; stored body NOT rendered"
    );
    for (const stream of [shrink.stdout, shrink.stderr, changed.stdout, changed.stderr]) {
      expect(stream).not.toContain(body);
      expect(stream).not.toContain("ijklmnop");
    }
  });

  test("JSON output is metadata-only", () => {
    const body = "PAYLOAD-CONTENT-SECRET";
    const footer = "APPENDED-CAPABILITY";
    const result = invoke(
      "target-0001",
      authored("json.txt", body),
      captured({ result: { object_id: "target-0001", content: `${body}${footer}` } }),
      { idPath: "result.object_id", contentPath: "result.content", json: true }
    );

    expect(result.code).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload).toEqual({
      ok: false,
      status: "grew",
      authoredBytes: Buffer.byteLength(body),
      storedBytes: Buffer.byteLength(body + footer),
      deltaBytes: Buffer.byteLength(footer),
      hashesEqual: false,
      message: `third-party content appended, ${Buffer.byteLength(footer)} bytes, NOT rendered`
    });
    expect(result.stdout).not.toContain(body);
    expect(result.stdout).not.toContain(footer);
    expect(result.stderr).toBe("");
  });

  test("the command help leads with the cheaper workflow and exposes no verbose mode", () => {
    const command = createContractsProgram().commands.find((candidate) => candidate.name() === "verify-write");
    expect(command).toBeDefined();
    expect(command!.description()).toStartWith("Cheaper than rendering a stored body");
    expect(command!.description()).toContain("capability");
    expect(command!.options.map((option) => option.long)).not.toContain("--verbose");
  });
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});
