import { expect,test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const helper=resolve(import.meta.dir,'../../scripts/native-core-receipt.py');
const setup=`import importlib.util,io,json,tarfile
spec=importlib.util.spec_from_file_location('receipt',${JSON.stringify(helper)})
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
core='package/src/native/Recordings/'
files={'package/package.json':json.dumps({'name':'@hasna/recordings','version':'0.4.0'}).encode(),
 core+'Package.swift':b'// swift-tools-version: 6.2\\n.library(name: "RecordingsLib", targets: ["RecordingsLib"]), .macOS(.v26)',
 core+'Package.resolved':b'{"pins":[]}',core+'RecordingsLib/RecordingEngine.swift':b'fixture engine',
 core+'RecordingsLib/RecordingProvider.swift':b'fixture provider'}
def archive(entries=None,link=None):
 out=io.BytesIO()
 with tarfile.open(fileobj=out,mode='w:gz') as t:
  for name,data in (entries or files).items():
   info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;t.addfile(info,io.BytesIO(data))
  if link:
   info=tarfile.TarInfo(link);info.type=tarfile.SYMTYPE;info.linkname='/outside';t.addfile(info)
 return out.getvalue()
`;
function run(body:string){
  const result=spawnSync('python3',['-I','-B','-c',setup+body],{encoding:'utf8',timeout:15000});
  expect(result.stderr).toBe('');expect(result.status).toBe(0);
}
test('native receipt binds exact archive bytes, source files, version and Swift product',()=>run(`
a=r.create_receipt(archive(),'a'*40)
assert a['distribution']['status']=='prepared'
assert a['package']['version']=='0.4.0'
assert a['native']['product']=='RecordingsLib'
assert len(a['native']['files'])==4
assert a['archive']['integrity'].startswith('sha512-')
assert len(a['native']['treeSHA256'])==64
b=r.create_receipt(archive({**files,core+'RecordingsLib/RecordingEngine.swift':b'changed'}),'a'*40)
assert b['archive']['sha256']!=a['archive']['sha256']
assert b['native']['treeSHA256']!=a['native']['treeSHA256']
`));
for(const kind of ['missing-product','missing-provider','wrong-package','path-escape','symlink','invalid-revision'])test(`native receipt refuses ${kind}`,()=>run(`
entries=dict(files);revision='a'*40;link=None
kind=${JSON.stringify(kind)}
if kind=='missing-product': entries[core+'Package.swift']=b'// swift-tools-version: 6.2\\n.macOS(.v26)'
if kind=='missing-provider': del entries[core+'RecordingsLib/RecordingProvider.swift']
if kind=='wrong-package': entries['package/package.json']=b'{"name":"@example/other","version":"0.4.0"}'
if kind=='path-escape': entries['package/../escape']=b'unsafe'
if kind=='symlink': link=core+'RecordingsLib/escape'
if kind=='invalid-revision': revision='main'
try: r.create_receipt(archive(entries,link),revision)
except ValueError: pass
else: raise RuntimeError('unsafe receipt accepted')
`));
test('registry verification requires matching immutable metadata and downloaded archive bytes',()=>run(`
blob=archive();receipt=r.create_receipt(blob,'a'*40)
metadata={'name':'@hasna/recordings','version':'0.4.0','dist':{'tarball':receipt['archive']['url'],'integrity':receipt['archive']['integrity']}}
r.verify_registry(receipt,lambda url:json.dumps(metadata).encode() if not url.endswith('.tgz') else blob)
assert receipt['distribution']['status']=='published'
for broken in ['metadata','archive']:
 receipt=r.create_receipt(blob,'a'*40)
 def fetch(url):
  if url.endswith('.tgz'): return b'changed' if broken=='archive' else blob
  return json.dumps({**metadata,'version':'0.0.0'} if broken=='metadata' else metadata).encode()
 try: r.verify_registry(receipt,fetch)
 except ValueError: pass
 else: raise RuntimeError('registry mismatch accepted')
 assert receipt['distribution']['status']=='prepared'
`));
test('source verification rejects wrong release metadata or changed native bytes',()=>run(`
from types import SimpleNamespace
import gzip
receipt=r.create_receipt(archive(),'a'*40)
source={name.replace('package/','apps/recordings/',1):data for name,data in files.items()}
r.subprocess.run=lambda *args,**kwargs:SimpleNamespace(stdout=gzip.decompress(archive(source)))
r.verify_source(receipt,'.')
for path in ['apps/recordings/package.json','apps/recordings/src/native/Recordings/RecordingsLib/RecordingEngine.swift']:
 changed={**source,path:b'{"name":"@hasna/recordings","version":"0.0.0"}' if path.endswith('package.json') else b'changed'}
 r.subprocess.run=lambda *args,**kwargs:SimpleNamespace(stdout=gzip.decompress(archive(changed)))
 try: r.verify_source(receipt,'.')
 except ValueError: pass
 else: raise RuntimeError('source mismatch accepted')
`));
