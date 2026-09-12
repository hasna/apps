// Machine registry routes.
//
// The machines table is the only domain in mementos that had no hosted route:
// every client read and write went to the on-box SQLite file, so a station's
// machine list, its primary-machine choice and the machine-visibility filter
// on memories were per-machine state that no other machine could see — the
// exact split-brain the cloud store exists to prevent.
//
// The identity of the CALLING machine (hostname, platform) cannot be observed
// here — inside the container `hostname()` is the task id — so registration
// takes them from the request body and the server never guesses.

import {
  registerMachineRecord,
  listMachines,
  getMachine,
  renameMachine,
  setPrimaryMachine,
  deleteMachine,
  touchMachine,
} from "../../db/machines.js";
import { addRoute } from "../router.js";
import { json, errorResponse, readJson } from "../helpers.js";

/** Map a domain throw onto the status the client contract expects. */
function machineError(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  if (/^Machine not found/.test(message)) return errorResponse(message, 404);
  if (/already taken|cannot be deleted/.test(message)) return errorResponse(message, 409);
  return errorResponse(message, 500);
}

// POST /api/machines — register (idempotent by hostname), returns the machine
addRoute("POST", "/api/machines", async (req) => {
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  const host = body["hostname"];
  const plat = body["platform"];
  if (typeof host !== "string" || !host.trim()) {
    return errorResponse("hostname is required (the calling machine's, not the server's)", 400);
  }
  if (typeof plat !== "string" || !plat.trim()) {
    return errorResponse("platform is required (the calling machine's, not the server's)", 400);
  }
  const name = typeof body["name"] === "string" ? (body["name"] as string) : undefined;
  try {
    const machine = registerMachineRecord({ name, hostname: host, platform: plat });
    return json(machine, 201);
  } catch (e) {
    return machineError(e);
  }
});

// GET /api/machines — list, primary first
addRoute("GET", "/api/machines", () => {
  const machines = listMachines();
  return json({ machines, count: machines.length });
});

// GET /api/machines/:id — by id or name
addRoute("GET", "/api/machines/:id", (_req, _url, params) => {
  const machine = getMachine(params["id"]!);
  if (!machine) return errorResponse(`Machine not found: ${params["id"]}`, 404);
  return json(machine);
});

// PATCH /api/machines/:id — rename
addRoute("PATCH", "/api/machines/:id", async (req, _url, params) => {
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  const name = body["name"];
  if (typeof name !== "string" || !name.trim()) {
    return errorResponse("name is required", 400);
  }
  try {
    return json(renameMachine(params["id"]!, name));
  } catch (e) {
    return machineError(e);
  }
});

// POST /api/machines/:id/primary — make this machine the primary
addRoute("POST", "/api/machines/:id/primary", (_req, _url, params) => {
  try {
    return json(setPrimaryMachine(params["id"]!));
  } catch (e) {
    return machineError(e);
  }
});

// POST /api/machines/:id/touch — refresh last_seen_at (heartbeat)
addRoute("POST", "/api/machines/:id/touch", (_req, _url, params) => {
  const machine = getMachine(params["id"]!);
  if (!machine) return errorResponse(`Machine not found: ${params["id"]}`, 404);
  touchMachine(machine.id);
  return json({ touched: true, id: machine.id });
});

// DELETE /api/machines/:id — refuses the primary machine (409)
addRoute("DELETE", "/api/machines/:id", (_req, _url, params) => {
  try {
    deleteMachine(params["id"]!);
    return json({ deleted: true });
  } catch (e) {
    return machineError(e);
  }
});
