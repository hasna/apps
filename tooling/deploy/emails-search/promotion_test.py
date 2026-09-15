import copy, gzip, hashlib, importlib.util, io, json, pathlib, tarfile, tempfile, unittest
from unittest.mock import patch
s=importlib.util.spec_from_file_location("promotion", pathlib.Path(__file__).with_name("promotion.py"))
m=importlib.util.module_from_spec(s); s.loader.exec_module(m)

class PromotionControls(unittest.TestCase):
 def setUp(self):
  self.base={"family":"emails-prod","taskRoleArn":m.TASK_ROLE,"executionRoleArn":m.EXEC_ROLE,"networkMode":"awsvpc","cpu":"1024","memory":"2048","requiresCompatibilities":["FARGATE"],"containerDefinitions":[{"name":"emails","image":m.REPOSITORY+"@"+m.BASE,"command":["src/server/index.ts"],"environment":[{"name":"EMAILS_MODE","value":"self_hosted"},{"name":"EMAILS_RATE_LIMIT_MAX","value":"6000"}],"secrets":[{"name":"DATABASE_URL","valueFrom":"arn:fixture"}],"logConfiguration":{"logDriver":"awslogs"}},{"name":"observer","image":"unchanged","environment":[{"name":"EMAILS_SEARCH_CONCURRENCY","value":"1"}]}],"taskDefinitionArn":"arn:old","revision":88,"status":"ACTIVE","registeredAt":"time","registeredBy":"owner","compatibilities":["FARGATE"],"requiresAttributes":[]}
 def test_task_changes_only_selected_image_and_admission(self):
  after=m.task_candidate(self.base,"sha256:"+"1"*64)
  expected=copy.deepcopy(self.base)
  for k in m.READ_ONLY_TASK_FIELDS: expected.pop(k,None)
  expected["containerDefinitions"][0]["image"]=m.REPOSITORY+"@sha256:"+"1"*64
  expected["containerDefinitions"][0]["environment"] += [{"name":"EMAILS_SEARCH_CONCURRENCY","value":"8"}]
  self.assertEqual(after,expected)
 def test_refuse_unknown_field_instead_of_discarding(self):
  self.base["futureSensitiveField"]="preserve"
  with self.assertRaises(ValueError): m.task_candidate(self.base,"sha256:"+"1"*64)
 def test_reject_secret_alias_and_duplicate_environment(self):
  for modifier in [lambda x:x["secrets"].append({"name":"EMAILS_SEARCH_CONCURRENCY","valueFrom":"ref"}),lambda x:x["environment"].append({"name":"EMAILS_MODE","value":"self_hosted"})]:
   b=copy.deepcopy(self.base);modifier(b["containerDefinitions"][0])
   with self.assertRaises(ValueError):m.task_candidate(b,"sha256:"+"1"*64)
 def test_drift_and_other_family_refuse(self):
  for key,value in [("family","other"),("taskRoleArn","other")]:
   b=copy.deepcopy(self.base);b[key]=value
   with self.assertRaises(ValueError):m.task_candidate(b,"sha256:"+"1"*64)
  self.base["containerDefinitions"][0]["image"]="other"
  with self.assertRaises(ValueError):m.task_candidate(self.base,"sha256:"+"1"*64)
 def test_pool_override_must_have_capacity(self):
  for value in ["1","8","bad","0","1001"]:
   b=copy.deepcopy(self.base);b["containerDefinitions"][0]["environment"].append({"name":"EMAILS_PG_POOL_MAX","value":value})
   with self.assertRaises(ValueError):m.task_candidate(b,"sha256:"+"1"*64)
 def test_layer_is_exact_three_regular_files_reproducible(self):
  files={p:b"reviewed\n" for p in m.PATHS}
  a=m.make_layer(files);b=m.make_layer(files);self.assertEqual(a,b)
  with tarfile.open(fileobj=io.BytesIO(gzip.decompress(a[0]))) as t:
   rows=t.getmembers();self.assertEqual({r.name for r in rows},set(m.PATHS));self.assertTrue(all(r.isfile() and r.uid==0 and r.gid==0 and r.mode==0o644 for r in rows))
  with self.assertRaises(ValueError):m.make_layer({**files,"app/other":b"bad"})
 def test_append_preserves_entire_runtime_and_existing_layers(self):
  raw={"architecture":"amd64","os":"linux","config":{"Env":["KEEP=1"],"Entrypoint":["bun"],"User":"1000"},"rootfs":{"type":"layers","diff_ids":["sha256:"+"4"*64]},"history":[{"created_by":"existing"}],"other":"preserved"}
  manifest={"schemaVersion":2,"mediaType":m.OCI_MANIFEST,"config":{"mediaType":m.OCI_CONFIG,"digest":m.digest(m.encode(raw)),"size":len(m.encode(raw))},"layers":[{"mediaType":m.OCI_LAYER,"digest":"sha256:"+"3"*64,"size":42}]}
  layer,diff=m.make_layer({p:b"reviewed" for p in m.PATHS})
  out,cfg=m.append_overlay(manifest,raw,layer,diff,"a"*40)
  self.assertEqual(out["layers"][:-1],manifest["layers"])
  c=json.loads(cfg);c["rootfs"]["diff_ids"].pop();c["history"].pop();self.assertEqual(c,raw)
 def test_service_stable_contract(self):
  s={"serviceName":"emails-prod","status":"ACTIVE","desiredCount":1,"runningCount":1,"pendingCount":0,"taskDefinition":"old","deployments":[{"status":"PRIMARY","taskDefinition":"old","rolloutState":"COMPLETED"}]}
  self.assertEqual(m.service_binding(s),"old")
  for key,value in [("pendingCount",1),("desiredCount",0),("serviceName","other")]:
   b=copy.deepcopy(s);b[key]=value
   with self.assertRaises(ValueError):m.service_binding(b)

