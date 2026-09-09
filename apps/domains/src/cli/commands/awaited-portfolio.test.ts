import { expect, test } from "bun:test";
import { join } from "node:path";

// Isolate module mocks in fresh processes; no registrar, credential or API I/O.
for (const command of ["sedo", "route53"] as const) {
  for (const outcome of ["success", "failure"] as const) {
    test(`${command} waits for portfolio ${outcome} before reporting completion`, async () => {
      const script = `
        import { mock } from "bun:test";
        import { Command } from "commander";
        const root = ${JSON.stringify(join(import.meta.dir, "../.."))};
        const lines = [];
        globalThis.fetch = () => { throw new Error("External I/O forbidden in fixture"); };
        mock.module(root + "/lib/stdout.ts", () => ({ printLine: x => lines.push(String(x ?? "")), printErrorLine: x => lines.push(String(x)), writeStdout: x => lines.push(String(x)) }));
        let resolveWrite, rejectWrite, started;
        const writeStarted = new Promise(resolve => { started = resolve; });
        const pendingWrite = new Promise((resolve,reject) => { resolveWrite = resolve; rejectWrite = reject; });
        const write = () => { started(); return pendingWrite; };
        const program = new Command();
        const originalExit = process.exit;
        let exitCode;
        process.exit = code => { exitCode = code; throw new Error("fixture exit " + code); };
        if (${JSON.stringify(command)} === "sedo") {
          mock.module(root + "/lib/sedo.ts", () => ({ recordSedoPurchase: write }));
          const {registerSedoCommand} = await import(root + "/cli/commands/sedo.ts");
          registerSedoCommand(program);
        } else {
          const provider = await import(root + "/lib/route53.ts");
          mock.module(root + "/lib/route53.ts", () => ({...provider,
            checkAvailability: async () => ({available:true}),
            registerDomain: async () => ({operationId:"fixture-operation"}),
            getRegistrationStatus: async () => ({status:"SUCCESSFUL"})}));
          mock.module(root + "/lib/config.ts", () => ({resolveContact: () => ({})}));
          mock.module(root + "/lib/zone-setup.ts", () => ({setupDomainZone: async () => ({zoneId:"fixture-zone",created:false,nameServers:[]})}));
          mock.module(root + "/db/domains.ts", () => ({createDomain:write,getDomainByName:async()=>null,updateDomain:write}));
          const timer = globalThis.setTimeout;
          globalThis.setTimeout = (fn, ms, ...args) => timer(fn, ms === 10000 ? 0 : ms, ...args);
          const {registerRoute53Commands} = await import(root + "/cli/commands/route53.ts");
          registerRoute53Commands(program);
        }
        const args = ${JSON.stringify(command === "sedo" ? ["sedo", "buy", "fixture.invalid", "--price", "42", "--json"] : ["r53", "full-setup", "fixture.invalid"])};
        let completed = false;
        const running = program.parseAsync(args,{from:"user"}).catch(e => { if (!String(e).includes("fixture exit")) throw e; }).finally(() => {completed = true;});
        await writeStarted;
        await new Promise(resolve => setTimeout(resolve, 10));
        if (completed || lines.some(x => /Full setup complete|Recorded Sedo purchase|Added to portfolio/.test(x)) || lines.includes("{}")) throw new Error("Command reported success before portfolio write");
        if (${JSON.stringify(outcome)} === "success") resolveWrite({id:"fixture-saved",name:"fixture.invalid"});
        else rejectWrite(new Error("fixture save rejected"));
        await running;
        if (${JSON.stringify(outcome)} === "failure") {
          if ((exitCode ?? process.exitCode) !== 1) throw new Error("Write failure exit status was not set");
          if (!lines.some(x => x.includes("fixture save rejected"))) throw new Error("Write failure was not reported");
          if (lines.some(x => /Full setup complete|Recorded Sedo purchase|Added to portfolio/.test(x))) throw new Error("False success after failure");
        } else if (!lines.some(x => /fixture-saved|Full setup complete/.test(x))) throw new Error("Saved result missing");
        process.exitCode = 0;
        process.exit = originalExit;
      `;
      const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
        cwd: join(import.meta.dir, "../../.."), stdout: "pipe", stderr: "pipe",
      });
      const timer = setTimeout(() => child.kill(), 10000);
      try {
        const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect({code, output, errors}).toEqual({code:0, output:"", errors:""});
      } finally { clearTimeout(timer); }
    }, 12000);
  }
}
