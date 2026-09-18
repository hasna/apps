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
  prep={**row,"event":"workflow_dispatch","path":".github/workflows/emails-search-promotion.yml"}
  self.assertEqual(g.admit_preparation(prep,"a"*40),"a"*40)
  self.assertEqual(g.admit_preparation(prep,None),"a"*40)
  with self.assertRaises(ValueError):g.admit_preparation(prep,"b"*40)
  with self.assertRaises(ValueError):g.admit_preparation({**prep,"path":"other"},"a"*40)
 def test_prepared_file_binds_immutable_bytes_to_the_admitted_run_source(self):
  spec=importlib.util.spec_from_file_location("gate",pathlib.Path(__file__).with_name("gate.py"));g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
  source="a"*40;plan={"schema":"emails.promotion-prepared.v1","sourceCommit":source};raw=m.encode(plan);expected=hashlib.sha256(raw).hexdigest()
  with tempfile.TemporaryDirectory() as tmp:
   path=pathlib.Path(tmp)/"prepared.json";path.write_bytes(raw)
   self.assertEqual(g.verify_prepared_file(path,expected,source),plan)
   with self.assertRaisesRegex(ValueError,"^PREPARED_RUN_SOURCE_DRIFT$"):g.verify_prepared_file(path,expected,"b"*40)
   with self.assertRaisesRegex(ValueError,"^PREPARED_ARTIFACT_DIGEST$"):g.verify_prepared_file(path,"0"*64,source)
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
   return {"tasks":[{"taskArn":"observed-task","taskDefinitionArn":self.new,"lastStatus":"RUNNING","healthStatus":"HEALTHY","containers":[{"name":"emails","imageDigest":self.image}]}]}
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

