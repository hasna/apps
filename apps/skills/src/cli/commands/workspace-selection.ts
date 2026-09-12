import type { Command } from "commander";
import { getApiUrl, getAuthFilePath, CREDENTIAL_STORE_UNMANAGED } from "../../lib/auth-store.js";
import { selectedSkillsProfile } from "../../lib/instance-credentials.js";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { WorkspaceProfileError } from "../../lib/workspace-profile.js";
import { NameInputError, promptCode, readCode } from "./customer-verification.js";

type Options = { email?: string; codeStdin?: boolean; json?: boolean };
async function codeFor(client: RemoteSkillsAuthClient, options: Options): Promise<string | null> {
  if (!options.email?.includes("@")) throw new NameInputError("Provide the account email with --email.");
  if (options.codeStdin) return readCode();
  if (options.json || !process.stdin.isTTY || !process.stderr.isTTY) throw new NameInputError("Use --code-stdin with a fresh verification code for noninteractive requests.");
  await client.requestCode(options.email);
  return promptCode();
}
function errorResult(error: unknown, json?: boolean) {
  const message = error instanceof NameInputError || error instanceof WorkspaceProfileError ? error.message
    : "Unable to complete workspace sign-in. Check the selected server, profile, account and fresh verification code.";
  if (json) console.log(JSON.stringify({ error: message })); else console.error(message);
  process.exitCode = 1;
}
export function registerWorkspaceListCommand(workspace: Command) {
  workspace.command("list").allowExcessArguments(false)
    .description("Discover eligible workspaces with fresh sign-in; no credentials are saved")
    .requiredOption("--email <email>", "Account email for fresh verification")
    .option("--code-stdin", "Read a previously requested six-digit verification code from stdin")
    .option("--json", "Output safe workspace identities as JSON")
    .action(async (options: Options) => {
      try {
        const origin = getApiUrl("Discover workspaces", { ...process.env });
        const client = new RemoteSkillsAuthClient(origin);
        const code = await codeFor(client, options); if (code === null) return;
        const result = await client.listAccountWorkspaces(options.email!, code);
        if (options.json) console.log(JSON.stringify({ apiUrl: origin, ...result }));
        else {
          console.log(`Account: ${result.userId}\nAPI: ${origin}`);
          for (const entry of result.workspaces) console.log(`${entry.current ? "*" : " "} ${entry.organization.name}\t${entry.role}\t${entry.membershipId}`);
          console.log("* Initial sign-in workspace. Enroll a named profile with auth login --membership-id <id>.");
        }
      } catch (error) { errorResult(error, options.json); }
    });
}
export async function loginWorkspace(options: Options & { membershipId: string }) {
  // Enrollment used to switch to the membership, mint a workspace key and WRITE
  // it into the named profile's credentials file. This CLI writes no credential
  // file (owner ruling 2026-09-07 / hasna/apps#1720; fleet credential rule
  // 2026-09-09), so the verb stops BEFORE any request — no code is consumed and
  // no key is minted — and names the profile file the key belongs in.
  try {
    const env = { ...process.env };
    const origin = getApiUrl("Sign in to a workspace", env);
    const profile = selectedSkillsProfile(env);
    if (!profile) throw new WorkspaceProfileError("Workspace login requires an explicit HASNA_PROFILE name.");
    const credentialsFile = getAuthFilePath(env);
    const error = `${CREDENTIAL_STORE_UNMANAGED}: workspace enrollment no longer stores a key. Create one for membership ${options.membershipId} on ${origin} ` +
      `(skills auth keys create <name> --email <you> --code <CODE>, shown once) and place it in profile '${profile}': ${credentialsFile} ` +
      `(mode 0600, HASNA_SKILLS_API_KEY=<key> and HASNA_SKILLS_API_URL=${origin} lines).`;
    if (options.json) console.log(JSON.stringify({ status: "credential_store_unmanaged", code: CREDENTIAL_STORE_UNMANAGED, error, profile, apiUrl: origin, membershipId: options.membershipId, credentialsFile }));
    else console.error(error);
    process.exitCode = 1;
  } catch (error) { errorResult(error, options.json); }
}
