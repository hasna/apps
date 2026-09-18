/**
 * Hosted machine registry.
 *
 * Hostname is an account-local registration idempotency key, not an
 * authorization boundary. The server-issued machine id is the stable identity
 * used by every mutation and by memory attribution. A rename never changes the
 * idempotency key, and a repeat registration never renames an existing row.
 */
import {
  MACHINE_LIST_CONTRACT,
  MACHINE_MUTATION_CONTRACT,
  MACHINE_REGISTRATION_CONTRACT,
  MACHINE_TOUCH_CONTRACT,
  MachineRegistryError,
  deleteMachine,
  getMachineById,
  listMachines,
  registerMachineRecord,
  renameMachine,
  setPrimaryMachine,
  touchMachine,
  type Machine,
} from "../../db/machines.js";
import { getDatabase } from "../../db/database.js";
import { addRoute } from "../router.js";
import { json, errorResponse, readJson } from "../helpers.js";

function machineError(error: unknown): Response {
  if (error instanceof MachineRegistryError) {
    const status = error.code === "MACHINE_NOT_FOUND"
      ? 404
      : error.code === "MACHINE_INVALID_INPUT"
        ? 400
        : 409;
    return errorResponse(error.message, status, { code: error.code });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/unique|already taken|constraint/i.test(message)) {
    return errorResponse("Machine registration conflicts with an existing machine identity or name", 409, {
      code: "MACHINE_REGISTRATION_CONFLICT",
    });
  }
  throw error;
}

function machineMutation(machine: Machine) {
  return { contract: MACHINE_MUTATION_CONTRACT, machine };
}

function requestObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

addRoute("POST", "/api/machines", async (req) => {
  const body = requestObject(await readJson(req));
  if (!body) return errorResponse("Request body must be a JSON object", 400);
  const host = body["hostname"];
  const machinePlatform = body["platform"];
  if (typeof host !== "string" || !host.trim()) {
    return errorResponse("hostname is required (the calling machine's, not the server's)", 400);
  }
  if (typeof machinePlatform !== "string" || !machinePlatform.trim()) {
    return errorResponse("platform is required (the calling machine's, not the server's)", 400);
  }
  if (body["name"] !== undefined && typeof body["name"] !== "string") {
    return errorResponse("name must be a string when provided", 400);
  }
  try {
    const result = registerMachineRecord({
      hostname: host,
      platform: machinePlatform,
      ...(typeof body["name"] === "string" ? { name: body["name"] } : {}),
    });
    return json({
      contract: MACHINE_REGISTRATION_CONTRACT,
      machine: result.machine,
      created: result.created,
      identity: {
        idempotency_key: "normalized_hostname",
        stable_id: result.machine.id,
      },
    }, result.created ? 201 : 200);
  } catch (error) {
    return machineError(error);
  }
});

addRoute("GET", "/api/machines", () => {
  const machines = listMachines();
  return json({ contract: MACHINE_LIST_CONTRACT, machines, count: machines.length, complete: true });
});

// Stable machine id only. Display names are not mutation identities.
addRoute("GET", "/api/machines/:id", (_req, _url, params) => {
  const id = params["id"]!;
  const machine = getMachineById(id, getDatabase());
  if (!machine || machine.id !== id) {
    return errorResponse(`Machine not found: ${id}`, 404, { code: "MACHINE_NOT_FOUND" });
  }
  return json(machineMutation(machine));
});

addRoute("PATCH", "/api/machines/:id", async (req, _url, params) => {
  const body = requestObject(await readJson(req));
  if (!body) return errorResponse("Request body must be a JSON object", 400);
  if (typeof body["name"] !== "string" || !body["name"].trim()) {
    return errorResponse("name is required", 400);
  }
  try {
    return json(machineMutation(renameMachine(params["id"]!, body["name"])));
  } catch (error) {
    return machineError(error);
  }
});

addRoute("POST", "/api/machines/:id/primary", (_req, _url, params) => {
  try {
    return json(machineMutation(setPrimaryMachine(params["id"]!)));
  } catch (error) {
    return machineError(error);
  }
});

addRoute("POST", "/api/machines/:id/touch", (_req, _url, params) => {
  try {
    const machine = touchMachine(params["id"]!);
    return json({
      contract: MACHINE_TOUCH_CONTRACT,
      touched: true,
      id: machine.id,
      touched_at: machine.last_seen_at,
      machine,
    });
  } catch (error) {
    return machineError(error);
  }
});

addRoute("DELETE", "/api/machines/:id", (_req, _url, params) => {
  try {
    deleteMachine(params["id"]!);
    return json({ contract: MACHINE_MUTATION_CONTRACT, deleted: true, id: params["id"]! });
  } catch (error) {
    return machineError(error);
  }
});
