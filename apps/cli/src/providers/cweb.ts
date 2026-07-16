import type { HasnaProvider } from './types.js'

export const cwebProvider: HasnaProvider = {
  id: 'cweb',
  manifest: {
    schema: 'hasna.app_manifest.v1',
    id: 'cweb',
    name: 'Hasna Company Website',
    version: '1.1.0',
    provider: 'builtin:cweb',
    description: 'Company website authentication and careers management',
    capabilities: ['auth', 'apps.lifecycle', 'careers.jobs', 'careers.applications'],
    api: { openApiPath: '/api/v1/openapi.json', minimumVersion: '1.1.0' },
    execution: 'none',
  },
}

export const builtinProviders = new Map([[cwebProvider.id, cwebProvider]])
