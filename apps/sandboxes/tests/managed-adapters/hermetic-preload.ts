const ambientProviderOrSandboxConfig = /^(?:E2B_|DAYTONA_|SANDBOXES_|HASNA_.*(?:API|SANDBOX|ENDPOINT|BASE_URL|URL))/i

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
