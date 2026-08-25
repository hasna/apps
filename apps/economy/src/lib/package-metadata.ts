import packageJson from '../../package.json'

type PackageMetadata = {
  name: string
  version: string
}

let cachedMetadata: PackageMetadata | null = null

export function getPackageMetadata(): PackageMetadata {
  if (cachedMetadata) return cachedMetadata

  cachedMetadata = {
    name: packageJson.name ?? '@hasna/economy',
    version: packageJson.version ?? '0.0.0',
  }

  return cachedMetadata
}

export const packageMetadata = getPackageMetadata()
