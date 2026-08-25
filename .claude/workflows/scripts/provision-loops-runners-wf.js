export const meta = {
  name: 'provision-loops-runners',
  description: 'Execute O15-00214 (ce0e0ad0): provision loops control-plane machine principals id==hostname for station01/02/03, materialize mode-600 ~/.hasna/loops/runner.env per station, verify state=api_ready and machineId==hostname with a positive control. Strict credential hygiene: values never printed or captured.',
  phases: [
    { title: 'Provision' },
    { title: 'Verify' },
  ],
}

const PROVISION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['provisioned', 'stations'],
  properties: {
    provisioned: { type: 'boolean' },
    stations: { type: 'array', items: { type: 'string' } },
    principalSurface: { type: 'string' },
    verified: { type: 'array', items: { type: 'string' } },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'evidence'],
  properties: {
    verdict: { enum: ['GO', 'NO_GO'] },
    evidence: { type: 'array', items: { type: 'string' } },
  },
}

phase('Provision')
const provision = await agent(`Execute todos task O15-00214 (id ce0e0ad0-3c84-43e8-995d-21af57805100): "PROVISION: per-station loops runner principals + API keys + mode-600 EnvironmentFile (station01/02/03)".

CONTEXT (from the task and fleet rule global-hasna-loops deployment):
- Provision machine principals in the loops control plane for station01, station02, station03 (station04 when loops pins there). principal id == hostname — runner.id == machine.id == control-plane principal id; requireBoundRunner enforces it (403 otherwise). NEVER cloud-runner-* aliases (legacy alias wedge class).
- Install HASNA_LOOPS_API_URL + HASNA_LOOPS_API_KEY into ~/.hasna/loops/runner.env mode 600 per station. Values never printed or captured (secrets get --check / secrets exec only). The loops-runner CLI is the package-owned surface: 'loops-runner install' writes the env file + service unit.
- Confirm the current station01 key's principalId == hostname BEFORE switching, or requireBoundRunner 403s every claim.
- VERIFY on each station: loops-runner status --json -> state=api_ready AND machineId==hostname. Positive control: missing key yields missing_api_key, not a silent pass.

CURRENT STATE (measured 2026-08-24, station01): loops-runner 0.6.0 installed; loops status reports apiKeyPresent=true, connection=api, apiUrl=https://loops.hasna.xyz; loops-runner status reports state=api_ready (key resolves from ambient env, no runner.env file exists). loops machines list shows station01/02/04/05 etc. The task's runner.env materialization is NOT done.

WORK:
1. Determine the EXACT control-plane principal-provisioning surface for the installed loops version: read the @hasna/loops source (grep the installed package for requireBoundRunner, principal, provision) and the loops server API surface. If provisioning is a server-side operation (loops.hasna.xyz), find the supported path (a CLI verb, an admin API endpoint, or a hasna/todos-tracked operator task) and use it — NEVER hand-roll an API call that bypasses the package-owned surface. If the control-plane principal for station01 already exists and is id==hostname (verify, don't assume), record that.
2. Confirm station01's CURRENT key's principalId == hostname (the runner already connects — resolve how, via the package's own read surface, values masked).
3. For EACH station (station01, station02, station03): materialize ~/.hasna/loops/runner.env mode 600 containing HASNA_LOOPS_API_URL + HASNA_LOOPS_API_KEY, using the supported 'loops-runner install' path (or the documented equivalent). The API key comes from the secrets vault (secrets exec <key> --as HASNA_LOOPS_API_KEY -- loops-runner install ... or the documented install path) — NEVER print/capture the value, NEVER write it into a command you echo, NEVER let it reach a transcript or file other than the mode-600 runner.env the tool itself writes. Where the station is reachable via tailscale/ssh, install remotely with the same discipline; where unreachable, record the exact resume condition (do NOT fabricate success).
4. Verify per station: loops-runner status --json -> state=api_ready and machineId==hostname. Run the positive control: with the env file absent/temporarily pointed at an empty key, the runner must report missing_api_key (not a silent pass) — prove the control discriminates, then restore.
5. Comment the todos row O15-00214 with what was provisioned, per-station verify lines (state + machineId, values masked), the positive-control result, and any resume conditions.

STRICT: never print, echo, cat, or capture any key value in any encoding. Consume via secrets exec / --check only. If the control-plane provisioning surface is not reachable from this session, STOP at that gate and record the exact blocker + resume condition rather than improvising.

Return the schema: provisioned (true/false), stations (list provisioned), principalSurface (one line naming the exact surface used), verified (per-station verify lines).`, { label: 'provision', phase: 'Provision', schema: PROVISION_SCHEMA })

phase('Verify')
const verify = await agent(`Independently verify the O15-00214 provisioning (station01/02/03 loops runner principals + runner.env). The provision lane reported: ${JSON.stringify(provision)}.

Challenge it adversarially:
1. For each claimed station: run loops-runner status --json and confirm state=api_ready AND machineId==hostname (a status you READ, not one the provision lane reported).
2. Confirm ~/.hasna/loops/runner.env exists mode 600 (ls -la, stat) — mode is the gate.
3. Positive control: prove a missing/invalid key yields missing_api_key (or equivalent explicit error), NOT a silent api_ready — verify the control discriminates.
4. Confirm NO cloud-runner-* alias was introduced (the legacy wedge class) — the principal id must be the bare hostname.
5. Confirm no key value appears in any transcript/log/PR (grep the session scratch and the runner.env is mode-600 with masked presence only).
6. Comment the row with your independent verdict.

Return GO only if all hold, else NO_GO with exact evidence.`, { label: 'verify', phase: 'Verify', schema: VERIFY_SCHEMA })

return { status: verify && verify.verdict === 'GO' ? 'provision-loops-runners-go' : 'provision-loops-runners-no-go', provision, verify }
