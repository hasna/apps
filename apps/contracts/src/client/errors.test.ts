import { describe, expect, test } from "bun:test";
import {
  CLIENT_RESOLUTION_CODES,
  CLIENT_RESOLUTION_CODE_DESCRIPTIONS,
  CLIENT_RESOLUTION_EXIT_CODES,
  ClientResolutionError,
  clientResolutionCodeOf,
  clientResolutionExitCode,
  exitCodeForClientResolutionCode,
  formatClientResolutionFailure,
  isClientResolutionCode,
  isClientResolutionError,
} from "./errors.js";
import { CredentialFileUnsafeError, CredentialResolutionError } from "./credentials.js";
import { ClientTransportConfigurationError, HasnaHttpError } from "./transport.js";

describe("client resolution error taxonomy", () => {
  test("the codes and exit codes are the documented, stable table", () => {
    expect(CLIENT_RESOLUTION_CODES).toEqual([
      "CREDENTIAL_ABSENT",
      "CREDENTIAL_UNREADABLE",
      "CREDENTIAL_REJECTED",
      "AUTHORITY_MISSING",
      "AUTHORITY_INVALID",
      "AUTHORITY_CONFLICT",
      "LOCAL_OPT_IN_CONFLICT",
      "TRANSPORT_UNAVAILABLE",
      "NOT_AVAILABLE_HOSTED",
    ]);
    expect(CLIENT_RESOLUTION_EXIT_CODES).toEqual({
      CREDENTIAL_ABSENT: 2,
      CREDENTIAL_UNREADABLE: 3,
      CREDENTIAL_REJECTED: 4,
      AUTHORITY_MISSING: 5,
      AUTHORITY_INVALID: 5,
      AUTHORITY_CONFLICT: 5,
      LOCAL_OPT_IN_CONFLICT: 6,
      TRANSPORT_UNAVAILABLE: 7,
      NOT_AVAILABLE_HOSTED: 8,
    });
    for (const code of CLIENT_RESOLUTION_CODES) {
      expect(exitCodeForClientResolutionCode(code)).toBe(CLIENT_RESOLUTION_EXIT_CODES[code]);
      expect(CLIENT_RESOLUTION_CODE_DESCRIPTIONS[code].length).toBeGreaterThan(10);
      expect(isClientResolutionCode(code)).toBe(true);
    }
    expect(isClientResolutionCode("SOMETHING_ELSE")).toBe(false);
    expect(Object.isFrozen(CLIENT_RESOLUTION_EXIT_CODES)).toBe(true);
  });

  test("carries code, exit code, app, sources and remedy, and serialises exactly those", () => {
    const error = new ClientResolutionError("CREDENTIAL_ABSENT", "todos", "No credential could be resolved.", {
      sources: ["keychain:hasna.credentials.todos.api-key", "/home/u/.hasna/todos/config/credentials"],
      remedy: "Store the key.",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ClientResolutionError");
    expect(error.code).toBe("CREDENTIAL_ABSENT");
    expect(error.exitCode).toBe(2);
    expect(error.app).toBe("todos");
    expect(Object.isFrozen(error.sources)).toBe(true);
    expect(error.toJSON()).toEqual({
      name: "ClientResolutionError",
      code: "CREDENTIAL_ABSENT",
      exitCode: 2,
      app: "todos",
      message: "No credential could be resolved.",
      sources: ["keychain:hasna.credentials.todos.api-key", "/home/u/.hasna/todos/config/credentials"],
      remedy: "Store the key.",
    });
    expect(Object.keys(JSON.parse(JSON.stringify(error))).sort()).toEqual(
      ["app", "code", "exitCode", "message", "name", "remedy", "sources"],
    );
    expect(isClientResolutionError(error)).toBe(true);
    expect(isClientResolutionError(new Error("x"))).toBe(false);
  });

  test("an unknown code is refused at construction", () => {
    expect(() => new ClientResolutionError("NOPE" as never, "todos", "x")).toThrow(TypeError);
  });

  test("codes are read duck-typed so a second bundled copy still classifies", () => {
    expect(clientResolutionCodeOf(new ClientResolutionError("AUTHORITY_INVALID", "todos", "x"))).toBe("AUTHORITY_INVALID");
    expect(clientResolutionCodeOf({ code: "LOCAL_OPT_IN_CONFLICT" })).toBe("LOCAL_OPT_IN_CONFLICT");
    expect(clientResolutionCodeOf({ code: "ENOENT" })).toBeNull();
    expect(clientResolutionCodeOf(new Error("plain"))).toBeNull();
    expect(clientResolutionCodeOf(null)).toBeNull();
    expect(clientResolutionExitCode(new ClientResolutionError("CREDENTIAL_UNREADABLE", "todos", "x"))).toBe(3);
    expect(clientResolutionExitCode(new Error("plain"))).toBe(1);
    expect(clientResolutionExitCode(new Error("plain"), 7)).toBe(7);
  });

  test("formats the one stderr line, or the JSON envelope, without values", () => {
    const error = new ClientResolutionError("CREDENTIAL_UNREADABLE", "todos", "The Keychain lookup\n  failed (security exited 36).", {
      sources: ["keychain:hasna.credentials.todos.api-key@station"],
      remedy: "Unlock the keychain,\nor delete the item.",
    });
    expect(formatClientResolutionFailure(error)).toBe(
      "todos: CREDENTIAL_UNREADABLE: The Keychain lookup failed (security exited 36). Unlock the keychain, or delete the item.",
    );
    expect(formatClientResolutionFailure(error, { app: "todos-mcp" })).toStartWith("todos-mcp: CREDENTIAL_UNREADABLE: ");
    const json = JSON.parse(formatClientResolutionFailure(error, { json: true }));
    expect(json).toMatchObject({ code: "CREDENTIAL_UNREADABLE", exitCode: 3, app: "todos" });
    expect(formatClientResolutionFailure(new ClientResolutionError("CREDENTIAL_ABSENT", null, "x"))).toBe("client: CREDENTIAL_ABSENT: x");
  });

  test("the 1.0.x classes are subclasses carrying codes with byte-stable messages and names", () => {
    const credential = new CredentialResolutionError("todos", "HASNA_TODOS_API_KEY is set but blank; a declared credential never falls through.", ["HASNA_TODOS_API_KEY"]);
    expect(credential).toBeInstanceOf(ClientResolutionError);
    expect(credential).toBeInstanceOf(CredentialResolutionError);
    expect(credential.name).toBe("CredentialResolutionError");
    expect(credential.code).toBe("CREDENTIAL_UNREADABLE");
    expect(credential.exitCode).toBe(3);
    expect(credential.appName).toBe("todos");
    expect(credential.app).toBe("todos");
    expect(credential.attempted).toEqual(["HASNA_TODOS_API_KEY"]);
    expect(credential.sources).toEqual(["HASNA_TODOS_API_KEY"]);
    expect(credential.message).toBe("HASNA_TODOS_API_KEY is set but blank; a declared credential never falls through.");

    const file = new CredentialFileUnsafeError("/tmp/x/credentials", "mode 0644 is not owner-only");
    expect(file).toBeInstanceOf(ClientResolutionError);
    expect(file.name).toBe("CredentialFileUnsafeError");
    expect(file.code).toBe("CREDENTIAL_UNREADABLE");
    expect(file.path).toBe("/tmp/x/credentials");
    expect(file.sources).toEqual(["/tmp/x/credentials"]);
    expect(file.message).toBe("Refusing unsafe credential/config file /tmp/x/credentials: mode 0644 is not owner-only.");

    const transport = new ClientTransportConfigurationError("todos", "HASNA_TODOS_API_URL is set but blank.", ["HASNA_TODOS_API_URL"]);
    expect(transport).toBeInstanceOf(ClientResolutionError);
    expect(transport.name).toBe("ClientTransportConfigurationError");
    expect(transport.code).toBe("AUTHORITY_INVALID");
    expect(transport.exitCode).toBe(5);
    expect(transport.appName).toBe("todos");
    expect(new ClientTransportConfigurationError("todos", "x", [], "CREDENTIAL_ABSENT").exitCode).toBe(2);
  });

  test("HasnaHttpError maps 401/403 to CREDENTIAL_REJECTED and retryable statuses to TRANSPORT_UNAVAILABLE", () => {
    const rejected = new HasnaHttpError("GET", "/tasks", 401, undefined, { source: "HASNA_TODOS_API_KEY", tier: "env", guidance: "Rotate it." });
    expect(rejected.code).toBe("CREDENTIAL_REJECTED");
    expect(rejected.exitCode).toBe(4);
    expect(clientResolutionCodeOf(rejected)).toBe("CREDENTIAL_REJECTED");
    expect(clientResolutionExitCode(rejected)).toBe(4);
    expect(new HasnaHttpError("GET", "/tasks", 403, undefined).code).toBe("CREDENTIAL_REJECTED");
    expect(new HasnaHttpError("GET", "/tasks", 503, "busy").code).toBe("TRANSPORT_UNAVAILABLE");
    expect(new HasnaHttpError("GET", "/tasks", 503, "busy").exitCode).toBe(7);
    expect(new HasnaHttpError("GET", "/tasks", 404, {}).code).toBeNull();
    expect(new HasnaHttpError("GET", "/tasks", 404, {}).exitCode).toBeNull();
    expect(clientResolutionExitCode(new HasnaHttpError("GET", "/tasks", 404, {}))).toBe(1);
  });
});
