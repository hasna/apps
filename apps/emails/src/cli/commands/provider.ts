import type { Command } from "commander";
import chalk from "../../lib/chalk-lite.js";
import { createProvider, listProviderSummaries, deleteProvider, getProvider, resolveProviderId, updateProvider } from "../../db/providers.js";
import {fetchProviderSecretStatus,requireProviderSecretOperation,beginProviderSecretJob,readProviderSecretJob,installApiProviderCredentials,writeApiManagedProvider} from "../../lib/provider-secret-api.js";
import { confirmDestructiveAction, formatListHint, handleError, isCliVerboseOutput, parseCliListPage } from "../utils.js";

type SupportedProviderType = "resend" | "ses" | "sandbox";

function parseProviderType(value: string): SupportedProviderType {
  if (value === "resend" || value === "ses" || value === "sandbox") return value;
  handleError(new Error("Provider type must be 'resend', 'ses', or 'sandbox'"));
  return "sandbox";
}

export function registerProviderCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  const providerCmd = program.command("provider").description("Manage email providers");

  const secretsCmd = providerCmd.command("secrets").description("Inspect and manage server provider credentials");
  const reportSecretJob=(result:Awaited<ReturnType<typeof readProviderSecretJob>>)=>{
    const receipt={...result,...(result.status==="pending"?{resume_command:`emails provider secrets job ${result.id} --advance`}:{})};
    output(receipt,JSON.stringify(receipt));
    if(result.status!=="complete")process.exitCode=1;
  };

  secretsCmd.command("status").description("Show server credential sources and tenant root metadata (never values)")
    .action(async()=>{try{
      const status=await fetchProviderSecretStatus();
      output(status,[`Provider credentials: ${status.source}`,`Registered providers: ${status.providers.length}`,`Managed envelopes: ${status.managed_envelopes}`,`Active tenant root: ${status.activeKeyId??"none"}`,status.lifecycle_requirement].join("\n"));
    }catch(error){handleError(error);}});
  for(const operation of ["rewrap","rotate-root"] as const){
    secretsCmd.command(operation).description(operation==="rewrap"?"Rewrap managed server provider data keys":"Rotate the managed tenant provider root")
      .requiredOption("--idempotency-key <uuid>","Reusable operation UUID; reuse after uncertain retries")
      .action(async(opts:{idempotencyKey:string})=>{try{
        const status=await fetchProviderSecretStatus();requireProviderSecretOperation(status,operation);
        let result=await beginProviderSecretJob(operation,opts.idempotencyKey);
        if(result.status==="pending")result=await readProviderSecretJob(result.id,true);
        reportSecretJob(result);
      }catch(error){handleError(error);}});
  }
  secretsCmd.command("revoke-root <keyId>").description("Revoke an inactive, unreferenced managed tenant root")
    .option("--yes","Skip confirmation prompt")
    .requiredOption("--idempotency-key <uuid>","Reusable operation UUID; reuse after uncertain retries")
    .action(async(keyId:string,opts:{yes?:boolean;idempotencyKey:string})=>{try{
      const status=await fetchProviderSecretStatus();requireProviderSecretOperation(status,"revoke-root");
      await confirmDestructiveAction(`Revoke provider root key ${keyId}?`,opts.yes);
      const result=await beginProviderSecretJob("revoke-root",opts.idempotencyKey,keyId);
      reportSecretJob(result);
    }catch(error){handleError(error);}});

  secretsCmd.command("job <id>").description("Inspect or resume a durable provider credential job")
    .option("--advance","Rewrap the next bounded batch")
    .action(async(id:string,opts:{advance?:boolean})=>{try{
      const result=await readProviderSecretJob(id,opts.advance);reportSecretJob(result);
    }catch(error){handleError(error);}});
  secretsCmd.command("install <providerId>").description("Store encrypted server credentials for a registered provider")
    .requiredOption("--credentials-file <path>","JSON credentials file; values are never printed")
    .requiredOption("--expected-revision <revision>","Current revision from status, or none for initial installation")
    .action(async(providerId:string,opts:{credentialsFile:string;expectedRevision:string})=>{try{
      const status=await fetchProviderSecretStatus();requireProviderSecretOperation(status,"rewrap");
      const revision=opts.expectedRevision==="none"?null:Number(opts.expectedRevision);
      if(revision!==null&&(!/^[1-9][0-9]*$/.test(opts.expectedRevision)||!Number.isSafeInteger(revision)))throw Error("Expected revision must be a positive integer or none.");
      const {readFile,stat}=await import("node:fs/promises");
      if((await stat(opts.credentialsFile)).size>65536)throw Error("Credentials file exceeds 64 KiB.");
      let credentials:unknown;try{credentials=JSON.parse(await readFile(opts.credentialsFile,"utf8"));}catch{throw Error("Credentials file must contain valid JSON.");}
      const result=await installApiProviderCredentials(providerId,credentials,revision);output(result,JSON.stringify(result));
    }catch(error){handleError(error);}});

  providerCmd
    .command("add")
    .description("Add an email provider (resend, ses, or sandbox)")
    .option("--id <uuid>","Reusable provider UUID for managed credential creation retries")
    .requiredOption("--name <name>", "Provider name")
    .requiredOption("--type <type>", "Provider type: resend | ses | sandbox")
    .option("--api-key <key>", "Resend API key")
    .option("--region <region>", "SES region")
    .option("--access-key <key>", "SES access key ID")
    .option("--secret-key <key>", "SES secret access key")
    .option("--skip-validation", "Skip credential validation after adding")
    .action(async (opts: {
      name: string;
      type: string;
      id?: string;
      apiKey?: string;
      region?: string;
      accessKey?: string;
      secretKey?: string;
      skipValidation?: boolean;
    }) => {
      try {
        const type = parseProviderType(opts.type);
        const credentials={...(opts.apiKey!==undefined?{api_key:opts.apiKey}:{}),...(opts.accessKey!==undefined?{access_key:opts.accessKey}:{}),...(opts.secretKey!==undefined?{secret_key:opts.secretKey}:{})};
        if(Object.keys(credentials).length){
          if(type==="sandbox")throw Error("Sandbox providers do not accept delivery credentials.");
          const id=opts.id??crypto.randomUUID();
          try{
            const receipt=await writeApiManagedProvider(id,{create:true,name:opts.name,type,region:opts.region??null,credentials,expected_revision:null,skip_validation:opts.skipValidation===true});
            output(receipt,`Provider created: ${opts.name} (${id}); server credential validation ${receipt.checked?"passed":"skipped"}.`);
          }catch(error){throw Error(`${error instanceof Error?error.message:"Provider write failed"} Provider ID: ${id}. Inspect this ID before retrying; use --id to retain it.`);}
          return;
        }
        if(opts.id!==undefined)throw Error("--id is supported for managed credential creation only.");
        const provider=createProvider({name:opts.name,type,region:opts.region});
        output(provider,`Provider registered: ${provider.name} (${provider.id}). No credential validation was performed.`);
      } catch (e) {
        handleError(e);
      }
    });

  providerCmd
    .command("list")
    .description("List configured providers")
    .option("--limit <n>", "Maximum providers to show (default 20 compact, 50 verbose/json)")
    .option("--offset <n>", "Number of providers to skip", "0")
    .option("--verbose", "Show expanded list hints")
    .action((opts: { limit?: string; offset?: string; verbose?: boolean }) => {
      try {
        const page = parseCliListPage(opts);
        const providers = listProviderSummaries(page);
        if (providers.length === 0) {
          output([], chalk.dim("No providers configured. Use 'emails provider add' to add one."));
          return;
        }
        const lines: string[] = [chalk.bold("\nProviders:")];
        for (const p of providers) {
          const status = p.active ? chalk.green("active") : chalk.yellow("inactive");
          lines.push(`  ${chalk.cyan(p.id.slice(0, 8))}  ${p.name}  [${p.type}]  ${status}`);
        }
        lines.push("");
        lines.push(formatListHint({
          shown: providers.length,
          limit: page.limit,
          offset: page.offset,
          noun: "provider",
          detailCommand: "use emails provider update <id> --help for editable fields",
          verbose: opts.verbose || isCliVerboseOutput(),
        }));
        output(providers, lines.join("\n"));
      } catch (e) {
        handleError(e);
      }
    });

  providerCmd
    .command("remove <id>")
    .description("Remove a provider")
    .option("--yes", "Skip confirmation prompt")
    .action(async (id: string, opts: { yes?: boolean }) => {
      try {
        const resolvedId = resolveProviderId(id);
        if (!resolvedId) handleError(new Error(`Provider not found or ambiguous: ${id}`));
        const provider = getProvider(resolvedId);
        if (!provider) handleError(new Error(`Provider not found: ${id}`));
        await confirmDestructiveAction(`Remove provider ${provider.name}?`, opts.yes);
        deleteProvider(resolvedId);
        console.log(chalk.green(`✓ Provider removed: ${provider.name}`));
      } catch (e) {
        handleError(e);
      }
    });

  providerCmd
    .command("update <id>")
    .description("Update an existing provider")
    .option("--name <name>", "Provider name")
    .option("--api-key <key>", "Resend API key")
    .option("--region <region>", "SES region")
    .option("--access-key <key>", "SES access key ID")
    .option("--secret-key <key>", "SES secret access key")
    .option("--skip-validation", "Skip credential validation after update")
    .action(async (id: string, opts: {
      name?: string;
      apiKey?: string;
      region?: string;
      accessKey?: string;
      secretKey?: string;
      skipValidation?: boolean;
    }) => {
      try {
        const resolvedId = resolveProviderId(id);
        if (!resolvedId) handleError(new Error(`Provider not found or ambiguous: ${id}`));
        const existing = getProvider(resolvedId);
        if (!existing) handleError(new Error(`Provider not found: ${id}`));

        const credentials={...(opts.apiKey!==undefined?{api_key:opts.apiKey}:{}),...(opts.accessKey!==undefined?{access_key:opts.accessKey}:{}),...(opts.secretKey!==undefined?{secret_key:opts.secretKey}:{})};
        const status=(Object.keys(credentials).length||opts.region!==undefined)?await fetchProviderSecretStatus():undefined;
        const managed=status?.providers.find(provider=>provider.provider_id===resolvedId);
        if(Object.keys(credentials).length||managed?.credential_source==="managed_envelope"){
          const receipt=await writeApiManagedProvider(resolvedId,{credentials,expected_revision:managed?.revision??null,...(opts.name!==undefined?{name:opts.name}:{}),...(opts.region!==undefined?{region:opts.region}:{}),skip_validation:opts.skipValidation===true});
          output(receipt,`Provider updated: ${resolvedId}; server credential validation ${receipt.checked?"passed":"skipped"}.`);
          return;
        }
        const updated=updateProvider(resolvedId,{...(opts.name!==undefined?{name:opts.name}:{}),...(opts.region!==undefined?{region:opts.region}:{})});
        output(updated,`Provider metadata updated: ${updated.name} (${updated.id}).`);
      } catch (e) {
        handleError(e);
      }
    });

  const healthAction = async () => {
    try {
      const { listServerProviderHealth, formatServerProviderHealth } = await import("../../lib/provider-server-health.js");
      const results = await listServerProviderHealth(true);
      output(results, results.length ? results.map(formatServerProviderHealth).join("\n\n") : "No providers configured.");
    } catch (error) { handleError(error); }
  };
  providerCmd.command("status").description("Probe server provider credentials and sending readiness").action(healthAction);
  providerCmd.command("check").description("Probe server provider credentials and sending readiness").action(healthAction);
}
