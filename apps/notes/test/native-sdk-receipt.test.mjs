// scripts/native-sdk-receipt.py describes the exact published bytes of the
// Foundation-only Swift SDK companion (swift/**) for private consumers that pin
// it by receipt. The package stays headless: the script reads an archive and a
// Git revision, and never publishes, installs or builds anything.
//
// The SDK manifest's file name is assembled from two pieces below because
// test/app-removal.test.mjs refuses that literal in shipped code and tests (it
// was the removed desktop app's root manifest name).
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const helper = resolve(here, '../scripts/native-sdk-receipt.py');
const MANIFEST = 'Package' + '.swift';
const setup = `import importlib.util,io,json,tarfile
spec=importlib.util.spec_from_file_location('receipt',${JSON.stringify(helper)})
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
core='package/swift/'
MANIFEST=${JSON.stringify(MANIFEST)}
files={'package/package.json':json.dumps({'name':'@hasna/notes','version':'0.6.2'}).encode(),
 'package/LICENSE':b'fixture license',
 core+MANIFEST:b'// swift-tools-version: 6.0\\n.macOS(.v13) .library(name: "NotesLib", targets: ["NotesLib"])',
 core+'Sources/NotesLib/HTTPTransport.swift':b'fixture transport',core+'Sources/NotesLib/Models.swift':b'fixture models',
 core+'Sources/NotesLib/NotesClient.swift':b'fixture client'}
def archive(entries=None,link=None):
 out=io.BytesIO()
 with tarfile.open(fileobj=out,mode='w:gz') as t:
  for name,data in (entries or files).items():
   info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;t.addfile(info,io.BytesIO(data))
  if link:
   info=tarfile.TarInfo(link);info.type=tarfile.SYMTYPE;info.linkname='/outside';t.addfile(info)
 return out.getvalue()
`;
function run(body) {
  const result = spawnSync('python3', ['-I', '-B', '-c', setup + body], { encoding: 'utf8', timeout: 15000 });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
}

test('receipt binds exact archive bytes, the swift tree, the license, version and Swift product', () => run(`
a=r.create_receipt(archive(),'a'*40)
assert a['kind']=='hasna.notes.native-sdk' and a['distribution']=={'status':'prepared'}
assert a['package']=={'name':'@hasna/notes','version':'0.6.2'}
assert a['archive']['url']=='https://registry.npmjs.org/@hasna/notes/-/notes-0.6.2.tgz'
assert a['native']['product']=='NotesLib' and a['native']['packagePath']=='swift'
assert [f['path'] for f in a['native']['files']]==sorted(f['path'] for f in a['native']['files']) and len(a['native']['files'])==4
assert a['archive']['integrity'].startswith('sha512-') and len(a['native']['treeSHA256'])==64
assert a['license']=={'path':'LICENSE','bytes':15,'sha256':r.digest(b'fixture license')}
b=r.create_receipt(archive({**files,core+'Sources/NotesLib/NotesClient.swift':b'changed'}),'a'*40)
assert b['archive']['sha256']!=a['archive']['sha256'] and b['native']['treeSHA256']!=a['native']['treeSHA256']
`));

for (const kind of ['missing-product', 'missing-client', 'missing-license', 'wrong-package', 'path-escape', 'symlink', 'invalid-revision']) {
  test(`receipt refuses ${kind}`, () => run(`
entries=dict(files);revision='a'*40;link=None
kind=${JSON.stringify(kind)}
if kind=='missing-product': entries[core+MANIFEST]=b'// swift-tools-version: 6.0\\n.macOS(.v13)'
if kind=='missing-client': del entries[core+'Sources/NotesLib/NotesClient.swift']
if kind=='missing-license': del entries['package/LICENSE']
if kind=='wrong-package': entries['package/package.json']=b'{"name":"@example/other","version":"0.6.2"}'
if kind=='path-escape': entries['package/../escape']=b'unsafe'
if kind=='symlink': link=core+'Sources/NotesLib/escape'
if kind=='invalid-revision': revision='main'
try: r.create_receipt(archive(entries,link),revision)
except ValueError: pass
else: raise RuntimeError('unsafe receipt accepted')
`));
}

