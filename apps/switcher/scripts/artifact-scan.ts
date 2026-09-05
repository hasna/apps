import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
const base = process.env.SWITCHER_TEST_ROOT ?? join(homedir(),"Workspace","scratch","switcher-artifacts");
await mkdir(base,{recursive:true});
const directory = await mkdtemp(join(base,"pack-"));
try {
  // npm's outer --dry-run is inherited by lifecycle subprocesses. The scan
  // must inspect an actual tarball even when the caller is a dry-run gate.
  const pack = Bun.spawn(["npm","pack","--ignore-scripts","--dry-run=false","--json","--pack-destination",directory],{stdout:"pipe",stderr:"inherit"});
  const output = await new Response(pack.stdout).text();
  if(await pack.exited) throw new Error("npm pack failed");
  const file = JSON.parse(output)[0].filename;
  const scan = Bun.spawn([process.execPath,"./node_modules/@hasna/contracts/dist/cli/contracts-cli.js","artifact-scan",join(directory,file)],{stdout:"inherit",stderr:"inherit"});
  if(await scan.exited) process.exitCode=1;
} finally {await rm(directory,{recursive:true,force:true});}
