import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

/** Explicit backend vault; every client gets only saved HTTP credentials. */
export async function startLoopbackVault(root, options = {}) {
  const token = randomBytes(32).toString('hex');
  const clientHome=join(root,'api-client-home'), serverHome=join(root,'api-server-home');
  const dbPath=options.dbPath ?? join(root,'vault.db');
  const keyDir=options.keyDir ?? join(root,'keys');
  mkdirSync(serverHome,{recursive:true});
  const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&!/^(HASNA_|SECRETS_|OPEN_SECRETS_|AWS_|DATABASE_URL$|PG|XDG_)/.test(key)));
  const bun=process.versions.bun ? process.execPath : (options.bun ?? 'bun');
  const child=spawn(bun,[join(dirname(fileURLToPath(import.meta.url)),'loopback-vault-server.ts')],{
    cwd:dirname(dirname(fileURLToPath(import.meta.url))),
    env:{...cleanEnv(),HOME:serverHome,NODE_ENV:'test',OPEN_SECRETS_DB:dbPath,HASNA_SECRETS_KEY_DIR:keyDir,HASNA_SECRETS_TEST_ISOLATION:'1'},
    stdio:['pipe','pipe','pipe'],
  });
  child.stdin.end(JSON.stringify({token}));
  child.stderr.resume(); // Never echo fixture values or driver errors.
  const reader=createInterface({input:child.stdout});
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Loopback vault fixture startup timed out'));},10000);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Loopback vault fixture could not start'));});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Loopback vault fixture exited before readiness'));});
    reader.on('line',line=>{try {const data=JSON.parse(line);if(Number.isInteger(data.port)){clearTimeout(timer);resolve(data.port);}}catch{}});
  });
  const url=`http://127.0.0.1:${port}`;
  const config=join(clientHome,'.hasna','secrets','config');mkdirSync(config,{recursive:true,mode:0o700});
  writeFileSync(join(config,'credentials'),`HASNA_SECRETS_API_URL="${url}"\nHASNA_SECRETS_API_KEY="${token}"\n`,{mode:0o600});
  return {
    url,token,dbPath,keyDir,clientHome,
    env:()=>({...cleanEnv(),HOME:clientHome,HASNA_STATION:`fixture-${randomUUID()}`,NODE_ENV:'test',NO_COLOR:'1'}),
    async stop(){
      const exited=new Promise(resolve=>child.once('exit',resolve));
      if(child.exitCode===null && child.signalCode===null){child.kill();await exited;}
      reader.close();
      const copied=readdirSync(clientHome,{recursive:true}).map(String).filter(path=>/\.(?:db|sqlite|sqlite3)(?:-wal|-shm)?$/.test(path));
      if(copied.length)throw new Error('Ordinary API client created a database file');
    },
  };
}
