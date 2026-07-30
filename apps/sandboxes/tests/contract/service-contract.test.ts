import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * `hasna.contract.json` is the repo's self-description for the Hasna service
 * contract. Nothing else in the suite reads it, so before this file the manifest
 * could be malformed, fabricate capabilities, or claim endpoints that return 404
 * and `bun run test` stayed green — the change was unfalsifiable.
 *
 * Every assertion below is checked against the repo itself (package.json bins and
 * exports, the source tree) rather than against a restatement of the manifest, so
 * a manifest that drifts from reality turns this file red.
 */

const repoRoot = join(import.meta.dir, "..", "..")

interface PackageJson {
  name: string
  bin?: Record<string, string>
  exports?: Record<string, unknown>
  scripts?: Record<string, string>
}

interface ServiceSurface {
  name?: unknown
  kind?: unknown
  status?: unknown
  authMode?: unknown
  bin?: unknown
  mcpBin?: unknown
  exportSubpath?: unknown
  health?: { method?: unknown; path?: unknown }
  readiness?: { method?: unknown; path?: unknown }
  version?: { method?: unknown; path?: unknown }
}

interface Manifest {
  schema?: unknown
  name?: unknown
  class?: unknown
  contractVersion?: unknown
  kitVersion?: unknown
  bins?: unknown
  hosting?: unknown
  storage?: { mode?: unknown; engines?: unknown; envPrefix?: unknown }
  serviceSurfaces?: unknown
  metadata?: { release?: { artifactScan?: { script?: unknown } } }
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as T
}

function sourceFiles(directory: string): string[] {
  const collected: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      collected.push(...sourceFiles(path))
      continue
    }
    if (/\.(?:ts|tsx|mts|cts|js|mjs|cjs|py)$/.test(entry)) collected.push(path)
  }
  return collected
}

function sourceMatches(pattern: RegExp): string[] {
  return sourceFiles(join(repoRoot, "src")).filter((path) => pattern.test(readFileSync(path, "utf8")))
}

const manifest = readJson<Manifest>("hasna.contract.json")
const pkg = readJson<PackageJson>("package.json")
const packageBins = Object.keys(pkg.bin ?? {})
const surfaces: ServiceSurface[] = Array.isArray(manifest.serviceSurfaces)
  ? (manifest.serviceSurfaces as ServiceSurface[])
  : []

const APP_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const REPO_CLASSES = ["library", "cli-with-store", "service", "saas"]
const HOSTING_STORIES = ["user-hosted", "hasna-saas"]
const SURFACE_KINDS = ["api", "sdk", "mcp", "cli"]
const SURFACE_STATUSES = ["supported", "deferred", "unsupported"]
const AUTH_MODES = ["none", "local-only", "api-key", "session", "service-token", "custom"]
const STORAGE_MODES = ["sqlite", "postgres"]

