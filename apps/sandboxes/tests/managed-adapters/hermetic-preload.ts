import { createRequire } from "node:module"

const ambientProviderOrSandboxConfig = /^(?:E2B_|DAYTONA_|SANDBOXES_|HASNA_|AWS_|AZURE_|GOOGLE_|VAULT_|DATABASE_URL$|POSTGRES|PG[A-Z_]*$|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$|NODE_EXTRA_CA_CERTS$)/i

for (const name of Object.keys(process.env)) {
  if (ambientProviderOrSandboxConfig.test(name)) {
    delete process.env[name]
  }
}

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (): Promise<Response> => {
    throw new Error("hermetic_test_forbids_network")
  },
  writable: true,
})

function forbidHermeticIO(): never {
  throw new Error("hermetic_test_forbids_host_io")
}

function replaceMethod(target: Record<string, unknown>, key: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (descriptor?.configurable === true || descriptor?.writable === true) {
    Object.defineProperty(target, key, {
      ...descriptor,
      value: forbidHermeticIO,
    })
  }
}

const require = createRequire(import.meta.url)
const blockedMethods: ReadonlyArray<[string, readonly string[]]> = [
  ["node:http", ["get", "request"]],
  ["node:https", ["get", "request"]],
  ["node:net", ["connect", "createConnection", "createServer"]],
  ["node:tls", ["connect", "createServer"]],
  ["node:dgram", ["createSocket"]],
  ["node:dns", ["lookup", "resolve", "resolve4", "resolve6"]],
  ["node:child_process", ["exec", "execFile", "fork", "spawn", "execSync", "execFileSync", "spawnSync"]],
]

for (const [moduleName, methods] of blockedMethods) {
  const module = require(moduleName) as Record<string, unknown>
  for (const method of methods) replaceMethod(module, method)
}

Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  value: class HermeticWebSocket {
    constructor() {
      throw new Error("hermetic_test_forbids_websocket")
    }
  },
  writable: true,
})

if (typeof Bun !== "undefined") {
  const descriptor = Object.getOwnPropertyDescriptor(Bun, "connect")
  if (descriptor?.writable === true) {
    Object.defineProperty(Bun, "connect", {
      ...descriptor,
      value: async (): Promise<never> => {
        throw new Error("hermetic_test_forbids_socket")
      },
    })
  }
}
