import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { SwitcherClient, SwitcherError, type Provider, type Profile } from "./sdk";
import { codingEligible, Fault, CommandInterrupted, parse, providerInputSchema, profileInputSchema, type Model } from "./domain";
import { providerFromPreset, type PresetOptions } from "./presets";

const absent = (error: unknown) => error instanceof SwitcherError && error.status === 404;
export async function resolveLaunchProvider(client: SwitcherClient, selector: string, options: PresetOptions = {}): Promise<Provider> {
  let existing: Provider | undefined;
  try { existing = await client.getProvider(selector); } catch (error) { if (!absent(error)) throw error; }
  if (existing) {
    if (Object.entries(options).some(([key, value]) => key !== "harness" && value !== undefined))
      throw new Fault(409, "provider_override", "This ID names a saved provider. Update it explicitly or use a different preset/provider ID.");
    return existing;
  }
  const desired = providerFromPreset(selector, options);
  try { existing = await client.getProvider(desired.id); } catch (error) { if (!absent(error)) throw error; }
  if (!existing) {
    try { return await client.createProvider(desired); }
    catch (error) { if (!(error instanceof SwitcherError && error.status === 409)) throw error; existing = await client.getProvider(desired.id); }
  }
  const {version, updatedAt, ...input} = existing;
  if (JSON.stringify(parse(providerInputSchema, input)) !== JSON.stringify(desired))
    throw new Fault(409, "provider_conflict", "A saved provider with this preset ID has different settings. Select its ID directly or update it explicitly.");
  return existing;
}

const display = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
export async function selectModel(models: Model[], query = ""): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Fault(400, "model_required", "Use --model MODEL in noninteractive mode. List available models with switcher models PROVIDER.");
  const eligible = models.filter(codingEligible);
  if (!eligible.length) throw new Fault(422, "model_missing", "This provider has no models eligible for coding in its current catalog.");
  const reader = createInterface({input: process.stdin, output: process.stderr});
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort(new CommandInterrupted(130,"Model selection was cancelled; no harness was started."));
  const terminate = () => cancellation.abort(new CommandInterrupted(143,"Model selection was interrupted; no harness was started."));
  reader.on("SIGINT",cancel); reader.on("close",cancel);
  process.on("SIGINT",cancel); process.on("SIGTERM",terminate);
  try {
    for (;;) {
      const matching = eligible.filter(m => `${m.id} ${m.name}`.toLowerCase().includes(query.toLowerCase()));
      const visible = matching.slice(0, 30);
      console.error(`Models: ${matching.length} match${matching.length === 1 ? "" : "es"}${matching.length > 30 ? " (first 30 shown; type to narrow)" : ""}.`);
      visible.forEach((m, i) => console.error(`  ${i + 1}. ${display(m.id)} — ${display(m.name)}`));
      const answer = (await reader.question("Model number, exact model ID, or search text (Ctrl-C cancels): ",{signal:cancellation.signal})
        .catch(error => { throw cancellation.signal.aborted ? cancellation.signal.reason : error; })).trim();
      if (/^[1-9]\d*$/.test(answer) && visible[Number(answer) - 1]) return visible[Number(answer) - 1].id;
      if (eligible.some(m => m.id === answer)) return answer;
      query = answer;
    }
  } finally {
    reader.off("SIGINT",cancel); reader.off("close",cancel);
    process.off("SIGINT",cancel); process.off("SIGTERM",terminate);
    reader.close();
  }
}

export async function ensureLaunchProfile(client: SwitcherClient, provider: Provider, harness: Profile["harness"], model: string): Promise<Profile> {
  const hash = createHash("sha256").update(JSON.stringify([provider.id, harness, model])).digest("hex").slice(0, 24);
  const desired = parse(profileInputSchema, {id: `launch-${harness}-${hash}`, name: `${harness}: ${model}`.slice(0, 200), providerId: provider.id, harness, model});
  let existing: Profile | undefined;
  try { existing = await client.getProfile(desired.id); } catch (error) { if (!absent(error)) throw error; }
  if (!existing) {
    try { return await client.createProfile(desired); }
    catch (error) { if (!(error instanceof SwitcherError && error.status === 409)) throw error; existing = await client.getProfile(desired.id); }
  }
  if (existing.providerId !== desired.providerId || existing.harness !== harness || existing.model !== model)
    throw new Fault(409, "profile_conflict", "An existing launch profile has different settings. Select a saved profile explicitly.");
  return existing;
}