class CompletionControls(unittest.TestCase):
 def service(self, state="COMPLETED"):
  return {"serviceName":m.SERVICE,"status":"ACTIVE","desiredCount":1,"runningCount":1,"pendingCount":0,"taskDefinition":"reviewed","deployments":[{"status":"PRIMARY","taskDefinition":"reviewed","rolloutState":state}]}
 def test_running_counts_do_not_finish_before_rollout_completion(self):
  pending=self.service("IN_PROGRESS");ready=self.service()
  with patch.object(m,"current_service",side_effect=[pending,ready]) as reads,patch.object(m.time,"sleep") as sleep,patch.object(m,"aws",side_effect=AssertionError("NO_MUTATION")):
   self.assertEqual(m.wait_for_service("reviewed",1),ready)
   self.assertEqual(reads.call_count,2);sleep.assert_called_once()
 def test_changed_task_or_scale_is_terminal_without_wait(self):
  for key,value in [("taskDefinition","foreign"),("desiredCount",2)]:
   with patch.object(m,"current_service",return_value={**self.service("IN_PROGRESS"),key:value}) as reads,patch.object(m.time,"sleep") as sleep:
    with self.assertRaisesRegex(ValueError,"^LIVE_SERVICE_DRIFT$"):m.wait_for_service("reviewed",1)
    self.assertEqual(reads.call_count,1);sleep.assert_not_called()
 def test_failed_rollout_is_terminal_without_wait(self):
  with patch.object(m,"current_service",return_value=self.service("FAILED")),patch.object(m.time,"sleep") as sleep:
   with self.assertRaisesRegex(ValueError,"^DEPLOYMENT_FAILED$"):m.wait_for_service("reviewed",1)
   sleep.assert_not_called()
 def test_completion_wait_has_a_deadline(self):
  with patch.object(m,"current_service",return_value=self.service("IN_PROGRESS")) as reads,patch.object(m.time,"monotonic",side_effect=[0,0,2]),patch.object(m.time,"sleep") as sleep:
   with self.assertRaisesRegex(ValueError,"^DEPLOYMENT_COMPLETION_TIMEOUT$"):m.wait_for_service("reviewed",1,timeout=1)
   self.assertEqual(reads.call_count,2);sleep.assert_called_once_with(1)
 def test_api_read_failure_is_terminal_without_retry(self):
  with patch.object(m,"current_service",side_effect=ValueError("SERVICE_UNAVAILABLE")) as reads,patch.object(m.time,"sleep") as sleep:
   with self.assertRaisesRegex(ValueError,"^SERVICE_UNAVAILABLE$"):m.wait_for_service("reviewed",1)
   self.assertEqual(reads.call_count,1);sleep.assert_not_called()

