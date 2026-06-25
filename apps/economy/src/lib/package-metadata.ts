import { readFileSync } from 'fs'

type PackageMetadata = {
  name: string
  version: string
}

let cachedMetadata: PackageMetadata | null = null

function readPackageMetadata(): Partial<PackageMetadata> {
  const candidates = [
    new URL('../package.json', import.meta.url),
    new URL('../../package.json', import.meta.url),
    new URL('../../../package.json', import.meta.url),
  ]

  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8')) as Partial<PackageMetadata>
    } catch {
      // Bundled entrypoints live at different depths under dist.
    }
  }

  return {}
}

export function getPackageMetadata(): PackageMetadata {
  if (cachedMetadata) return cachedMetadata

  const parsed = readPackageMetadata()

  cachedMetadata = {
    name: parsed.name ?? '@hasna/economy',
    version: parsed.version ?? '0.0.0',
  }

  return cachedMetadata
}

export const packageMetadata = getPackageMetadata()
