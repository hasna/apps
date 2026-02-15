import { REGISTRY_API_URL } from "./config.js";
import { addServer } from "./registry.js";
import type { RegistryServer, RegistryServerEntry, McpServerEntry } from "../types.js";

function parseRegistryEntry(entry: RegistryServerEntry): RegistryServer {
  const s = entry.server;
  return {
    id: s.name,
    name: s.name,
    description: s.description || "",
    repository: s.repository,
    packages: s.packages || [],
  };
}

export async function searchRegistry(query: string): Promise<RegistryServer[]> {
  const res = await fetch(REGISTRY_API_URL);
  if (!res.ok) {
    throw new Error(`Registry API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { servers: RegistryServerEntry[] };
  const entries = data.servers || [];
  const q = query.toLowerCase();

  return entries
    .map(parseRegistryEntry)
    .filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
    );
}

export async function getRegistryServer(id: string): Promise<RegistryServer | null> {
  const res = await fetch(REGISTRY_API_URL);
  if (!res.ok) {
    throw new Error(`Registry API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { servers: RegistryServerEntry[] };
  const entries = data.servers || [];
  const all = entries.map(parseRegistryEntry);

  return all.find((s) => s.id === id) || null;
}

export async function installFromRegistry(id: string): Promise<McpServerEntry> {
  const server = await getRegistryServer(id);
  if (!server) {
    throw new Error(`Server "${id}" not found in registry`);
  }

  const pkg = server.packages?.[0];
  let command = "npx";
  let args: string[] = [];
  let transport: "stdio" | "sse" | "streamable-http" = "stdio";

  if (pkg) {
    if (pkg.registryType === "npm") {
      command = "npx";
      args = ["-y", pkg.identifier];
    } else {
      command = pkg.identifier;
    }
    if (pkg.transport?.type) {
      transport = pkg.transport.type as typeof transport;
    }
  }

  return addServer({
    name: server.name,
    description: server.description,
    command,
    args,
    transport,
    source: "registry",
  });
}
