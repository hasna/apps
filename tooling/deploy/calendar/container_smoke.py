#!/usr/bin/env python3
"""Synthetic isolated PostgreSQL smoke; never reads host application credentials."""
import argparse,pathlib,tempfile,subprocess,shutil,json,os,time,uuid,re
parser=argparse.ArgumentParser()
parser.add_argument("--image",required=True)
parser.add_argument("--deps-image",required=True)
parser.add_argument("--out",type=pathlib.Path,required=True)
args=parser.parse_args()
for value in [args.image,args.deps_image]:
 if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}",value):raise SystemExit("invalid image reference")
nonce=uuid.uuid4().hex[:12]
root=pathlib.Path(tempfile.mkdtemp(prefix='calendar-arm64-fixture-'))
network='calendar-smoke-'+nonce
pg='calendar-pg-'+nonce
app='calendar-app-'+nonce
image=args.image
deps=args.deps_image
def run(*args,check=True):
 r=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
 if check and r.returncode: raise RuntimeError(f'fixture command failed ({r.returncode}); output withheld')
 return r

def docker(*args,**kwargs): return run(*(['sudo','-n'] if os.environ.get('CALENDAR_SMOKE_SUDO') == '1' else []),'docker',*args,**kwargs)
try:
 run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(root/'server.key'),'-out',str(root/'ca.pem'),'-days','1','-subj',f'/CN={pg}','-addext',f'subjectAltName=DNS:{pg}')
 os.chmod(root,0o755)
 os.chmod(root/'server.key',0o644)
 docker('network','create',network)
 docker('run','-d','--name',pg,'--network',network,'--mount',f'type=bind,source={root},target=/fixture,readonly','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=calendar','postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685','sh','-c','cp /fixture/server.key /tmp/server.key && chown postgres:postgres /tmp/server.key && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/fixture/ca.pem -c ssl_key_file=/tmp/server.key')
 for i in range(30):
  if docker('exec',pg,'pg_isready','-U','postgres',check=False).returncode==0: break
  time.sleep(1)
 else: raise RuntimeError('fixture PostgreSQL not ready')
 fixture_environment={'PORT':'8080','HASNA_CALENDAR_DATABASE_URL':f'postgres://postgres@{pg}:5432/calendar?sslmode=verify-full','HASNA_CALENDAR_API_SIGNING_KEY':uuid.uuid4().hex,'PGSSLROOTCERT':'/fixture/ca.pem','NODE_EXTRA_CA_CERTS':'/fixture/ca.pem'}
 env=['--cpus','0.25','--memory','512m','--network',network,'--mount',f'type=bind,source={root},target=/fixture,readonly']
 for name,value in fixture_environment.items(): env.extend(['-e','='.join([name,value])])
 for n in [1,2]:
  r=docker('run','--rm',*env,image,'bun','dist/server/index.js','migrate')
  assert 'migrate: done' in r.stdout
  print(f'migration_run_{n}=PASS',flush=True)
 docker('run','-d','--name',app,*env,image)
 (root/'smoke.ts').write_text('''
import assert from 'node:assert/strict';
import { mintApiKey, ApiKeyStore } from '/app/node_modules/@hasna/contracts/dist/auth/index.js';
const sql=new Bun.SQL(process.env.HASNA_CALENDAR_DATABASE_URL!, {ssl:'verify-full',tls:{rejectUnauthorized:true,serverName:'calendar-arm64-pg-fixture',ca:await Bun.file('/fixture/ca.pem').text()}});
const client={many:async(q,p=[])=>await sql.unsafe(q,p),get:async(q,p=[]) => (await sql.unsafe(q,p))[0]??null,execute:async(q,p=[])=>{await sql.unsafe(q,p);}};
const store=new ApiKeyStore(client);
await sql`INSERT INTO calendar_tenants(id,enabled) VALUES ('tenant-a',true),('tenant-b',true),('tenant-disabled',false)`;
const make=async(tid,secret=process.env.HASNA_CALENDAR_API_SIGNING_KEY!)=>{const k=mintApiKey({app:'calendar',scopes:['calendar:*'],signingSecret:secret,tid});await store.insertMinted(k,'image-fixture');return k.token};
const a=await make('tenant-a'),b=await make('tenant-b');
const request=async(path,key?,method='GET',body?)=>fetch('http://calendar-arm64-app-fixture:8080'+path,{method,headers:{...(key?{'x-api-key':key}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
for(let i=0;i<30;i++){try{if((await request('/ready')).ok)break;}catch{}await Bun.sleep(200);}
assert.equal((await request('/ready')).status,200);assert.equal((await request('/health')).status,200);assert.equal((await request('/v1/orgs')).status,401);assert.equal((await request('/v1/orgs','invalid')).status,401);
assert.equal((await request('/v1/orgs',await make(undefined))).status,403);
for(const tid of ['tenant-unknown','tenant-disabled'])assert.equal((await request('/v1/orgs',await make(tid))).status,403);
assert.equal((await request('/v1/orgs',await make('tenant-a','incorrect-image-fixture-signing'))).status,401);
const created=await request('/v1/orgs',a,'POST',{name:'container-fixture'});assert.equal(created.status,201);const org=await created.json();
console.log('create_shape='+Object.keys(org).join(','));
assert.equal((await request('/v1/orgs',a)).status,200);
const id=org.org?.id;assert.equal(typeof id,'string');assert.ok(id.length>0);assert.equal((await request('/v1/orgs/'+id,a)).status,200);const hidden=await request('/v1/orgs/'+id,b);assert.equal(hidden.status,404);
assert.equal((await request('/mcp')).status,404);
await sql.close();console.log('container_tls_auth_tenant_smoke=PASS');
'''.replace('calendar-arm64-pg-fixture',pg).replace('calendar-arm64-app-fixture',app))
 r=docker('run','--rm',*env,deps,'bun','/fixture/smoke.ts')
 print(r.stdout,flush=True)
 r=docker('run','--rm','--network','none',image,'sh','-c','test ! -e /app/node_modules && test -s /app/migrations/0003_tenant_boundary.sql && bun dist/server/index.js --version')
 print('offline_version='+r.stdout.strip(),flush=True)
 print('runtime_budget=cpu0.25,memory512m,PORT8080',flush=True)
 metadata=json.loads(docker('image','inspect',image,'--format','{{json .}}').stdout)
 assert metadata['Os']=='linux' and metadata['Architecture']=='arm64'
 version=r.stdout.strip()
 proof={'schema':'hasna.calendar-container-smoke.v1','image_id':metadata['Id'],'platform':'linux/arm64','version':version,'cpus':'0.25','memory_mib':512,'port':8080,'migration_runs':2,'tls_verify_full':True,'owned_record_read':200,'cross_tenant_read':404,'authentication_controls_passed':True,'offline_version_passed':True}
 args.out.parent.mkdir(parents=True,exist_ok=True)
 args.out.write_text(json.dumps(proof,sort_keys=True,separators=(',',':'))+'\n')
 args.out.chmod(0o600)
 print('Calendar isolated container smoke passed',flush=True)
finally:
 for name in [app,pg]: docker('rm','-fv',name,check=False)
 docker('network','rm',network,check=False)
 shutil.rmtree(root)
