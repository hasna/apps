import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import { resolve } from "node:path";
import type { Machine } from "../types/index.js";
import { validateMachines, type MachineRegistryInput, type MachineRegistryReceipt } from "../storage/machine-registry.js";

const UPGRADE = "REMOTE_API_INCOMPATIBLE: upgrade the Todos server to support the shared machine registry; no local database was opened or migration applied";
interface MachineAuthority { tenant_id: string; kid: string }
function receipt(raw: unknown): MachineRegistryReceipt & { authority: MachineAuthority } {
  if (!raw || typeof raw !== "object" || (raw as { schema_version?: unknown }).schema_version !== 2) throw new Error(UPGRADE);
  const authority = (raw as { authority?: MachineAuthority }).authority;
  if (!authority || typeof authority.tenant_id !== "string" || !authority.tenant_id || typeof authority.kid !== "string" || !authority.kid) throw new Error(UPGRADE);
  validateMachines((raw as { machines?: unknown }).machines);
  return raw as MachineRegistryReceipt & { authority: MachineAuthority };
}
export async function cloudMachines(client: HasnaStorageClient): Promise<Machine[]> {
  try { return receipt(await client.transport.get<unknown>("/machines")).machines; }
  catch (error) {
    const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode;
    if ([404,405,501].includes(status ?? 0)) throw new Error(UPGRADE);
    throw error;
  }
}
export function localMachineOptions(options: Record<string, unknown> = {}): Record<string, unknown> {
  const normalized = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  if (typeof normalized.workspace_path === "string") normalized.workspace_path = resolve(normalized.workspace_path);
  return normalized;
}
export async function cloudMachineAction(client: HasnaStorageClient, input: MachineRegistryInput): Promise<MachineRegistryReceipt> {
  if (input.action === "import") validateMachines(input.machines);
  const frozenUrl = client.baseUrl;
  const transport = client.transport;
  // Keep one transport/URL, and bind POST to the exact authenticated key/tenant
  // seen during preflight. The transport may refresh saved credentials per call.
  let capability;
  try { capability = receipt(await transport.get<unknown>("/machines")); }
  catch (error) {
    const status = (error as {status?:number}).status;
    if ([404,405,501].includes(status ?? 0)) throw new Error(UPGRADE);
    throw error;
  }
  const expected = { ...capability.authority };
  if (client.baseUrl !== frozenUrl || client.transport !== transport) throw new Error("Machine migration authority changed before POST; nothing was submitted");
  const result = receipt(await transport.post<unknown>("/machines", { ...input, expected_authority: expected }));
  if (result.authority.kid !== expected.kid || result.authority.tenant_id !== expected.tenant_id) throw new Error("Machine receipt authority changed; preserve source and inspect before retrying");
  if (input.action === "import") {
    const expected = validateMachines(input.machines);
    // Verify every field, including archived/primary and original timestamps.
    const { isDeepStrictEqual } = await import("node:util");
    for (const row of expected) if (!isDeepStrictEqual(result.machines.find(item => item.id === row.id), row)) throw new Error("Machine import receipt failed exact readback; preserve source and inspect the server before retrying");
  } else if (input.action === "delete") {
    if (result.deleted !== true) throw new Error("Machine deletion was not confirmed");
  } else if (!result.machine || !result.machines.some(row => row.id === result.machine!.id)) throw new Error("Machine operation was not confirmed");
  return result;
}
