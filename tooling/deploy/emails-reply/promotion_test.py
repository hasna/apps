import copy,gzip,hashlib,importlib.util,io,json,pathlib,tarfile,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('reply_promotion',ROOT/'promotion.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
g=m.sibling('reply_gate',ROOT/'gate.py')

class ReplyPromotionControls(unittest.TestCase):
 def setUp(self):
  self.rules=m.recipe()
  self.task={'family':'emails-prod','taskRoleArn':m.engine.TASK_ROLE,'executionRoleArn':m.engine.EXEC_ROLE,'containerDefinitions':[{'name':'emails','image':m.engine.REPOSITORY+'@'+m.BASE,'command':['src/server/index.ts'],'environment':[{'name':'EMAILS_MODE','value':'self_hosted'},{'name':'EMAILS_SEARCH_CONCURRENCY','value':'8'},{'name':'UNRELATED','value':'preserve'}],'secrets':[{'name':'DATABASE_URL','valueFrom':'unchanged-ref'}]},{'name':'other','image':'unchanged'}],'taskDefinitionArn':'old','revision':89}
 def layer(self,extra=(),include=True):
  b=io.BytesIO()
  with tarfile.open(fileobj=b,mode='w') as t:
   if include:
    parents=sorted({str(x)for p in m.PATHS for x in pathlib.Path(p).parents if str(x)!='.'})
    for p in parents:
     x=tarfile.TarInfo(p);x.type=tarfile.DIRTYPE;x.mode=0o755;t.addfile(x)
    for p in m.PATHS:
     if p in m.NEW_PATHS:continue
     x=tarfile.TarInfo(p);x.size=4;x.uid,x.gid,x.mode=m.strict.EXPECTED_METADATA[p];t.addfile(x,io.BytesIO(b'old\n'))
   for name,kind,data in extra:
    x=tarfile.TarInfo(name);x.type=kind;x.linkname='/outside'if kind in (tarfile.SYMTYPE,tarfile.LNKTYPE)else'';x.size=len(data)if kind==tarfile.REGTYPE else 0;t.addfile(x,io.BytesIO(data)if x.size else None)
  raw=b.getvalue();compressed=gzip.compress(raw,mtime=0);return {'mediaType':m.engine.OCI_LAYER,'digest':m.digest(compressed),'size':len(compressed)},m.digest(raw),compressed
 def preimages(self,*layers):
  table={a['digest']:c for a,b,c in layers};return m.active_preimages({'layers':[a for a,b,c in layers]},{'rootfs':{'diff_ids':[b for a,b,c in layers]}},lambda d:table[d['digest']])
 def test_absence_is_explicit_and_all_existing_sources_present(self):
  rows=self.preimages(self.layer());self.assertEqual(set(rows),set(m.PATHS));self.assertEqual({p for p,v in rows.items()if v is None},m.NEW_PATHS)
 def test_existing_empty_file_and_special_new_paths_refuse(self):
  for kind in [tarfile.REGTYPE,tarfile.DIRTYPE,tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.FIFOTYPE]:
   with self.subTest(kind=kind):
    with self.assertRaises(ValueError):self.preimages(self.layer([(next(iter(m.NEW_PATHS)),kind,b'')]))
 def test_unsafe_ancestor_and_duplicate_source_refuse(self):
  for extra in [[('app/src/lib',tarfile.SYMTYPE,b'')],[(next(p for p in m.PATHS if p not in m.NEW_PATHS),tarfile.REGTYPE,b'old\n')]]:
   with self.assertRaises(ValueError):self.preimages(self.layer(extra))
 def test_whiteout_of_required_source_refuses(self):
  p=next(p for p in m.PATHS if p not in m.NEW_PATHS);parent,name=p.rsplit('/',1)
  with self.assertRaises(ValueError):self.preimages(self.layer(),self.layer([(parent+'/.wh.'+name,tarfile.REGTYPE,b'')],False))
 def test_whiteout_of_new_file_removes_it_before_final_absence(self):
  p=next(iter(m.NEW_PATHS));parent,name=p.rsplit('/',1)
  rows=self.preimages(self.layer([(p,tarfile.REGTYPE,b'old\n')]),self.layer([(parent+'/.wh.'+name,tarfile.REGTYPE,b'')],False));self.assertIsNone(rows[p])
 def test_layer_diff_id_refuses(self):
  a,b,c=self.layer()
  with self.assertRaises(ValueError):m.active_preimages({'layers':[a]},{'rootfs':{'diff_ids':['sha256:'+'0'*64]}},lambda _:c)
 def test_eight_output_files_have_exact_preserved_owners_modes(self):
  files={p:b'reviewed\n'for p in m.PATHS};one=m.make_layer(files);self.assertEqual(one,m.make_layer(files))
  with tarfile.open(fileobj=io.BytesIO(gzip.decompress(one[0])))as t:
   rows=t.getmembers();self.assertEqual(len(rows),8)
   for r in rows:self.assertTrue(r.isfile());self.assertEqual((r.uid,r.gid,r.mode),m.strict.EXPECTED_METADATA[r.name])
  with self.assertRaises(ValueError):m.make_layer({**files,'app/other':b'bad'})
 def test_append_preserves_runtime_and_search_layers(self):
  cfg={'architecture':'amd64','os':'linux','config':{'Env':['KEEP=1'],'User':'1000'},'rootfs':{'type':'layers','diff_ids':['sha256:'+'1'*64]},'history':[{'created_by':'search'}]};manifest={'schemaVersion':2,'layers':[{'digest':'sha256:'+'2'*64}],'config':{}}
  layer,diff=m.make_layer({p:b'new\n'for p in m.PATHS});out,raw=m.engine.append_overlay(manifest,cfg,layer,diff,'a'*40);new=json.loads(raw);new['rootfs']['diff_ids'].pop();new['history'].pop();self.assertEqual(cfg,new);self.assertEqual(out['layers'][:-1],manifest['layers'])
 def test_task_preserves_search_and_all_unrelated_configuration(self):
  out=m.task_candidate(self.task,'sha256:'+'1'*64);expected=copy.deepcopy(self.task)
  for k in m.engine.READ_ONLY_TASK_FIELDS:expected.pop(k,None)
  expected['containerDefinitions'][0]['image']=m.engine.REPOSITORY+'@sha256:'+'1'*64;self.assertEqual(out,expected)
 def test_task_rejects_missing_search_eight_and_foreign_base(self):
  for change in ['search','image']:
   row=copy.deepcopy(self.task)
   if change=='image':row['containerDefinitions'][0]['image']='foreign'
   else:row['containerDefinitions'][0]['environment'][1]['value']='1'
   with self.assertRaises(ValueError):m.task_candidate(row,'sha256:'+'1'*64)
 def test_only_exact_reviewed_mapping_can_be_added(self):
  value=json.dumps({'us-east-1':{'domain':'wire.example.com','evidence_sha256':'a'*64,'verified_at':'2026-09-14T00:00:00Z'}})
  with patch.object(m,'recipe',return_value={**self.rules,'sesMessageIdDomains':value}):
   result=m.task_candidate(self.task,'sha256:'+'1'*64);self.assertEqual(result['containerDefinitions'][0]['environment'][-1],{'name':'EMAILS_SES_MESSAGE_ID_DOMAINS','value':value})
   self.task['containerDefinitions'][0]['environment'].append({'name':'EMAILS_SES_MESSAGE_ID_DOMAINS','value':value+' '})
   with self.assertRaises(ValueError):m.task_candidate(self.task,'sha256:'+'1'*64)
 def test_mapping_secret_alias_and_malformed_evidence_refuse(self):
  self.task['containerDefinitions'][0]['secrets'].append({'name':'EMAILS_SES_MESSAGE_ID_DOMAINS','valueFrom':'ref'})
  with self.assertRaises(ValueError):m.task_candidate(self.task,'sha256:'+'1'*64)
  for value in ['', '[]', '{}','x'*8193,json.dumps({'us-east-1':{'domain':'x','evidence_sha256':'a'*64,'verified_at':'2026-99-99T00:00:00Z'}})]:
   with self.assertRaises(ValueError):m.mapping(value)
 def test_pending_base_refuses_before_any_aws_read_or_write(self):
  with tempfile.TemporaryDirectory()as d,patch.object(m.engine,'aws',side_effect=AssertionError('AWS_FORBIDDEN')),patch.object(m,'recipe',return_value={**self.rules,'baseReconciliation':None}):
   with self.assertRaisesRegex(ValueError,'ACTUAL_SEARCH_RECONCILIATION_REQUIRED'):m.prepare('a'*40,pathlib.Path(d))
 def test_prior_search_run_identity_cannot_be_substituted(self):
  run={'head_sha':m.BASE_SOURCE,'head_branch':'main','event':'workflow_dispatch','status':'completed','conclusion':'success','path':'.github/workflows/emails-search-promotion.yml'};g.admit_prior_search_run(run,m.BASE_SOURCE)
  for key,value in [('head_sha','a'*40),('event','pull_request'),('path','.github/workflows/emails-reply-promotion.yml'),('conclusion','failure')]:
   with self.assertRaises(ValueError):g.admit_prior_search_run({**run,key:value},m.BASE_SOURCE)
 def test_prior_search_artifacts_bind_both_preparation_and_actual_promotion(self):
  rules={**self.rules,'baseReconciliation':{'preparedSha256':'a'*64}}
  prepared={'schema':'emails.promotion-prepared.v1','sourceCommit':m.BASE_SOURCE,'recipeSha256':hashlib.sha256((ROOT.parent/'emails-search/recipe.json').read_bytes()).hexdigest(),'image':{'imageDigest':m.BASE,'configDigest':m.BASE_CONFIG},'taskDefinitionBefore':'old'}
  promoted={'sourceCommit':m.BASE_SOURCE,'preparedSha256':'a'*64,'imageDigest':m.BASE,'taskBefore':'old','searchConcurrency':8,'runtimeConfigurationPreserved':True};g.admit_base_documents(rules,prepared,promoted)
  for key,value in [('imageDigest','sha256:'+'0'*64),('taskBefore','other'),('preparedSha256','b'*64),('runtimeConfigurationPreserved',False)]:
   with self.assertRaises(ValueError):g.admit_base_documents(rules,prepared,{**promoted,key:value})
 def test_strict_patch_requires_exact_absence_and_bytes(self):
  pre={p:None if p in m.NEW_PATHS else b'old\n'for p in m.PATHS};rows=[];data=b''
  for p,old in pre.items():
   new=old is None;rows.append({'path':p,'newFile':new,'beforeSha256':None if new else hashlib.sha256(old).hexdigest(),'beforeBytes':0 if new else len(old),'afterSha256':hashlib.sha256(b'new\n').hexdigest(),'afterBytes':4,'uid':m.strict.EXPECTED_METADATA[p][0],'gid':m.strict.EXPECTED_METADATA[p][1],'mode':m.strict.EXPECTED_METADATA[p][2]});data+=(b'--- /dev/null\n'if new else b'--- a/'+p.encode()+b'\n')+b'+++ b/'+p.encode()+b'\n'+(b'@@ -0,0 +1 @@\n+new\n'if new else b'@@ -1 +1 @@\n-old\n+new\n')
  recipe={**self.rules,'files':rows,'patchSha256':hashlib.sha256(data).hexdigest()};self.assertEqual(m.strict.apply_reviewed_patch(recipe,data,pre),{p:b'new\n'for p in m.PATHS})
  pre[next(iter(m.NEW_PATHS))]=b''
  with self.assertRaises(ValueError):m.strict.apply_reviewed_patch(recipe,data,pre)

if __name__=='__main__':unittest.main()