describe("hasna.contract.json declares the v1 envelope", () => {
  test("the schema id and contract version are the literals the kit requires", () => {
    expect(manifest.schema).toBe("hasna.service_contract.v1")
    expect(manifest.contractVersion).toBe("v1")
    expect(typeof manifest.kitVersion).toBe("string")
    expect((manifest.kitVersion as string).length).toBeGreaterThan(0)
  })

  test("name is the lowercase dashed app short-name, not the scoped package name", () => {
    expect(typeof manifest.name).toBe("string")
    expect(manifest.name as string).toMatch(APP_NAME_PATTERN)
    expect(manifest.name).toBe(pkg.name.replace(/^@[^/]+\//, ""))
  })

  test("class is an enum member the declared bins actually permit", () => {
    expect(REPO_CLASSES).toContain(manifest.class as string)
    const shipsMcpBin = packageBins.includes(`${manifest.name}-mcp`)
    const shipsServeBin = packageBins.includes(`${manifest.name}-serve`)
    // A library must not ship a -mcp bin, and service/saas must ship -serve.
    if (shipsMcpBin) expect(manifest.class).not.toBe("library")
    if (!shipsServeBin) {
      expect(manifest.class).not.toBe("service")
      expect(manifest.class).not.toBe("saas")
    }
  })
})

describe("hosting carries the product story, not the daemon bind address", () => {
  test("hosting is a non-empty array drawn from the product-story enum", () => {
    expect(Array.isArray(manifest.hosting)).toBe(true)
    const hosting = manifest.hosting as unknown[]
    expect(hosting.length).toBeGreaterThan(0)
    for (const story of hosting) expect(HOSTING_STORIES).toContain(story as string)
    expect(new Set(hosting).size).toBe(hosting.length)
  })

  test("the public OSS core declares the user-hosted story", () => {
    expect(manifest.hosting as unknown[]).toContain("user-hosted")
  })
})

describe("bins and service surfaces bind to things package.json really ships", () => {
  test("declared bins match package.json bin exactly", () => {
    expect(manifest.bins).toEqual(packageBins)
  })

  test("declared bins stay inside the allowlist for the app name", () => {
    const allowed = new Set(
      ["", "-cli", "-mcp", "-serve", "-worker", "-runner", "-daemon", "-migrate", "-doctor"].map(
        (suffix) => `${manifest.name}${suffix}`,
      ),
    )
    for (const bin of manifest.bins as string[]) expect([...allowed]).toContain(bin)
  })

  test("every service surface is an object with the required keys", () => {
    expect(surfaces.length).toBeGreaterThan(0)
    for (const surface of surfaces) {
      expect(typeof surface).toBe("object")
      expect(typeof surface.name).toBe("string")
      expect(SURFACE_STATUSES).toContain(surface.status as string)
      expect(AUTH_MODES).toContain(surface.authMode as string)
      if (surface.kind !== undefined) expect(SURFACE_KINDS).toContain(surface.kind as string)
    }
  })

  test("surface bins and mcpBins exist in package.json bin", () => {
    for (const surface of surfaces) {
      if (typeof surface.bin === "string") expect(packageBins).toContain(surface.bin)
      if (typeof surface.mcpBin === "string") expect(packageBins).toContain(surface.mcpBin)
    }
  })

  test("a supported sdk surface points at a real package export subpath", () => {
    const exportSubpaths = Object.keys(pkg.exports ?? {})
    for (const surface of surfaces) {
      if (surface.kind !== "sdk" || surface.status !== "supported") continue
      expect(typeof surface.exportSubpath).toBe("string")
      expect(exportSubpaths).toContain(surface.exportSubpath as string)
    }
  })

  test("the CLI and MCP bins the repo ships are each declared as a surface", () => {
    const supportedKinds = new Set(
      surfaces.filter((surface) => surface.status === "supported").map((surface) => surface.kind),
    )
    expect(supportedKinds).toContain("cli")
    if (packageBins.includes(`${manifest.name}-mcp`)) expect(supportedKinds).toContain("mcp")
  })
})

describe("declarations do not outrun the implementation", () => {
  test("a supported api surface requires a serve bin and real health endpoints", () => {
    // The 1.0.0 rebuild deleted the sandboxes-serve HTTP server. Declaring an api
    // surface again must come with the bin and the three GET routes, or the
    // manifest is asserting endpoints that return 404.
    const apiSurfaces = surfaces.filter(
      (surface) => surface.kind === "api" && surface.status === "supported",
    )
    for (const surface of apiSurfaces) {
      expect(packageBins).toContain(`${manifest.name}-serve`)
      for (const [endpoint, path] of [
        [surface.health, "/health"],
        [surface.readiness, "/ready"],
        [surface.version, "/version"],
      ] as const) {
        expect(endpoint?.method).toBe("GET")
        expect(endpoint?.path).toBe(path)
      }
      expect(sourceMatches(new RegExp(String.raw`["'\`]${surface.version?.path}`)).length).toBeGreaterThan(0)
    }
  })

  test("storage.mode is one of the two backends the kit allows", () => {
    expect(manifest.storage).toBeDefined()
    expect(STORAGE_MODES).toContain(manifest.storage?.mode as string)
  })

  test("a declared sqlite engine requires SQLite code in src/", () => {
    const engines = Array.isArray(manifest.storage?.engines) ? (manifest.storage?.engines as string[]) : []
    if (engines.includes("sqlite")) {
      expect(sourceMatches(/sqlite/i).length).toBeGreaterThan(0)
    } else {
      // Positive control: the claim is absent because the capability is absent.
      expect(sourceMatches(/sqlite/i)).toEqual([])
    }
  })

  test("a declared storage.envPrefix is read somewhere in src/", () => {
    const envPrefix = manifest.storage?.envPrefix
    if (typeof envPrefix !== "string") return
    expect(sourceMatches(new RegExp(envPrefix)).length).toBeGreaterThan(0)
  })
})

describe("the release gate the manifest names is wired up", () => {
  test("metadata.release.artifactScan.script names a real, non-empty package script", () => {
    const script = manifest.metadata?.release?.artifactScan?.script
    expect(typeof script).toBe("string")
    const body = (pkg.scripts ?? {})[script as string]
    expect(typeof body).toBe("string")
    expect((body as string).trim().length).toBeGreaterThan(0)
  })

  test("prepack reaches the artifact scan so publishing cannot skip it", () => {
    const script = manifest.metadata?.release?.artifactScan?.script as string
    const prepack = (pkg.scripts ?? {}).prepack
    expect(typeof prepack).toBe("string")
    expect(prepack as string).toContain(script)
  })

  test("the artifact scan guards against pack/prepack recursion", () => {
    // `bun pm pack` runs prepack, and prepack runs the scan, which packs again.
    // Both halves of the guard must be present or publishing never terminates.
    const prepack = (pkg.scripts ?? {}).prepack as string
    const scanScript = readFileSync(join(repoRoot, "scripts", "package-smoke.sh"), "utf8")
    expect(prepack).toContain("SANDBOXES_ARTIFACT_SCAN_ACTIVE")
    expect(scanScript).toContain("SANDBOXES_ARTIFACT_SCAN_ACTIVE=1")
  })
})
