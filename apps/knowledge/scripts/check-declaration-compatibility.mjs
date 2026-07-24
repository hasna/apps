#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const compiler = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const consumer = join(root, 'tests', 'fixtures', 'public-api-consumer.ts');
const pinned = readFileSync(join(root, 'tests', 'fixtures', 'generated-api-e1eed58.d.ts'), 'utf8');
const committed = readFileSync(join(root, 'dist', 'generated', 'knowledge-api-client.d.ts'), 'utf8');
if (committed !== pinned.replace(/^\/\/ Pinned public declarations[^\n]*\n/, '')) {
  throw new Error('committed generated declaration differs from the pinned e1eed58 fixture');
}

function compile(label, paths) {
  const temporary = mkdtempSync(join(tmpdir(), `knowledge-declarations-${label}-`));
  try {
    const config = join(temporary, 'tsconfig.json');
    writeFileSync(config, `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2022', 'DOM'],
        types: ['bun'],
        typeRoots: [join(root, 'node_modules', '@types')],
        strict: false,
        skipLibCheck: false,
        noEmit: true,
        baseUrl: root,
        ignoreDeprecations: '6.0',
        paths,
      },
      files: [consumer],
    }, null, 2)}\n`);
    const result = Bun.spawnSync(['bun', compiler, '-p', config], {
      cwd: root,
      env: { ...process.env, BUN_CONFIG_INSTALL_AUTO: 'disable' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) {
      const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;
      throw new Error(`${label} declaration consumer failed:\n${output}`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

compile('source', {
  '@hasna/knowledge': ['./src/index.ts'],
  '@hasna/knowledge-generated': ['./src/generated/knowledge-api-client.ts'],
  '@hasna/knowledge-artifact': ['./src/artifact-store.ts'],
  '@hasna/knowledge-auth': ['./src/auth.ts'],
  '@hasna/knowledge-providers': ['./src/providers.ts'],
  '@hasna/knowledge-remote': ['./src/remote-client.ts'],
  '@hasna/knowledge-service': ['./src/service.ts'],
  '@hasna/knowledge-storage': ['./src/storage.ts'],
  '@hasna/knowledge-storage-sync': ['./src/db/storage-sync.ts'],
  '@hasna/knowledge-remote-storage': ['./src/db/remote-storage.ts'],
  '@hasna/knowledge-storage-kit': ['./src/generated/storage-kit/index.ts'],
  '@hasna/knowledge-serve': ['./src/serve.ts'],
  '@hasna/knowledge-db': ['./src/knowledge-db.ts'],
  '@hasna/knowledge-store': ['./src/store.ts'],
  '@hasna/knowledge-outbox': ['./src/outbox-consume.ts'],
});
compile('committed', {
  '@hasna/knowledge': ['./dist/index.d.ts'],
  '@hasna/knowledge-generated': ['./dist/generated/knowledge-api-client.d.ts'],
  '@hasna/knowledge-artifact': ['./dist/artifact-store.d.ts'],
  '@hasna/knowledge-auth': ['./dist/auth.d.ts'],
  '@hasna/knowledge-providers': ['./dist/providers.d.ts'],
  '@hasna/knowledge-remote': ['./dist/remote-client.d.ts'],
  '@hasna/knowledge-service': ['./dist/service.d.ts'],
  '@hasna/knowledge-storage': ['./dist/storage.d.ts'],
  '@hasna/knowledge-storage-sync': ['./dist/db/storage-sync.d.ts'],
  '@hasna/knowledge-remote-storage': ['./dist/db/remote-storage.d.ts'],
  '@hasna/knowledge-storage-kit': ['./dist/generated/storage-kit/index.d.ts'],
  '@hasna/knowledge-serve': ['./dist/serve.d.ts'],
  '@hasna/knowledge-db': ['./dist/knowledge-db.d.ts'],
  '@hasna/knowledge-store': ['./dist/store.d.ts'],
  '@hasna/knowledge-outbox': ['./dist/outbox-consume.d.ts'],
});
console.log('[knowledge] source and committed declaration consumers compiled');