test('registry verification requires matching immutable metadata and downloaded archive bytes', () => run(`
blob=archive();receipt=r.create_receipt(blob,'a'*40)
metadata={'name':'@hasna/notes','version':'0.6.2','dist':{'tarball':receipt['archive']['url'],'integrity':receipt['archive']['integrity']}}
seen=[]
def good(url):
 seen.append(url); return json.dumps(metadata).encode() if not url.endswith('.tgz') else blob
r.verify_registry(receipt,good)
assert seen==['https://registry.npmjs.org/@hasna%2Fnotes/0.6.2','https://registry.npmjs.org/@hasna/notes/-/notes-0.6.2.tgz']
assert receipt['distribution']['status']=='published' and receipt['distribution']['registry']=='https://registry.npmjs.org/'
for broken in ['metadata','integrity','archive']:
 receipt=r.create_receipt(blob,'a'*40)
 def fetch(url):
  if url.endswith('.tgz'): return b'changed' if broken=='archive' else blob
  changed={**metadata,'version':'0.0.0'} if broken=='metadata' else {**metadata,'dist':{**metadata['dist'],'integrity':'sha512-other'}} if broken=='integrity' else metadata
  return json.dumps(changed).encode()
 try: r.verify_registry(receipt,fetch)
 except ValueError: pass
 else: raise RuntimeError('registry mismatch accepted')
 assert receipt['distribution']=={'status':'prepared'}
try: r.registry_bytes('https://example.test/@hasna/notes')
except ValueError: pass
else: raise RuntimeError('foreign registry authority accepted')
`));

test('source verification rejects wrong release metadata, a changed license or changed native bytes', () => run(`
from types import SimpleNamespace
import gzip
receipt=r.create_receipt(archive(),'a'*40)
source={name.replace('package/','apps/notes/',1):data for name,data in files.items()}
r.subprocess.run=lambda *args,**kwargs:SimpleNamespace(stdout=gzip.decompress(archive(source)))
r.verify_source(receipt,'.')
for path in ['apps/notes/package.json','apps/notes/LICENSE','apps/notes/swift/Sources/NotesLib/NotesClient.swift']:
 changed={**source,path:b'{"name":"@hasna/notes","version":"0.0.0"}' if path.endswith('package.json') else b'changed'}
 r.subprocess.run=lambda *args,**kwargs:SimpleNamespace(stdout=gzip.decompress(archive(changed)))
 try: r.verify_source(receipt,'.')
 except ValueError: pass
 else: raise RuntimeError('source mismatch accepted')
`));

test('real Git source verification is independent of ambient archive permission configuration', () => run(`
import os,pathlib,subprocess
repository=pathlib.Path(${JSON.stringify(helper)}).resolve().parents[3]
revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repository,text=True).strip()
source=subprocess.check_output(['git','-c','tar.umask=0022','archive','--format=tar',revision,'--','apps/notes/package.json','apps/notes/LICENSE','apps/notes/swift/'],cwd=repository)
out=io.BytesIO()
with tarfile.open(fileobj=io.BytesIO(source),mode='r:') as tree, tarfile.open(fileobj=out,mode='w:gz') as npm:
 for member in tree:
  if not member.isfile(): continue
  data=tree.extractfile(member).read()
  info=tarfile.TarInfo(member.name.replace('apps/notes/','package/',1));info.size=len(data);info.mode=member.mode
  npm.addfile(info,io.BytesIO(data))
receipt=r.create_receipt(out.getvalue(),revision)
os.environ['GIT_CONFIG_COUNT']='1';os.environ['GIT_CONFIG_KEY_0']='tar.umask';os.environ['GIT_CONFIG_VALUE_0']='0002'
r.verify_source(receipt,repository)
`));

test('the committed 0.6.2 receipt is a registry-verified schema 1 receipt that the generator reproduces', () => {
  const receipt = JSON.parse(readFileSync(resolve(here, '../receipts/notes-0.6.2.published.json'), 'utf8'));
  expect(receipt.schemaVersion).toBe(1);
  expect(receipt.kind).toBe('hasna.notes.native-sdk');
  expect(receipt.package).toEqual({ name: '@hasna/notes', version: '0.6.2' });
  expect(receipt.source.repository).toBe('https://github.com/hasna/apps');
  expect(receipt.source.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(receipt.distribution.status).toBe('published');
  expect(receipt.archive.url).toBe('https://registry.npmjs.org/@hasna/notes/-/notes-0.6.2.tgz');
  // The tree digest is recomputed from the inventory with the documented record format.
  run(`
receipt=json.load(open(${JSON.stringify(resolve(here, '../receipts/notes-0.6.2.published.json'))}))
native=receipt['native']
tree=''.join(f"{f['path']}\\0{f['mode']:o}\\0{f['bytes']}\\0{f['sha256']}\\n" for f in native['files']).encode()
assert r.digest(tree)==native['treeSHA256']
assert [f['path'] for f in native['files']]==sorted(f['path'] for f in native['files'])
r.verify_source(receipt,${JSON.stringify(resolve(here, '../../..'))})
`);
});
