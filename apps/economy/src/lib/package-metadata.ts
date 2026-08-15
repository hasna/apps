import { readFileSync } from 'fs'

type PackageMetadata = {
  name: string
  version: string
}

let cachedMetadata: PackageMetadata | null = null

export function getPackageMetadata(): PackageMetadata {
  if (cachedMetadata) return cachedMetadata

  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  const parsed = JSON.parse(raw) as Partial<PackageMetadata>

  cachedMetadata = {
    name: parsed.name ?? '@hasna/economy',
    version: parsed.version ?? '0.0.0',
  }

  return cachedMetadata
}

export const packageMetadata = getPackageMetadata()
