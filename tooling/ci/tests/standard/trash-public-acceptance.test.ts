import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dir, "../../../..");
const script = join(root, "apps/trash/scripts/ci/verify-public-api.sh");
const ready = { status: "ready", storage: "postgresql", version: "0.1.1" };
const accepted = [[200, ready], [200, {version:"0.1.1"}], [401, {error:{code:"missing_token"}}]];
function run(responses: unknown[], waiting = true, timeout = "5") {
  const dir=mkdtempSync(join(tmpdir(),"trash-public-acceptance-"));
  try {
    writeFileSync(join(dir,"responses.json"), JSON.stringify(responses));
    writeFileSync(join(dir,"curl"), `#!/usr/bin/env python3
import sys,json,pathlib
p=pathlib.Path(__file__).parent
counter=p/'count'
n=int(counter.read_text()) if counter.exists() else 0
counter.write_text(str(n+1))
r=json.loads((p/'responses.json').read_text()); status,body=r[min(n,len(r)-1)]
a=sys.argv[1:]
assert '--max-time' in a and '--max-filesize' in a and '-L' not in a and '--location' not in a
assert float(a[a.index('--max-time')+1]) <= 15
assert a[a.index('--max-filesize')+1] == '65536'
(p/'requests').open('a').write(a[-1]+'\\n')
pathlib.Path(a[a.index('--output')+1]).write_text(body['raw'] if isinstance(body,dict) and set(body)=={'raw'} else json.dumps(body))
print(status,end='')
sys.exit(7 if status == 0 else 0)
`,{mode:0o700});
    const result=spawnSync("bash",[script, waiting?"https://api.hasna.com/trash":"https://trash.hasna.xyz","0.1.1",...(waiting?["--wait-for-route"]:[])], {
      encoding:"utf8",timeout:8000,env:{...process.env,PATH:`${dir}:${process.env.PATH}`,TRASH_PUBLIC_VERIFY_TIMEOUT_SECONDS:timeout,TRASH_PUBLIC_VERIFY_DELAY_SECONDS:"0"},
    });
    return {...result,calls:existsSync(join(dir,"count"))?Number(readFileSync(join(dir,"count"),"utf8")):0,
      requests:existsSync(join(dir,"requests"))?readFileSync(join(dir,"requests"),"utf8"):""};
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test("accepts directly ready origin only after exact version and auth denial",()=>{
  const r=run(accepted,false);expect(r.status).toBe(0);expect(r.calls).toBe(3);
  expect(r.requests).toBe("https://trash.hasna.xyz/ready\nhttps://trash.hasna.xyz/version\nhttps://trash.hasna.xyz/v1/status\n");
});
test("waits for initial unknown_app then requires all canonical checks",()=>{
  const r=run([[404,{error:"unknown_app"}],...accepted]);expect(r.status).toBe(0);expect(r.calls).toBe(4);
});
for(const status of [0,502,503,504]) test(`waits through bounded transient ${status}`,()=>{
  const r=run([[status,{}],...accepted]);expect(r.status).toBe(0);expect(r.calls).toBe(4);
});
for(const body of [{...ready,version:"0.1.0"},{...ready,storage:"sqlite"},{...ready,status:"ok"},[],{}]) test(`rejects wrong readiness ${JSON.stringify(body)}`,()=>{
  const r=run([[200,body]]);expect(r.status).not.toBe(0);expect(r.calls).toBe(1);expect(r.stdout).not.toContain('verified');
});
for(const response of [[302,{}],[403,{}],[404,{error:"another_error"}]]) test(`rejects terminal status ${JSON.stringify(response)}`,()=>{
  const r=run([response]);expect(r.status).not.toBe(0);expect(r.calls).toBe(1);
});
test("origin does not wait for a missing gateway route",()=>{
  const r=run([[404,{error:"unknown_app"}]],false);expect(r.status).not.toBe(0);expect(r.calls).toBe(1);
});
test("canonical route timeout fails without success receipt",()=>{
  const r=run([[404,{error:"unknown_app"}]],true,"1");expect(r.status).not.toBe(0);expect(r.calls).toBeGreaterThan(0);expect(r.stderr).toContain("deadline");expect(r.stdout).not.toContain('verified');
});
test("wrong canonical version is terminal",()=>{
  const r=run([accepted[0],[200,{version:"0.1.0"}]]);expect(r.status).not.toBe(0);expect(r.calls).toBe(2);
});
for(const response of [[200,{}],[401,{}],[403,{error:{code:"wrong"}}]]) test(`auth denial must have an auth error ${JSON.stringify(response)}`,()=>{
  const r=run([accepted[0],accepted[1],response]);expect(r.status).not.toBe(0);expect(r.calls).toBe(3);
});
for(const timeout of ["0","1201","nope"]) test(`deadline cannot be unbounded ${timeout}`,()=>{
  const r=run(accepted,true,timeout);expect(r.status).not.toBe(0);expect(r.calls).toBe(0);
});
test("workflow waits only after exact ECS and direct proof, and keeps rollback",()=>{
  const w=Bun.YAML.parse(readFileSync(join(root,".github/workflows/deploy-trash.yml"),"utf8"));
  const steps=w.jobs.deploy.steps;
  const verify=steps.find((s:any)=>s.name==="Verify exact live task definition, digest, and health");
  expect(verify.run).toContain('bash scripts/ci/verify-public-api.sh "${HEALTH_URL%/ready}" "${expected_version}"');
  expect(verify.run).toContain('bash scripts/ci/verify-public-api.sh "${PUBLIC_BASE_URL}" "${expected_version}" --wait-for-route');
  expect(verify.run.indexOf('live task definition image digest mismatch')).toBeLessThan(verify.run.indexOf('HEALTH_URL%/ready'));
  expect(verify.run.indexOf('HEALTH_URL%/ready')).toBeLessThan(verify.run.indexOf('--wait-for-route'));
  expect(verify.run.indexOf('--wait-for-route')).toBeLessThan(verify.run.indexOf('> deploy-evidence.json'));
  expect(steps.find((s:any)=>s.name==="Restore rollback anchor after a failed service rollout").if).toContain("failure() && steps.deploy.outputs.service_mutated == 'true'");
});

for (const [name,responses] of [
  ["readiness", [[200,{raw:JSON.stringify({...ready,status:"unavailable"})+"\n"+JSON.stringify(ready)}],accepted[1],accepted[2]]],
  ["version", [accepted[0],[200,{raw:'{"version":"0.1.0"}\n{"version":"0.1.1"}'}],accepted[2]]],
  ["auth", [accepted[0],accepted[1],[401,{raw:'{}\n{"error":{"code":"missing_token"}}'}]]],
  ["unknown_app", [[404,{raw:'{}\n{"error":"unknown_app"}'}],...accepted]],
  ["malformed readiness", [[200,{raw:'{'}]]],
] as const) test(`rejects malformed or multi-document ${name}`,()=>{
  const r=run([...responses]);expect(r.status).not.toBe(0);expect(r.stdout).not.toContain('verified');
});

const transientRouteFailures = [[404,{error:"unknown_app"}],[0,{}],[502,{}],[503,{}],[504,{}]];
for (const stage of ["version","anonymous"] as const) {
  const prefix = stage === "version" ? [accepted[0]] : accepted.slice(0,2);
  const prefixPaths = stage === "version" ? ["/ready","/version"] : ["/ready","/version","/v1/status"];
  for (const response of transientRouteFailures) {
    test(`restarts the entire canonical attempt after ${response[0]} at ${stage}`,()=>{
      const r=run([...prefix,response,...accepted]);
      expect(r.status).toBe(0);
      expect(r.calls).toBe(prefix.length+1+accepted.length);
      expect(r.requests).toBe([...prefixPaths,"/ready","/version","/v1/status"].map(path=>"https://api.hasna.com/trash"+path+"\n").join(""));
    });
    test(`direct origin does not retry ${response[0]} at ${stage}`,()=>{
      const r=run([...prefix,response,...accepted],false);
      expect(r.status).not.toBe(0);
      expect(r.calls).toBe(prefix.length+1);
      expect(r.stdout).not.toContain("verified");
    });
  }
  for (const response of [[302,{}],[404,{error:"other"}],[404,{raw:'{}\n{"error":"unknown_app"}'}],[200,{raw:"{"}],[200,{version:"0.1.0"}]]) {
    test(`does not retry terminal ${JSON.stringify(response)} at ${stage}`,()=>{
      const r=run([...prefix,response,...accepted]);
      expect(r.status).not.toBe(0);
      expect(r.calls).toBe(prefix.length+1);
      expect(r.stdout).not.toContain("verified");
    });
  }
  test(`revalidates readiness after transient failure at ${stage}`,()=>{
    const r=run([...prefix,[503,{}],[200,{...ready,storage:"sqlite"}],...accepted]);
    expect(r.status).not.toBe(0);
    expect(r.calls).toBe(prefix.length+2);
    expect(r.stdout).not.toContain("verified");
  });
  test(`one deadline bounds repeated downstream failure at ${stage}`,()=>{
    // Bash SECONDS advances at integer boundaries; leave time for multiple attempts.
    const r=run(Array.from({length:100},()=>[...prefix,[503,{}]]).flat(),true,"3");
    expect(r.status).not.toBe(0);
    expect(r.calls).toBeGreaterThan(prefix.length+1);
    expect(r.stderr).toContain("deadline");
    expect(r.stdout).not.toContain("verified");
  });
}
test("revalidates package version after anonymous-endpoint propagation failure",()=>{
  const r=run([accepted[0],accepted[1],[503,{}],accepted[0],[200,{version:"0.1.0"}],...accepted]);
  expect(r.status).not.toBe(0);
  expect(r.calls).toBe(5);
  expect(r.stdout).not.toContain("verified");
});

for (const [name,endpoint,prefix,response,status,errorClass] of [
  ["readiness","/ready",[],[200,{...ready,storage:"sqlite",detail:"fixture-sensitive-payload"}],"200","readiness_contract_mismatch"],
  ["version","/version",[accepted[0]],[200,{version:"0.1.0",detail:"fixture-sensitive-payload"}],"200","version_contract_mismatch"],
  ["anonymous success","/v1/status",accepted.slice(0,2),[200,{detail:"fixture-sensitive-payload"}],"200","anonymous_auth_denial_mismatch"],
  ["malformed denial","/v1/status",accepted.slice(0,2),[401,{detail:"fixture-sensitive-payload"}],"401","anonymous_auth_denial_mismatch"],
] as const) test(`failure diagnostics identify ${name} without response contents`,()=>{
  const r=run([...prefix,response,...accepted]);
  expect(r.status).not.toBe(0);
  expect(r.calls).toBe(prefix.length+1);
  expect(r.stderr).toContain(`endpoint=${endpoint} http_status=${status} error_class=${errorClass}`);
  expect(r.stderr.length).toBeLessThan(300);
  expect(r.stderr).not.toContain("fixture-sensitive-payload");
  expect(r.stdout).not.toContain("fixture-sensitive-payload");
});