class ReconciliationControls(unittest.TestCase):
 def fixture(self,current="candidate",healthy=True):
  base=PromotionControls();base.setUp();before=copy.deepcopy(base.base)
  before["taskDefinitionArn"]=f"arn:aws:ecs:{m.REGION}:{m.ACCOUNT}:task-definition/emails-prod:88"
  image="sha256:"+"1"*64
  child_image="sha256:"+"2"*64
  candidate_payload=m.task_candidate(before,image)
  candidate={**copy.deepcopy(candidate_payload),"taskDefinitionArn":f"arn:aws:ecs:{m.REGION}:{m.ACCOUNT}:task-definition/emails-prod:89","revision":89,"status":"ACTIVE"}
  descendant_payload=copy.deepcopy(candidate_payload)
  next(c for c in descendant_payload["containerDefinitions"] if c["name"]=="emails")["image"]=m.REPOSITORY+"@"+child_image
  descendant={**descendant_payload,"taskDefinitionArn":f"arn:aws:ecs:{m.REGION}:{m.ACCOUNT}:task-definition/emails-prod:90","revision":90,"status":"ACTIVE"}
  plan={"schema":"emails.promotion-prepared.v1","sourceCommit":"a"*40,"recipeSha256":"f"*64,"taskDefinitionBefore":before["taskDefinitionArn"],"taskBeforeDigest":m.digest(m.encode(before)),"taskAfterDigest":m.digest(m.encode(candidate_payload)),"desiredCount":1,"image":{"imageDigest":image}}
  current_task={"candidate":candidate,"base":before,"descendant":descendant}[current]
  current_arn=current_task["taskDefinitionArn"]
  current_image={"candidate":image,"base":m.BASE,"descendant":child_image}[current]
  service={"serviceName":m.SERVICE,"status":"ACTIVE","desiredCount":1,"runningCount":1,"pendingCount":0,"taskDefinition":current_arn,"deployments":[{"status":"PRIMARY","taskDefinition":current_arn,"rolloutState":"COMPLETED" if healthy else "IN_PROGRESS","desiredCount":1,"runningCount":1,"pendingCount":0}]}
  def cloud(*args,**kwargs):
   if args[:2]==("ecs","list-tasks"):return {"taskArns":["task"]}
   if args[:2]==("ecs","describe-tasks"):return {"tasks":[{"taskArn":"task","taskDefinitionArn":current_arn,"lastStatus":"RUNNING","healthStatus":"HEALTHY","containers":[{"name":"emails","imageDigest":current_image}]}]}
   raise AssertionError("UNEXPECTED_AWS_CALL:"+str(args[:2]))
  return before,candidate,descendant,plan,service,cloud
 def execute(self,current="candidate",healthy=True):
  before,candidate,descendant,plan,service,cloud=self.fixture(current,healthy)
  lookup={row["taskDefinitionArn"]:row for row in (before,candidate,descendant)}
  lineage={"parentImageDigest":plan["image"]["imageDigest"],"childImageDigest":next(c for c in descendant["containerDefinitions"] if c["name"]=="emails")["image"].split("@",1)[1],"runtimeConfigurationPreserved":True,"parentLayersPreserved":True}
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)
   with patch.object(m,"historical_reviewed_plan",return_value=(plan,plan["image"],"a"*40)),patch.object(m,"task_read",side_effect=lambda arn: lookup[arn]),patch.object(m,"current_service",return_value=service),patch.object(m,"aws",side_effect=cloud),patch.object(m,"descendant_overlay_lineage",return_value=lineage):
    m.reconcile("b"*40,out,out/"prepared.json","e"*64)
   return json.loads((out/"reconciled.json").read_bytes())
 def test_candidate_live_reconciliation_is_read_only_and_complete(self):
  row=self.execute()
  self.assertEqual(row["state"],"candidate_live_stable")
  self.assertTrue(row["service"]["stable"]);self.assertTrue(row["service"]["healthy"])
  self.assertIsNone(row["descendant"])
  self.assertTrue(row["task88"]["readOnlyRepresentationMayDiffer"])
  self.assertRegex(row["task88"]["historicalReadDigest"],r"^sha256:[0-9a-f]{64}$")
  self.assertRegex(row["task88"]["currentPayloadDigest"],r"^sha256:[0-9a-f]{64}$")
  self.assertFalse(row["rollback"]["automatic"]);self.assertTrue(row["rollback"]["requiresSeparateReview"])
  self.assertFalse(row["rollback"]["validAfterForwardMigration"])
  self.assertEqual(row["sourceCommit"],"b"*40);self.assertEqual(row["preparedSourceCommit"],"a"*40)
  self.assertEqual(set(row),{"schema","sourceCommit","preparedSourceCommit","preparedSha256","task88","task89","descendant","service","state","rollback"})
 def test_task88_readonly_envelope_drift_is_tolerated_but_payload_drift_refuses(self):
  before,candidate,descendant,plan,service,cloud=self.fixture("candidate",True)
  plan["taskBeforeDigest"]="sha256:"+"0"*64
  lookup={row["taskDefinitionArn"]:row for row in (before,candidate,descendant)}
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)
   with patch.object(m,"historical_reviewed_plan",return_value=(plan,plan["image"],"a"*40)),patch.object(m,"task_read",side_effect=lambda arn: lookup[arn]),patch.object(m,"current_service",return_value=service),patch.object(m,"aws",side_effect=cloud):
    m.reconcile("b"*40,out,out/"prepared.json","e"*64)
   row=json.loads((out/"reconciled.json").read_bytes())
  self.assertEqual(row["task88"]["historicalReadDigest"],plan["taskBeforeDigest"])
  changed=copy.deepcopy(before);next(c for c in changed["containerDefinitions"] if c["name"]=="emails")["environment"].append({"name":"UNREVIEWED","value":"1"})
  lookup[before["taskDefinitionArn"]]=changed
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)
   with patch.object(m,"historical_reviewed_plan",return_value=(plan,plan["image"],"a"*40)),patch.object(m,"task_read",side_effect=lambda arn: lookup[arn]),patch.object(m,"current_service",return_value=service),patch.object(m,"aws",side_effect=cloud):
    with self.assertRaisesRegex(ValueError,"^RECONCILE_TASK_88_PAYLOAD_DRIFT$"):m.reconcile("b"*40,out,out/"prepared.json","e"*64)
   self.assertFalse((out/"reconciled.json").exists())
 def test_historical_plan_requires_ancestor_and_runs_real_reviewed_plan(self):
  prepared_source="a"*40;current_source="b"*40
  manifest={"schemaVersion":2,"mediaType":m.OCI_MANIFEST,"config":{},"layers":[]}
  receipt={"imageDigest":m.digest(m.encode(manifest)),"runtimeConfigurationPreserved":True}
  plan={
   "schema":"emails.promotion-prepared.v1",
   "sourceCommit":prepared_source,
   "recipeSha256":hashlib.sha256((m.ROOT/"recipe.json").read_bytes()).hexdigest(),
   "image":receipt,
  }
  raw=m.encode(plan);expected=hashlib.sha256(raw).hexdigest()
  with tempfile.TemporaryDirectory() as tmp:
   path=pathlib.Path(tmp)/"prepared.json";path.write_bytes(raw)
   class Result:returncode=0
   with patch.object(m.subprocess,"run",return_value=Result()) as run,patch.object(m,"build",return_value=(manifest,b"config",b"layer",receipt)) as build,patch.object(m,"image_manifest",return_value=manifest) as readback:
    actual=m.historical_reviewed_plan(current_source,path,expected)
   self.assertEqual(actual,(plan,receipt,prepared_source))
   self.assertEqual(run.call_args.args[0],["git","merge-base","--is-ancestor",prepared_source,current_source])
   build.assert_called_once_with(prepared_source);readback.assert_called_once_with(receipt["imageDigest"])
  with tempfile.TemporaryDirectory() as tmp:
   path=pathlib.Path(tmp)/"prepared.json";path.write_bytes(raw)
   class Refused:returncode=1
   with patch.object(m.subprocess,"run",return_value=Refused()),patch.object(m,"build",side_effect=AssertionError("MUST_NOT_BUILD")):
    with self.assertRaisesRegex(ValueError,"^PREPARED_SOURCE_NOT_ANCESTOR$"):m.historical_reviewed_plan(current_source,path,expected)
 def test_descendant_overlay_is_reconciled_only_when_task_and_image_lineage_are_exact(self):
  row=self.execute("descendant")
  self.assertEqual(row["state"],"descendant_overlay_live_stable")
  self.assertEqual(row["descendant"]["taskDefinition"].rsplit(":",1)[-1],"90")
  self.assertTrue(row["descendant"]["lineage"]["runtimeConfigurationPreserved"])
  self.assertEqual(row["rollback"]["preMigrationAnchor"],row["descendant"]["taskDefinition"])
  self.assertTrue(row["rollback"]["tasks88And89AreHistoricalOnly"])
 def test_descendant_image_lineage_preserves_parent_runtime_and_adds_one_layer(self):
  parent_digest="sha256:"+"1"*64;child_digest="sha256:"+"2"*64
  parent_layer={"mediaType":m.OCI_LAYER,"digest":"sha256:"+"3"*64,"size":10}
  layer_bytes=b"reviewed descendant layer\0";compressed=gzip.compress(layer_bytes,mtime=0)
  child_layer={"mediaType":m.OCI_LAYER,"digest":m.digest(compressed),"size":len(compressed)}
  parent_manifest={"schemaVersion":2,"mediaType":m.OCI_MANIFEST,"config":{"mediaType":m.OCI_CONFIG,"digest":"sha256:"+"5"*64,"size":1},"layers":[parent_layer]}
  child_manifest={"schemaVersion":2,"mediaType":m.OCI_MANIFEST,"config":{"mediaType":m.OCI_CONFIG,"digest":"sha256:"+"6"*64,"size":1},"layers":[parent_layer,child_layer]}
  runtime={"Env":["KEEP=1"],"Entrypoint":["bun"],"User":"1000"}
  parent_config={"architecture":"amd64","os":"linux","created":"time","config":{**runtime,"Labels":{"keep":"same"}},"rootfs":{"type":"layers","diff_ids":["sha256:"+"7"*64]},"history":[{"created_by":"base"}]}
  child_config={"architecture":"amd64","os":"linux","created":"time","config":{**runtime,"Labels":{"keep":"same","com.hasna.review.patch-sha256":"a"*64}},"rootfs":{"type":"layers","diff_ids":["sha256:"+"7"*64,m.digest(layer_bytes)]},"history":[{"created_by":"base"},{"created_by":"overlay"}]}
  with patch.object(m,"image_manifest",side_effect=[parent_manifest,child_manifest]),patch.object(m,"blob",side_effect=[m.encode(parent_config),m.encode(child_config),compressed]):
   row=m.descendant_overlay_lineage(parent_digest,child_digest)
  self.assertEqual(row["layerDigest"],child_layer["digest"]);self.assertEqual(row["diffId"],m.digest(layer_bytes))
  self.assertEqual(row["addedLabelNames"],["com.hasna.review.patch-sha256"])
  self.assertFalse(row["parentHistoryTimestampNormalized"])
  drift=copy.deepcopy(child_config);drift["config"]["Env"]=["CHANGED=1"]
  with patch.object(m,"image_manifest",side_effect=[parent_manifest,child_manifest]),patch.object(m,"blob",side_effect=[m.encode(parent_config),m.encode(drift),compressed]):
   with self.assertRaisesRegex(ValueError,"^RECONCILE_DESCENDANT_RUNTIME_DRIFT$"):m.descendant_overlay_lineage(parent_digest,child_digest)
  wrong_diff=copy.deepcopy(child_config);wrong_diff["rootfs"]["diff_ids"][-1]="sha256:"+"9"*64
  with patch.object(m,"image_manifest",side_effect=[parent_manifest,child_manifest]),patch.object(m,"blob",side_effect=[m.encode(parent_config),m.encode(wrong_diff),compressed]):
   with self.assertRaisesRegex(ValueError,"^RECONCILE_DESCENDANT_DIFF_ID_BINDING$"):m.descendant_overlay_lineage(parent_digest,child_digest)
  empty_history=copy.deepcopy(child_config);empty_history["history"][-1]={"created_by":"metadata only","empty_layer":True}
  with patch.object(m,"image_manifest",side_effect=[parent_manifest,child_manifest]),patch.object(m,"blob",side_effect=[m.encode(parent_config),m.encode(empty_history),compressed]):
   with self.assertRaisesRegex(ValueError,"^RECONCILE_DESCENDANT_HISTORY_LAYER$"):m.descendant_overlay_lineage(parent_digest,child_digest)
  stamped=copy.deepcopy(child_config);stamped["history"]=[{"created_by":"base","created":"2026-09-16T00:26:12.261010935+03:00"},{"created_by":"overlay","created":"2026-09-16T00:26:12.328330003+03:00"}]
  def lineage(value):
   with patch.object(m,"image_manifest",side_effect=[parent_manifest,child_manifest]),patch.object(m,"blob",side_effect=[m.encode(parent_config),m.encode(value),compressed]):
    return m.descendant_overlay_lineage(parent_digest,child_digest)
  self.assertTrue(lineage(stamped)["parentHistoryTimestampNormalized"])
  exact_five=copy.deepcopy(stamped);exact_five["history"][0]["created"]="2026-09-16T00:00:00.000000000Z";exact_five["history"][1]["created"]="2026-09-16T00:00:05.000000000Z"
  self.assertTrue(lineage(exact_five)["parentHistoryTimestampNormalized"])
  equivalent_offset=copy.deepcopy(stamped);equivalent_offset["history"][0]["created"]="2026-09-16T00:00:00Z";equivalent_offset["history"][1]["created"]="2026-09-16T01:00:00+01:00"
  self.assertTrue(lineage(equivalent_offset)["parentHistoryTimestampNormalized"])
  just_over=copy.deepcopy(exact_five);just_over["history"][1]["created"]="2026-09-16T00:00:05.000000001Z"
  negative=copy.deepcopy(exact_five);negative["history"][1]["created"]="2026-09-15T23:59:59.999999999Z"
  malformed=[]
  for value in ["2026-09-16 00:00:00Z","2026-09-16T00:00:00","2026-09-16T00:00:00.1234567890Z","2026-09-16T00:00:00+24:00","2026-09-16T00:00:00-00:00","2026-12-31T23:59:60Z",None,7,"x"*65]:
   row=copy.deepcopy(stamped);row["history"][0]["created"]=value;malformed.append(row)
  missing_appended=copy.deepcopy(stamped);missing_appended["history"][1].pop("created")
  for invalid in [just_over,negative,missing_appended,*malformed]:
   with self.assertRaisesRegex(ValueError,"^RECONCILE_DESCENDANT_HISTORY_TIMESTAMP$"):lineage(invalid)
  altered=copy.deepcopy(stamped);altered["history"][-2]["created_by"]="changed"
  added=copy.deepcopy(stamped);added["history"][-2]["extra"]="field"
  typed_parent={**parent_config,"history":[{"created_by":"base","empty_layer":False}]}
  typed_child=copy.deepcopy(stamped);typed_child["history"]=[{"created_by":"base","empty_layer":0,"created":"2026-09-16T00:00:00Z"},{"created_by":"overlay","created":"2026-09-16T00:00:01Z"}]
  earlier_parent={**parent_config,"history":[{"created_by":"first","empty_layer":False},{"created_by":"base"}]}
  earlier_child=copy.deepcopy(stamped);earlier_child["history"]=[{"created_by":"changed"},{"created_by":"base","created":"2026-09-16T00:26:12Z"},{"created_by":"overlay","created":"2026-09-16T00:26:13Z"}]
  parent_stamped={**parent_config,"history":[{"created_by":"base","created":"2026-09-16T00:00:00Z"}]}
  typed_earlier=copy.deepcopy(earlier_child);typed_earlier["history"][0]={"created_by":"first","empty_layer":0}
  for parent_value,child_value in [(parent_config,altered),(parent_config,added),(typed_parent,typed_child),(earlier_parent,earlier_child),(earlier_parent,typed_earlier),(parent_stamped,stamped)]:
   with patch.object(m,"image_manifest",side_effect=[parent_manifest,child_manifest]),patch.object(m,"blob",side_effect=[m.encode(parent_value),m.encode(child_value),compressed]):
    with self.assertRaisesRegex(ValueError,"^RECONCILE_DESCENDANT_HISTORY$"):m.descendant_overlay_lineage(parent_digest,child_digest)
 def test_base_live_reconciliation_records_registered_candidate_without_mutation(self):
  row=self.execute("base")
  self.assertEqual(row["state"],"base_live_stable")
  self.assertTrue(row["service"]["healthy"])
 def test_unstable_or_mixed_service_refuses_without_a_receipt(self):
  before,candidate,descendant,plan,service,cloud=self.fixture("candidate",False)
  lookup={row["taskDefinitionArn"]:row for row in (before,candidate,descendant)}
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)
   with patch.object(m,"historical_reviewed_plan",return_value=(plan,plan["image"],"a"*40)),patch.object(m,"task_read",side_effect=lambda arn: lookup[arn]),patch.object(m,"current_service",return_value=service),patch.object(m,"aws",side_effect=cloud):
    with self.assertRaisesRegex(ValueError,"^DEPLOYMENT_NOT_STABLE$"):m.reconcile("b"*40,out,out/"prepared.json","e"*64)
   self.assertFalse((out/"reconciled.json").exists())
  mixed=copy.deepcopy(service);mixed["deployments"].append({"status":"ACTIVE","taskDefinition":before["taskDefinitionArn"],"rolloutState":"COMPLETED","desiredCount":0,"runningCount":0,"pendingCount":0})
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)
   with patch.object(m,"historical_reviewed_plan",return_value=(plan,plan["image"],"a"*40)),patch.object(m,"task_read",side_effect=lambda arn: lookup[arn]),patch.object(m,"current_service",return_value=mixed),patch.object(m,"aws",side_effect=cloud):
    with self.assertRaisesRegex(ValueError,"^DEPLOYMENT_NOT_STABLE$"):m.reconcile("b"*40,out,out/"prepared.json","e"*64)
   self.assertFalse((out/"reconciled.json").exists())
 def test_service_change_between_task_reads_and_receipt_refuses(self):
  before,candidate,descendant,plan,service,cloud=self.fixture("candidate",True)
  changed=copy.deepcopy(service);changed["runningCount"]=0;changed["pendingCount"]=1
  lookup={row["taskDefinitionArn"]:row for row in (before,candidate,descendant)}
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)
   with patch.object(m,"historical_reviewed_plan",return_value=(plan,plan["image"],"a"*40)),patch.object(m,"task_read",side_effect=lambda arn: lookup[arn]),patch.object(m,"current_service",side_effect=[service,changed]),patch.object(m,"aws",side_effect=cloud):
    with self.assertRaisesRegex(ValueError,"^RECONCILE_SERVICE_RACE$"):m.reconcile("b"*40,out,out/"prepared.json","e"*64)
   self.assertFalse((out/"reconciled.json").exists())
 def test_reconciliation_samples_tasks_around_service_and_rechecks_service_afterward(self):
  before,candidate,descendant,plan,service,_=self.fixture("candidate",True)
  lookup={row["taskDefinitionArn"]:row for row in (before,candidate,descendant)};order=[]
  def read_service():order.append("service");return service
  def read_tasks(_known):
   order.append("tasks");row={"taskArnSha256":"a"*64,"taskDefinition":candidate["taskDefinitionArn"],"lastStatus":"RUNNING","healthStatus":"HEALTHY","imageDigest":plan["image"]["imageDigest"]};return [row],"d"*64
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)
   with patch.object(m,"historical_reviewed_plan",return_value=(plan,plan["image"],"a"*40)),patch.object(m,"task_read",side_effect=lambda arn: lookup[arn]),patch.object(m,"current_service",side_effect=read_service),patch.object(m,"running_task_snapshot",side_effect=read_tasks):
    m.reconcile("b"*40,out,out/"prepared.json","e"*64)
  self.assertEqual(order,["service","tasks","service","tasks","service"])
 def test_running_task_set_or_image_race_refuses_without_receipt(self):
  before,candidate,descendant,plan,service,_=self.fixture("candidate",True)
  lookup={row["taskDefinitionArn"]:row for row in (before,candidate,descendant)};calls={"list":0}
  def cloud(*args,**kwargs):
   if args[:2]==("ecs","list-tasks"):
    calls["list"]+=1;return {"taskArns":["task-a" if calls["list"]==1 else "task-b"]}
   if args[:2]==("ecs","describe-tasks"):
    task=args[-1];return {"tasks":[{"taskArn":task,"taskDefinitionArn":candidate["taskDefinitionArn"],"lastStatus":"RUNNING","healthStatus":"HEALTHY","containers":[{"name":"emails","imageDigest":plan["image"]["imageDigest"]}]}]}
   raise AssertionError("UNEXPECTED_AWS_CALL:"+str(args[:2]))
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)
   with patch.object(m,"historical_reviewed_plan",return_value=(plan,plan["image"],"a"*40)),patch.object(m,"task_read",side_effect=lambda arn: lookup[arn]),patch.object(m,"current_service",return_value=service),patch.object(m,"aws",side_effect=cloud):
    with self.assertRaisesRegex(ValueError,"^RECONCILE_RUNNING_TASK_RACE$"):m.reconcile("b"*40,out,out/"prepared.json","e"*64)
   self.assertFalse((out/"reconciled.json").exists())
 def test_descendant_reconciliation_uses_real_oci_lineage_and_receipt_leaks_nothing(self):
  before,candidate,descendant,plan,service,cloud=self.fixture("descendant",True)
  lookup={row["taskDefinitionArn"]:row for row in (before,candidate,descendant)}
  parent_layer={"mediaType":m.OCI_LAYER,"digest":"sha256:"+"3"*64,"size":10}
  layer_bytes=b"reviewed descendant layer\0";compressed=gzip.compress(layer_bytes,mtime=0)
  child_layer={"mediaType":m.OCI_LAYER,"digest":m.digest(compressed),"size":len(compressed)}
  parent_manifest={"schemaVersion":2,"mediaType":m.OCI_MANIFEST,"config":{"mediaType":m.OCI_CONFIG,"digest":"sha256:"+"5"*64,"size":1},"layers":[parent_layer]}
  child_manifest={"schemaVersion":2,"mediaType":m.OCI_MANIFEST,"config":{"mediaType":m.OCI_CONFIG,"digest":"sha256:"+"6"*64,"size":1},"layers":[parent_layer,child_layer]}
  runtime={"Env":["PRIVATE_SHOULD_NOT_APPEAR=1"],"Entrypoint":["bun"],"User":"1000"}
  parent_config={"architecture":"amd64","os":"linux","created":"time","config":{**runtime,"Labels":{"keep":"same"}},"rootfs":{"type":"layers","diff_ids":["sha256:"+"7"*64]},"history":[{"created_by":"base"}]}
  child_config={"architecture":"amd64","os":"linux","created":"time","config":{**runtime,"Labels":{"keep":"same","com.hasna.review.patch-sha256":"SECRET_LABEL_VALUE"}},"rootfs":{"type":"layers","diff_ids":["sha256:"+"7"*64,m.digest(layer_bytes)]},"history":[{"created_by":"base"},{"created_by":"overlay"}]}
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)
   with patch.object(m,"historical_reviewed_plan",return_value=(plan,plan["image"],"a"*40)),patch.object(m,"task_read",side_effect=lambda arn: lookup[arn]),patch.object(m,"current_service",return_value=service),patch.object(m,"aws",side_effect=cloud),patch.object(m,"image_manifest",side_effect=[parent_manifest,child_manifest]),patch.object(m,"blob",side_effect=[m.encode(parent_config),m.encode(child_config),compressed]):
    m.reconcile("b"*40,out,out/"prepared.json","e"*64)
   raw=(out/"reconciled.json").read_text();row=json.loads(raw)
  self.assertEqual(row["state"],"descendant_overlay_live_stable")
  for forbidden in ["PRIVATE_SHOULD_NOT_APPEAR","SECRET_LABEL_VALUE","environment","valueFrom","secret"]:self.assertNotIn(forbidden,raw)

if __name__=="__main__":unittest.main()
