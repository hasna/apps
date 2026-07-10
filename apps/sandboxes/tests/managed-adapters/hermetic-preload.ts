const ambientProviderOrSandboxConfig = /^(?:E2B_|DAYTONA_|SANDBOXES_|HASNA_|AWS_|AZURE_|GOOGLE_|VAULT_|DATABASE_URL$|POSTGRES|PG[A-Z_]*$|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$|NODE_EXTRA_CA_CERTS$)/i

for (const name of Object.keys(process.env)) {
  if (ambientProviderOrSandboxConfig.test(name)) {
    delete process.env[name]
  }
}

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (input: string | URL | Request): Promise<Response> => {
    throw new Error(`hermetic_test_forbids_network:${String(input)}`)
  },
  writable: true,
})

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