class AdditionalControls(unittest.TestCase):
 def setUp(self):
  sp=importlib.util.spec_from_file_location("strict",pathlib.Path(__file__).with_name("strict_patch.py"));self.strict=importlib.util.module_from_spec(sp);sp.loader.exec_module(self.strict)
  self.pre={p:b"old\ncontext\n" for p in m.PATHS}
  self.patch=b"".join(b"--- a/"+p.encode()+b"\n+++ b/"+p.encode()+b"\n@@ -1,2 +1,2 @@\n-old\n+new\n context\n" for p in m.PATHS)
  self.recipe={"schema":"emails.source-overlay-recipe.v1","patchSha256":hashlib.sha256(self.patch).hexdigest(),"files":[{"path":p,"beforeSha256":hashlib.sha256(self.pre[p]).hexdigest(),"afterSha256":hashlib.sha256(b"new\ncontext\n").hexdigest(),"beforeBytes":12,"afterBytes":12,"uid":0,"gid":0,"mode":420} for p in m.PATHS]}
 def test_exact_portable_patch(self):
  self.assertEqual(self.strict.apply_reviewed_patch(self.recipe,self.patch,self.pre),{p:b"new\ncontext\n" for p in m.PATHS})
 def test_patch_adversarial_controls(self):
  changes=[self.patch+self.patch,self.patch.replace(b"@@ -1,2 +1,2 @@",b"@@ -2,2 +1,2 @@",1),self.patch.replace(b"@@ -1,2 +1,2 @@",b"@@ -1,2 +2,2 @@",1),self.patch.replace(b" context",b" changed",1),self.patch[:-9]+b"\n",self.patch.replace(b"--- a/app/",b"--- a/../app/",1),self.patch.replace(b"+++ b/app/",b"+++ b/other/",1),b"diff --git a/x b/x\n"+self.patch,self.patch.replace(b"\n",b"\r\n",1),self.patch+b"\0\n",self.patch.replace(b"@@ -1,2 +1,2 @@",b"@@ -"+b"9"*10000+b",2 +1,2 @@",1)]
  for bad in changes:
   r=copy.deepcopy(self.recipe);r["patchSha256"]=hashlib.sha256(bad).hexdigest()
   with self.subTest(digest=r["patchSha256"]):
    with self.assertRaises(ValueError):self.strict.apply_reviewed_patch(r,bad,self.pre)
 def test_preimage_metadata_and_membership_controls(self):
  for key,value in [("mode",511),("uid",1),("beforeBytes",1000001),("afterSha256","0"*64)]:
   r=copy.deepcopy(self.recipe);r["files"][0][key]=value
   with self.assertRaises(ValueError):self.strict.apply_reviewed_patch(r,self.patch,self.pre)
  with self.assertRaises(ValueError):self.strict.apply_reviewed_patch(self.recipe,self.patch,{})
  with self.assertRaises(ValueError):self.strict.apply_reviewed_patch(self.recipe,self.patch,{**self.pre,"other":b""})
 def test_source_and_diff_ids_bound(self):
  with self.assertRaises(ValueError):m.append_overlay({}, {}, b"", "sha256:"+"1"*64,"short")
  with self.assertRaises(ValueError):m.active_preimages({"layers":[]},{"rootfs":{"diff_ids":[]}},lambda d:b"")
 def test_tar_link_source_refused_without_opening(self):
  out=io.BytesIO()
  with tarfile.open(fileobj=out,mode="w") as t:
   r=tarfile.TarInfo(m.PATHS[0]);r.type=tarfile.SYMTYPE;r.linkname="/outside";t.addfile(r)
  raw=out.getvalue();data=gzip.compress(raw,mtime=0)
  desc={"mediaType":m.OCI_LAYER,"digest":m.digest(data),"size":len(data)}
  with self.assertRaises(ValueError):m.active_preimages({"layers":[desc]},{"rootfs":{"diff_ids":[m.digest(raw)]}},lambda d:data)
 def test_ci_admission_rejects_wrong_run_identity(self):
  spec=importlib.util.spec_from_file_location("gate",pathlib.Path(__file__).with_name("gate.py"));g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
  row={"head_sha":"a"*40,"head_branch":"main","event":"push","status":"completed","conclusion":"success","name":"ci","path":".github/workflows/ci.yml"}
  self.assertTrue(g.admit_runs([row],"a"*40))
  for key,value in [("head_sha","b"*40),("head_branch","other"),("event","pull_request"),("status","in_progress"),("conclusion","failure"),("name","other"),("path","other")]:
   self.assertFalse(g.admit_runs([{**row,key:value}],"a"*40))
  prep={**row,"event":"workflow_dispatch","path":".github/workflows/emails-search-promotion.yml"};g.admit_preparation(prep,"a"*40)
  with self.assertRaises(ValueError):g.admit_preparation({**prep,"path":"other"},"a"*40)
 def test_unreviewed_plan_refuses_before_any_aws(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=pathlib.Path(tmp);p=d/"prepared.json";p.write_bytes(b"{}")
   with patch.object(m,"aws",side_effect=AssertionError("NO_AWS")):
    with self.assertRaises(ValueError):m.promote("a"*40,d,p,"0"*64)
 def test_aws_uncertainty_has_no_retry_and_no_raw_error(self):
  class Result:returncode=1;stdout=b"";stderr=b"private body"
  with patch.object(m.subprocess,"run",return_value=Result()) as run:
   with self.assertRaisesRegex(ValueError,"AWS_OPERATION_REFUSED_OR_UNCERTAIN") as caught:m.aws("ecs","update-service")
   self.assertNotIn("private",str(caught.exception));self.assertEqual(run.call_count,1)
   self.assertEqual(run.call_args.kwargs["env"]["AWS_MAX_ATTEMPTS"],"1")

class FakeCloud:
 def __init__(self, before, candidate, image, mode="healthy", rollback=False):
  self.before=copy.deepcopy(before);self.candidate=copy.deepcopy(candidate);self.image=image;self.mode=mode;self.calls=[];self.service_reads=0
  self.old=before["taskDefinitionArn"];self.new=f"arn:aws:ecs:{m.REGION}:{m.ACCOUNT}:task-definition/emails-prod:89";self.current=self.new if rollback else self.old
  self.registered={**copy.deepcopy(candidate),"taskDefinitionArn":self.new,"revision":89,"status":"ACTIVE"}
 def __call__(self,*args,body=None,**kwargs):
  self.calls.append({"args":args,"body":copy.deepcopy(body)})
  kind=args[:2]
  if kind==("ecr","batch-get-image"):
   manifest={"schemaVersion":2,"mediaType":m.OCI_MANIFEST,"config":{},"layers":[]}
   return {"images":[{"imageId":{"imageDigest":self.image},"imageManifest":m.encode(manifest).decode()}]}
  if kind==("ecs","describe-services"):
   self.service_reads+=1
   arn="foreign" if self.mode=="service_drift" and self.service_reads>=2 else self.current
   state="IN_PROGRESS" if self.mode=="late_completion" and self.current==self.new and self.service_reads==3 else "COMPLETED"
   return {"services":[{"serviceName":m.SERVICE,"status":"ACTIVE","desiredCount":1,"runningCount":1,"pendingCount":0,"taskDefinition":arn,"deployments":[{"status":"PRIMARY","taskDefinition":arn,"rolloutState":state}]}]}
  if kind==("ecs","describe-task-definition"):
   arn=args[args.index("--task-definition")+1];row=copy.deepcopy(self.before if arn==self.old else self.registered)
   if arn!=self.old and self.mode in {"registered_drift","foreign_rollback"}:row["memory"]="4096"
   if arn!=self.old and self.mode=="registered_tag_drift":row["tags"]=[{"key":"owner","value":"changed"}]
   tags=row.pop("tags",[]);return {"taskDefinition":row,"tags":tags}
  if kind==("ecs","register-task-definition"):
   if body.get("tags")==[]:raise ValueError("Tags can not be empty.")
   self.registered={**copy.deepcopy(body),"taskDefinitionArn":self.new,"revision":89,"status":"ACTIVE"}
   return {"taskDefinition":self.registered}
  if kind==("ecs","update-service"):
   self.current=args[args.index("--task-definition")+1]
   if self.mode=="uncertain_update":raise ValueError("AWS_OPERATION_REFUSED_OR_UNCERTAIN:ecs/update-service")
   return {}
  if kind==("ecs","wait"):return {}
  if kind==("ecs","list-tasks"):return {"taskArns":["observed-task"]}
  if kind==("ecs","describe-tasks"):
   return {"tasks":[{"taskDefinitionArn":self.new,"lastStatus":"RUNNING","healthStatus":"HEALTHY","containers":[{"name":"emails","imageDigest":self.image}]}]}
  raise AssertionError("UNEXPECTED_AWS_CALL:"+str(kind))
 def mutations(self, operation):return [r for r in self.calls if r["args"][:2]==("ecs",operation)]

class OrchestrationControls(unittest.TestCase):
 def context(self, mode="healthy", rollback=False, tags=None):
  fixture=PromotionControls();fixture.setUp();before={**fixture.base,"tags":copy.deepcopy(tags) if tags is not None else []}
  manifest={"schemaVersion":2,"mediaType":m.OCI_MANIFEST,"config":{},"layers":[]};image=m.digest(m.encode(manifest));candidate=m.task_candidate(before,image);receipt={"imageDigest":image,"fixtureImmutableImage":True}
  plan={"schema":"emails.promotion-prepared.v1","sourceCommit":"a"*40,"recipeSha256":hashlib.sha256((m.ROOT/"recipe.json").read_bytes()).hexdigest(),"taskDefinitionBefore":before["taskDefinitionArn"],"taskBeforeDigest":m.digest(m.encode(before)),"taskAfterDigest":m.digest(m.encode(candidate)),"desiredCount":1,"image":receipt}
  return FakeCloud(before,candidate,image,mode,rollback),plan,(manifest,b"config",b"layer",receipt)
 def execute(self, mode="healthy", rollback=False, tags=None):
  cloud,plan,built=self.context(mode,rollback,tags)
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp);p=out/"prepared.json";p.write_bytes(m.encode(plan));ph=hashlib.sha256(p.read_bytes()).hexdigest()
   with patch.object(m,"aws",side_effect=cloud),patch.object(m,"build",return_value=built):
    error=None
    try:(m.rollback if rollback else m.promote)("a"*40,out,p,ph)
    except ValueError as caught:error=caught
   receipts={p.name:json.loads(p.read_bytes()) for p in out.glob("*.json")}
  return cloud,error,receipts
 def test_actual_healthy_promotion_registers_and_updates_once(self):
  cloud,error,receipts=self.execute();self.assertIsNone(error)
  self.assertEqual(len(cloud.mutations("register-task-definition")),1);self.assertEqual(len(cloud.mutations("update-service")),1)
  wire=cloud.mutations("register-task-definition")[0]["body"]
  self.assertNotIn("tags",wire);self.assertEqual({**wire,"tags":[]},cloud.candidate)
  self.assertEqual(cloud.candidate["tags"],[])
  self.assertEqual(receipts["promoted.json"]["taskAfter"],cloud.new);self.assertEqual(receipts["promoted.json"]["imageDigest"],cloud.image)
  self.assertEqual(cloud.mutations("update-service")[0]["args"],("ecs","update-service","--cluster",m.CLUSTER,"--service",m.SERVICE,"--task-definition",cloud.new))
 def test_nonempty_tags_are_preserved_in_registration_and_readback(self):
  tags=[{"key":"owner","value":"fixture"},{"key":"purpose","value":"capacity"}]
  cloud,error,receipts=self.execute(tags=tags);self.assertIsNone(error)
  self.assertEqual(cloud.mutations("register-task-definition")[0]["body"],cloud.candidate)
  self.assertEqual(cloud.candidate["tags"],tags);self.assertIn("promoted.json",receipts)
 def test_delayed_completion_does_not_repeat_registration_or_update(self):
  with patch.object(m.time,"sleep") as sleep:
   cloud,error,receipts=self.execute("late_completion")
  self.assertIsNone(error);sleep.assert_called_once()
  self.assertEqual(len(cloud.mutations("register-task-definition")),1);self.assertEqual(len(cloud.mutations("update-service")),1)
  self.assertIn("promoted.json",receipts);self.assertNotIn("reconciliation-required.json",receipts)
 def test_tag_readback_drift_prevents_service_update(self):
  cloud,error,receipts=self.execute("registered_tag_drift",tags=[{"key":"owner","value":"fixture"}])
  self.assertEqual(str(error),"REGISTERED_TASK_DRIFT");self.assertEqual(cloud.mutations("update-service"),[])
  self.assertIn("registered.json",receipts);self.assertNotIn("promoted.json",receipts)
 def test_registered_task_drift_prevents_update(self):
  cloud,error,receipts=self.execute("registered_drift");self.assertEqual(str(error),"REGISTERED_TASK_DRIFT");self.assertEqual(len(cloud.mutations("register-task-definition")),1);self.assertEqual(cloud.mutations("update-service"),[]);self.assertIn("registered.json",receipts);self.assertNotIn("promoted.json",receipts)
 def test_service_changes_after_registration_prevent_update(self):
  cloud,error,receipts=self.execute("service_drift");self.assertIsNotNone(error);self.assertEqual(len(cloud.mutations("register-task-definition")),1);self.assertEqual(cloud.mutations("update-service"),[]);self.assertNotIn("update-intent.json",receipts)
 def test_uncertain_update_is_single_call_with_durable_intent(self):
  cloud,error,receipts=self.execute("uncertain_update");self.assertIsNotNone(error);self.assertEqual(len(cloud.mutations("update-service")),1);self.assertIn("update-intent.json",receipts);self.assertNotIn("promoted.json",receipts);self.assertNotIn("rollback-intent.json",receipts)
 def test_foreign_current_task_refuses_rollback(self):
  cloud,error,receipts=self.execute("foreign_rollback",True);self.assertEqual(str(error),"ROLLBACK_FOREIGN_DEPLOYMENT");self.assertEqual(cloud.mutations("register-task-definition"),[]);self.assertEqual(cloud.mutations("update-service"),[])
 def test_exact_candidate_rolls_back_only_to_reviewed_revision(self):
  cloud,error,receipts=self.execute(rollback=True);self.assertIsNone(error);self.assertEqual(cloud.mutations("register-task-definition"),[]);self.assertEqual(len(cloud.mutations("update-service")),1);self.assertEqual(cloud.mutations("update-service")[0]["args"][-1],cloud.old);self.assertEqual(receipts["rolled-back.json"]["taskAfter"],cloud.old)

if __name__=="__main__":unittest.main()
